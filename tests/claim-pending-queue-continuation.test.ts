import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { projectDropsSnapshot } from '../src/background/drops-projection.ts';
import { createFarmingCampaignTransition } from '../src/background/farming-campaign-transition.ts';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { createFarmingSessionContext } from '../src/background/farming-session-context.ts';
import {
  reconcileFarmingSessionTargets,
  unresolvedFarmingTargets,
} from '../src/background/farming-session-targets.ts';
import { hasCompletedCampaignWatchTime } from '../src/background/session-lifecycle-completion.ts';
import { createWatchHealth } from '../src/background/watch-health.ts';
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
import { commitPreparedCampaign, createQueueProgressionFixture } from './support/queue-progression.ts';

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

test.each([0, 8 * 60_000])(
  'monitoring suspends completed watch time before transport work, API cooldown=%s',
  async (cooldown) => {
    const { state, game, key } = fixture();
    state.apiBackoffUntil = cooldown ? Date.now() + cooldown : 0;
    state.lastInventoryRefreshAt = Date.now();
    state.appState.activeStreamer = createStreamer();
    state.appState.autoClaimDrops = false;
    let stopped = 0;
    let requests = 0;
    let ticks = 0;
    const session = createFarmingSession(
      state,
      createFarmingSessionAdapters({
        ensureTwitchSession: async () => {
          requests++;
          return null;
        },
        fetchInventorySnapshotFromApi: async () => {
          requests++;
          return null;
        },
        watchTransport: {
          start: async () => {
            requests++;
            return { kind: 'failed', health: null };
          },
          tick: async () => {
            ticks++;
            return createWatchHealth('managed-tab', 'healthy', 'heartbeat', Date.now);
          },
          stop: async () => {
            stopped++;
          },
          setPreference: async () => {},
        },
      }),
    );
    await session.checkDropProgress();
    expect(state.appState.recoveryReason).toBe('rewards-pending');
    expect(state.appState.selectedGame).toMatchObject(game);
    expect(state.appState.queue).toEqual([]);
    expect(state.appState.activeStreamer).toBeNull();
    expect(state.appState.farmingSessionTargets[key]?.acquired).toBe(false);
    expect(state.appState.queueEntryMetadataByKey[key]?.attemptedStreamerNames).toBeUndefined();
    expect(stopped).toBe(1);
    expect(ticks).toBe(0);
    expect(requests).toBe(0);
    expect(state.appState.recoveryBackoffUntil).toBeGreaterThanOrEqual(state.apiBackoffUntil);
    if (cooldown) {
      await session.checkDropProgress();
      expect(state.appState.recoveryReason).toBe('rewards-pending');
      expect(requests).toBe(0);
      expect(ticks).toBe(0);
    }
  },
);

test.each([false, true])(
  'claimed rewards reconcile during cooldown only with current validation, validated=%s',
  async (validated) => {
    const { state } = fixture();
    state.cachedDropsSnapshot = state.cachedDropsSnapshot.map((drop) => ({ ...drop, claimed: true }));
    state.appState.allDrops = state.cachedDropsSnapshot;
    state.appState.pendingDrops = [];
    state.appState.activeStreamer = createStreamer();
    state.appState.autoClaimDrops = false;
    state.hasCurrentGenerationCampaignValidation = validated;
    state.apiBackoffUntil = Date.now() + 8 * 60_000;
    let stopped = 0;
    let requests = 0;
    const session = createFarmingSession(
      state,
      createFarmingSessionAdapters({
        ensureTwitchSession: async () => {
          requests++;
          return null;
        },
        fetchInventorySnapshotFromApi: async () => {
          requests++;
          return null;
        },
        watchTransport: {
          start: async () => ({ kind: 'failed', health: null }),
          tick: async () => createWatchHealth('managed-tab', 'healthy', 'heartbeat', Date.now),
          stop: async () => {
            stopped++;
          },
          setPreference: async () => {},
        },
      }),
    );
    await session.checkDropProgress();
    expect(requests).toBe(0);
    if (validated) {
      expect(state.appState.isRunning).toBe(false);
      expect(state.appState.activeStreamer).toBeNull();
      expect(stopped).toBeGreaterThan(0);
      expect(state.appState.lastStopReason).toBe('queue-complete');
    } else {
      const clock = spyOn(Date, 'now').mockReturnValue(state.apiBackoffUntil + 1);
      try {
        await session.checkDropProgress();
        expect(requests).toBeGreaterThan(0);
      } finally {
        clock.mockRestore();
      }
    }
  },
);

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
  'API cooldown preserves the queued successor until its real deadline, restore=%s',
  async (restore) => {
    const subject = fixture();
    let state = subject.state;
    const next = createGame({ campaignId: 'next', name: 'Next' });
    state.appState.queue.push(next);
    state.appState.availableGames.push(next);
    state.apiBackoffUntil = Date.now() + 8 * 60_000;
    const prepared: string[] = [];
    const progression = () =>
      createQueueProgressionFixture(state, {
        transitionCampaign: async (candidate) => {
          prepared.push(gameKey(candidate));
          return commitPreparedCampaign(state, candidate);
        },
      });
    await progression().advanceIfCompleted();
    if (restore) {
      const saved = state;
      state = createMinimalState({
        cachedDropsSnapshot: structuredClone(subject.drops),
        apiBackoffUntil: saved.apiBackoffUntil,
      });
      state.appState = normalizeStoredAppState(structuredClone(saved.appState));
      await progression().advanceIfCompleted();
    }
    expect(prepared).toEqual([]);
    expect(state.appState.queue).toEqual([next]);
    expect(state.appState.recoveryReason).toBe('rewards-pending');
    expect(state.appState.queueEntryMetadataByKey[gameKey(next)]?.attemptedStreamerNames).toBeUndefined();
    expect(state.appState.recoveryBackoffUntil).toBe(state.apiBackoffUntil);
    const clock = spyOn(Date, 'now').mockReturnValue(state.apiBackoffUntil);
    try {
      await progression().retryWaitingQueue();
      expect(prepared).toEqual([gameKey(next)]);
      expect(state.appState.selectedGame).toEqual(next);
      expect(state.appState.farmingSessionTargets[subject.key]?.acquired).toBe(false);
    } finally {
      clock.mockRestore();
    }
  },
);

