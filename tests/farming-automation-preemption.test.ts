import { describe, expect, test } from 'bun:test';
import { createFarmingAutomation } from '../src/background/farming-automation.ts';
import type { FarmingAutomationBrowser } from '../src/background/farming-automation-browser.ts';
import {
  FARMING_AUTOMATION_FACTS_STORAGE_KEY,
  type FarmingAutomationPersistence,
} from '../src/background/farming-automation-contracts.ts';
import {
  createInMemoryFarmingAutomationPersistence,
  createInMemoryFarmingAutomationStorage,
} from '../src/background/farming-automation-persistence.ts';
import {
  deriveSafeRefreshPatch,
  type FarmingAutomationTwitchSnapshot,
} from '../src/background/farming-automation-twitch.ts';
import { currentFarmingSessionEpoch } from '../src/background/farming-session-revision.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createWatchTransportTransition } from '../src/background/watch-transport-transition.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import type { TwitchDrop, TwitchGame, TwitchStreamer } from '../src/types/index.ts';

const streamer: TwitchStreamer = {
  id: 'streamer',
  name: 'channel',
  displayName: 'Channel',
  isLive: true,
  viewerCount: 1,
};

function campaign(campaignId: string, endsAt: string): TwitchGame {
  return {
    id: 'shared-game',
    name: 'Shared Game',
    imageUrl: '',
    campaignId,
    campaignName: campaignId,
    endsAt,
    rewardSummary: { completion: 'farmable', remainderReasons: [] },
  };
}

function reward(game: TwitchGame): TwitchDrop {
  return {
    id: `drop-${game.campaignId}`,
    name: 'Reward',
    gameId: game.id,
    gameName: game.name,
    imageUrl: '',
    progress: 0,
    currentMinutes: 0,
    claimed: false,
    campaignId: game.campaignId,
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
  };
}

function fixture(candidateEndsAt: string, deduplicated = false) {
  const incumbent = campaign('campaign-a', '2030-08-03T16:00:00.000Z');
  const candidate = campaign('campaign-b', candidateEndsAt);
  const drops = [reward(incumbent), reward(candidate)];
  const snapshot: FarmingAutomationTwitchSnapshot = {
    games: [incumbent, candidate],
    drops,
    campaignDropsByKey: {
      [gameKey(incumbent)]: [drops[0]],
      [gameKey(candidate)]: [drops[1]],
    },
    campaignChannelsMap: {},
    updatedAt: 1_000,
  };
  const state = createServiceWorkerState();
  state.appState.autoStartFavoriteGames = true;
  state.appState.notificationsEnabled = true;
  state.appState.isRunning = true;
  state.appState.selectedGame = incumbent;
  state.appState.favoriteGames = [{ gameId: 'shared-game', lastKnownName: 'Shared Game', addedAt: 1 }];
  const storage = createInMemoryFarmingAutomationStorage();
  if (deduplicated) {
    storage.seedLocal(FARMING_AUTOMATION_FACTS_STORAGE_KEY, {
      version: 1,
      lastPreemption: {
        attemptId: 'previous',
        fromCampaignKey: gameKey(incumbent),
        toCampaignKey: gameKey(candidate),
        committedAt: 1,
        sessionRevision: '0',
      },
      manualWatch: null,
      nextEvaluationAt: null,
    });
  }
  const basePersistence = createInMemoryFarmingAutomationPersistence({
    state,
    storage,
    getSessionRevision: () => String(currentFarmingSessionEpoch(state)),
    broadcast: () => undefined,
  });
  let commits = 0;
  const persistence: FarmingAutomationPersistence = {
    ...basePersistence,
    commitTransition: async (commit) => {
      commits += 1;
      return basePersistence.commitTransition(commit);
    },
  };
  let preparations = 0;
  const watch = createWatchTransportTransition({
    currentOwnership: {
      kind: 'managed-tab',
      tabId: 10,
      ownershipToken: 'owned-a',
      expectedChannel: 'incumbent',
    },
    prepareManaged: async (target) => {
      preparations += 1;
      return {
        target,
        ownership: {
          kind: 'managed-tab',
          tabId: 11,
          ownershipToken: 'owned-b',
          expectedChannel: target.channelName,
        },
        health: {
          mode: 'managed-tab',
          isHealthy: true,
          status: 'healthy',
          reason: 'heartbeat',
          consecutiveFailures: 0,
          consecutiveStalls: 0,
          progress: 0,
          shouldFallback: false,
          checkedAt: 1,
        },
        dispose: async () => undefined,
      };
    },
    prepareTabless: async () => null,
    release: async () => ({ kind: 'released', method: 'closed' }),
  });
  const browser: FarmingAutomationBrowser = {
    watch,
    hasNotificationPermission: async () => true,
    deliverNotification: async ({ id }) => ({ kind: 'delivered', notificationId: id }),
    observeManualTabs: async () => ({ kind: 'observed', tabs: [] }),
    replaceDeadlineAlarm: async () => 'scheduled',
    schedulePeriodicAlarm: async () => 'scheduled',
  };
  const automation = createFarmingAutomation({
    state,
    persistence,
    browser,
    twitch: {
      refresh: async () => ({ kind: 'ready', snapshot, refreshPatch: deriveSafeRefreshPatch(snapshot) }),
      fetchDirectory: async (game) => ({
        kind: 'ready',
        target: {
          campaignKey: gameKey(game),
          campaignId: game.campaignId ?? null,
          gameId: game.id,
          gameName: game.name,
          categoryId: null,
          categorySlug: game.name,
        },
        streamers: [streamer],
        languageFilterApplied: false,
      }),
    },
    now: () => 2_000,
    random: () => 0,
  });
  return {
    automation,
    candidate,
    commits: () => commits,
    incumbent,
    preparations: () => preparations,
    state,
  };
}

