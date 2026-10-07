import { afterEach, beforeEach, expect, test } from 'bun:test';
import { projectDropsSnapshot } from '../src/background/drops-projection.ts';
import { createFarmingCampaignTransition } from '../src/background/farming-campaign-transition.ts';
import { createFarmingSessionContext } from '../src/background/farming-session-context.ts';
import {
  reconcileFarmingSessionTargets,
  unresolvedFarmingTargets,
} from '../src/background/farming-session-targets.ts';
import { hasCompletedCampaignWatchTime } from '../src/background/session-lifecycle-completion.ts';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';
import { farmingMessages } from '../src/shared/farming-messages.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import { deriveRuntimeMode } from '../src/shared/runtime-status.ts';
import { createUserStatusModel } from '../src/shared/user-status.ts';
import {
  createDrop,
  createFarmingSessionAdapters,
  createGame,
  createMinimalState,
  createStreamer,
} from './fixtures/queue-management.ts';
import { createWatchTransportCoordinatorFixture } from './fixtures/watch-transport-coordinator.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { createQueueProgressionFixture } from './support/queue-progression.ts';

let mocks: ReturnType<typeof setupChromeMocks>;
beforeEach(() => {
  mocks = setupChromeMocks();
});
afterEach(() => {
  mocks.teardown();
});

function fixture() {
  const game = createGame({ campaignId: 'warhammer', name: 'Warhammer', dropCount: 2, isConnected: false });
  const drops = ['one', 'two'].map((id) =>
    createDrop({
      id,
      campaignId: game.campaignId,
      acquisitionMethod: 'watch-time',
      progress: 100,
      claimable: true,
    }),
  );
  const state = createMinimalState({ cachedDropsSnapshot: drops });
  Object.assign(state.appState, {
    isRunning: true,
    manualQueueAuthorized: true,
    farmingSessionOrigin: 'manual',
    selectedGame: game,
    queue: [game],
    availableGames: [game],
    allDrops: drops,
    pendingDrops: drops,
  });
  const key = gameKey(game);
  state.appState.queueEntryMetadataByKey[key] = {
    source: 'manual',
    reason: 'user-added',
    addedAt: 1,
    attemptedStreamerNames: ['a', 'b', 'c', 'd'],
    streamerRetryReason: 'open-failed',
    streamerRetryAt: 2,
  };
  state.appState.campaignFailureEpisodesByKey[key] = {
    id: 'old',
    game,
    reason: 'open-failed',
    startedAt: 1,
    lastAttemptAt: 2,
    visible: true,
  };
  return { state, game, drops, key };
}

test('all-100 unlinked rewards leave the farming queue and prepare the next campaign', async () => {
  const { state, game, key } = fixture();
  const next = createGame({ campaignId: 'brawlhalla', name: 'Brawlhalla' });
  state.appState.queue.push(next);
  state.appState.availableGames.push(next);
  const prepared: string[] = [];
  const subject = createQueueProgressionFixture(state, {
    transitionCampaign: async (candidate) => {
      prepared.push(gameKey(candidate));
      state.appState.selectedGame = candidate;
      return { kind: 'started' };
    },
  });
  await subject.advanceIfCompleted();
  expect(prepared).toEqual([gameKey(next)]);
  expect(state.appState.selectedGame).toEqual(next);
  expect(state.appState.queue).not.toContainEqual(game);
  expect(state.appState.farmingSessionTargets[key]?.acquired).toBe(false);
  expect(state.appState.queueEntryMetadataByKey[key]?.attemptedStreamerNames).toBeUndefined();
  expect(state.appState.queueEntryMetadataByKey[key]?.streamerRetryAt).toBeUndefined();
  expect(farmingMessages(state.appState)).toEqual([]);
});