test.each([false, true])(
  'an expired all-100 campaign cannot remain claim-pending during cooldown, successor=%s',
  async (withSuccessor) => {
    const { state, game } = fixture();
    game.endsAt = new Date(Date.now() - 1_000).toISOString();
    state.apiBackoffUntil = Date.now() + 8 * 60_000;
    const next = createGame({ campaignId: 'next', name: 'Next' });
    if (withSuccessor) {
      state.appState.queue.push(next);
      state.appState.availableGames.push(next);
    }
    let attempts = 0;
    await createQueueProgressionFixture(state, {
      transitionCampaign: async () => {
        attempts++;
        return { kind: 'started' };
      },
    }).advanceIfCompleted();
    expect(attempts).toBe(0);
    expect(state.appState.recoveryReason).not.toBe('rewards-pending');
    expect(state.appState.isRunning).toBe(withSuccessor);
    if (withSuccessor) {
      expect(state.appState.selectedGame).toEqual(next);
      expect(state.appState.queue).toEqual([next]);
    } else {
      expect(state.appState.lastStopReason).toBe('queue-complete');
    }
  },
);

test.each(['partial', 'unfinished'] as const)(
  'API cooldown does not invent watch-time completion from %s rewards',
  async (evidence) => {
    const { state } = fixture();
    state.apiBackoffUntil = Date.now() + 60_000;
    state.cachedDropsSnapshot =
      evidence === 'partial'
        ? state.cachedDropsSnapshot.slice(0, 1)
        : state.cachedDropsSnapshot.map((drop) => ({ ...drop, progress: 99, claimable: false }));
    state.appState.allDrops = state.cachedDropsSnapshot;
    state.appState.pendingDrops = state.cachedDropsSnapshot;
    state.appState.autoClaimDrops = false;
    state.appState.activeStreamer = createStreamer();
    await createFarmingSession(state, createFarmingSessionAdapters()).checkDropProgress();
    expect(state.appState.recoveryReason).not.toBe('rewards-pending');
    expect(state.appState.queue).toHaveLength(1);
    expect(state.appState.activeStreamer).not.toBeNull();
  },
);

test.each(['pause', 'stop'] as const)(
  '%s wins while a completed player is being suspended',
  async (action) => {
    const { state } = fixture();
    state.apiBackoffUntil = Date.now() + 60_000;
    state.appState.activeStreamer = createStreamer();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let stops = 0;
    const session = createFarmingSession(
      state,
      createFarmingSessionAdapters({
        watchTransport: {
          start: async () => ({ kind: 'failed', health: null }),
          tick: async () => createWatchHealth('managed-tab', 'healthy', 'heartbeat', Date.now),
          setPreference: async () => {},
          stop: async () => {
            if (++stops === 1) {
              entered.resolve();
              await release.promise;
            }
          },
        },
      }),
    );
    const tick = session.checkDropProgress();
    await entered.promise;
    if (action === 'pause') await session.handlePauseFarming();
    else await session.handleStopFarming();
    release.resolve();
    await tick;
    expect(state.appState.isPaused).toBe(action === 'pause');
    expect(state.appState.isRunning).toBe(action === 'pause');
    expect(state.appState.manualQueueAuthorized).toBe(action === 'pause');
    expect(state.appState.recoveryReason).not.toBe('rewards-pending');
  },
);

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