describe('Farming automation preemption', () => {
  test('preempts only for a strictly earlier favorite and preserves duplicate campaign identity', async () => {
    // Given: A and B share a game ID, while favorite B has a strictly earlier finite expiry.
    const subject = fixture('2030-08-03T12:00:00.000Z');

    // When: the public campaign-refresh request evaluates the ranked candidates.
    const outcome = await subject.automation.request('campaign-refresh');

    // Then: B commits as a campaign-aware preemption through the real transition.
    expect({ outcome, selected: gameKey(subject.state.appState.selectedGame ?? subject.incumbent) }).toEqual({
      outcome: { kind: 'started', campaignKey: gameKey(subject.candidate), transition: 'preemption' },
      selected: gameKey(subject.candidate),
    });
  });

  test('does not preempt when the favorite does not expire earlier', async () => {
    // Given: candidate B expires after incumbent A.
    const subject = fixture('2030-08-03T20:00:00.000Z');

    // When: automation evaluates both eligible campaigns.
    const outcome = await subject.automation.request('periodic');

    // Then: A remains incumbent and no candidate watch is prepared.
    expect({
      outcome,
      preparations: subject.preparations(),
      selected: subject.state.appState.selectedGame,
    }).toEqual({
      outcome: { kind: 'unchanged', reason: 'already-farming-best-campaign' },
      preparations: 0,
      selected: subject.incumbent,
    });
  });

  test('deduplicates an already-applied campaign pair before preparation', async () => {
    // Given: durable facts already record the same A to B preemption pair.
    const subject = fixture('2030-08-03T12:00:00.000Z', true);

    // When: the same pair is evaluated again.
    const outcome = await subject.automation.request('periodic');

    // Then: deduplication prevents both provisional preparation and commit.
    expect({ outcome, commits: subject.commits(), preparations: subject.preparations() }).toEqual({
      outcome: { kind: 'unchanged', reason: 'preemption-already-applied' },
      commits: 0,
      preparations: 0,
    });
  });
});