test.each([false, true])(
  'claim-pending-only stays authorized without any streamer attempt, restore=%s',
  async (restore) => {
    const subject = fixture();
    await createQueueProgressionFixture(subject.state).advanceIfCompleted();
    let state = subject.state;
    if (restore) {
      state = createMinimalState({ cachedDropsSnapshot: structuredClone(subject.drops) });
      state.appState = normalizeStoredAppState(structuredClone(subject.state.appState));
    }
    let attempts = 0;
    const progression = createQueueProgressionFixture(state, {
      transitionCampaign: async () => {
        attempts++;
        return { kind: 'started' };
      },
    });
    await progression.advanceIfCompleted();
    await progression.retryWaitingQueue();
    expect(attempts).toBe(0);
    expect(state.appState.isRunning).toBe(true);
    expect(state.appState.manualQueueAuthorized).toBe(true);
    expect(state.appState.queue).toEqual([]);
    expect(unresolvedFarmingTargets(state)).toHaveLength(1);
    expect(state.appState.recoveryReason).toBe('rewards-pending');
    expect(state.appState.recoveryBackoffUntil).toBeGreaterThan(Date.now());
    expect(
      createUserStatusModel({
        state: state.appState,
        runtimeMode: deriveRuntimeMode(state.appState),
        currentAutomatableDrop: null,
        recoveryNow: Date.now(),
      }),
    ).toMatchObject({
      badge: 'DONE',
      progressState: 'complete',
      detail: 'Link your game account to claim the rewards.',
    });
    expect(farmingMessages(state.appState)).toEqual([]);
    state.cachedDropsSnapshot = state.cachedDropsSnapshot.map((drop) => ({ ...drop, claimed: true }));
    reconcileFarmingSessionTargets(state);
    expect(unresolvedFarmingTargets(state)).toEqual([]);
    expect(state.appState.farmingSessionTargets[subject.key]?.acquired).toBe(true);
  },
);

test('missing or partially complete rewards never prove watch-time completion', () => {
  const { state, game, drops } = fixture();
  state.cachedDropsSnapshot = drops.slice(0, 1);
  expect(hasCompletedCampaignWatchTime(state, game)).toBe(false);
  state.cachedDropsSnapshot = drops.map((drop, index) =>
    index ? { ...drop, claimable: false, progress: 99 } : drop,
  );
  expect(hasCompletedCampaignWatchTime(state, game)).toBe(false);
});

test('fresh all-100 evidence during preparation retires the candidate without changing the incumbent player', async () => {
  const { state, game, drops, key } = fixture();
  const incumbent = createGame({ campaignId: 'brawlhalla', name: 'Brawlhalla', dropCount: 1 });
  const incumbentDrop = createDrop({ campaignId: incumbent.campaignId });
  const streamer = createStreamer({ name: 'lootbrawlhalla' });
  state.cachedDropsSnapshot = [
    incumbentDrop,
    ...drops.map((drop) => ({ ...drop, claimable: false, progress: 90 })),
  ];
  Object.assign(state.appState, {
    selectedGame: incumbent,
    activeStreamer: streamer,
    allDrops: [incumbentDrop],
    pendingDrops: [incumbentDrop],
    currentDrop: incumbentDrop,
    queue: [incumbent, game],
    availableGames: [incumbent, game],
    tabId: 17,
  });
  reconcileFarmingSessionTargets(state);
  let preparations = 0;
  const { coordinator } = createWatchTransportCoordinatorFixture();
  const context = createFarmingSessionContext(
    state,
    createFarmingSessionAdapters({
      watchTransport: {
        ...coordinator,
        prepare: async () => {
          preparations++;
          throw new Error('No playback expected');
        },
      },
    }),
  );
  const transition = createFarmingCampaignTransition(context, async (working) => {
    projectDropsSnapshot(
      working,
      { games: [incumbent, game], drops: [incumbentDrop, ...drops], updatedAt: Date.now() },
      'campaign-authoritative',
    );
    return 'refreshed';
  });
  expect(await transition(game)).toMatchObject({
    kind: 'completed',
    game: {
      allDropsCompleted: false,
      rewardSummary: { completion: 'farming-complete' },
    },
  });
  expect(preparations).toBe(0);
  expect(state.appState.selectedGame?.campaignId).toBe(incumbent.campaignId);
  expect(state.appState.activeStreamer).toEqual(streamer);
  expect(state.appState.tabId).toBe(17);
  expect(state.appState.farmingSessionTargets[key]?.acquired).toBe(false);
  expect(state.appState.queue).not.toContainEqual(game);
});
