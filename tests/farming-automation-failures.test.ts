import { describe, expect, test } from 'bun:test';
import { createFarmingAutomation } from '../src/background/farming-automation.ts';
import type { FarmingAutomationBrowser } from '../src/background/farming-automation-browser.ts';
import type {
  FarmingAutomationOutcome,
  FarmingAutomationPersistence,
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

type FailureStage =
  | 'permission'
  | 'session'
  | 'refresh'
  | 'directory-session'
  | 'directory'
  | 'observation'
  | 'preparation'
  | 'commit'
  | 'persistence'
  | 'queue-write'
  | 'snooze-write';

const streamer: TwitchStreamer = {
  id: 'streamer',
  name: 'channel',
  displayName: 'Channel',
  isLive: true,
  viewerCount: 1,
};

function campaign(id: string, endsAt: string): TwitchGame {
  return {
    id: 'shared-game',
    name: id,
    imageUrl: '',
    campaignId: `campaign-${id}`,
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

function fixture(stage: FailureStage) {
  const startFailure = stage === 'preparation' || stage === 'commit';
  const incumbent = campaign('a', '2030-08-03T16:00:00.000Z');
  const candidate = campaign('b', '2030-08-03T12:00:00.000Z');
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
  state.appState.isRunning = !startFailure;
  state.appState.selectedGame = startFailure ? null : incumbent;
  state.appState.favoriteGames = [{ gameId: incumbent.id, lastKnownName: incumbent.name, addedAt: 1 }];
  if (stage === 'queue-write') state.appState.campaignPriorityMode = 'priority-list-only';
  const base = createInMemoryFarmingAutomationPersistence({
    state,
    storage: createInMemoryFarmingAutomationStorage(),
    getSessionRevision: () => String(currentFarmingSessionEpoch(state)),
    broadcast: () => undefined,
  });
  const persistence: FarmingAutomationPersistence = {
    ...base,
    loadFacts:
      stage === 'persistence'
        ? async () => ({ kind: 'failed', reason: 'storage-unavailable' })
        : base.loadFacts,
    savePolicyPatch:
      stage === 'queue-write'
        ? async () => ({ kind: 'failed', reason: 'storage-unavailable' })
        : base.savePolicyPatch,
    setSnooze:
      stage === 'snooze-write'
        ? async () => ({ kind: 'failed', reason: 'storage-unavailable' })
        : base.setSnooze,
    commitTransition:
      stage === 'commit'
        ? async () => ({ kind: 'failed', reason: 'transition-commit-failed' })
        : base.commitTransition,
  };
  let disposals = 0;
  const watch = createWatchTransportTransition({
    currentOwnership: startFailure
      ? null
      : {
          kind: 'managed-tab',
          tabId: 10,
          ownershipToken: 'owned-a',
          expectedChannel: 'incumbent',
        },
    prepareManaged: async (target) =>
      stage === 'preparation'
        ? null
        : {
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
            dispose: async () => {
              disposals += 1;
            },
          },
    prepareTabless: async () => null,
    release: async () => ({ kind: 'released', method: 'closed' }),
  });
  const browser: FarmingAutomationBrowser = {
    watch,
    hasNotificationPermission: async () => stage !== 'permission',
    deliverNotification: async ({ id }) => ({ kind: 'delivered', notificationId: id }),
    observeManualTabs: async () =>
      stage === 'observation' ? { kind: 'failed' } : { kind: 'observed', tabs: [] },
    replaceDeadlineAlarm: async () => 'scheduled',
    schedulePeriodicAlarm: async () => 'scheduled',
  };
  const automation = createFarmingAutomation({
    state,
    persistence,
    browser,
    twitch: {
      refresh: async () => {
        if (stage === 'session') return { kind: 'session-missing' };
        if (stage === 'refresh') throw new DOMException('refresh unavailable', 'NetworkError');
        return { kind: 'ready', snapshot, refreshPatch: deriveSafeRefreshPatch(snapshot) };
      },
      fetchDirectory: async (game) => {
        if (stage === 'directory-session') return { kind: 'session-missing' };
        if (stage === 'directory') throw new DOMException('directory unavailable', 'NetworkError');
        return {
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
        };
      },
    },
    now: () => 2_000,
    random: () => 0,
  });
  return { automation, disposals: () => disposals, incumbent, startFailure, state, watch };
}

const cases: readonly (readonly [FailureStage, FarmingAutomationOutcome])[] = [
  ['permission', { kind: 'failed', reason: 'notifications-unavailable' }],
  ['session', { kind: 'failed', reason: 'twitch-session-missing', retryAt: 122_000 }],
  ['refresh', { kind: 'failed', reason: 'drops-refresh-failed', retryAt: 122_000 }],
  ['directory-session', { kind: 'failed', reason: 'twitch-session-missing', retryAt: 122_000 }],
  ['directory', { kind: 'failed', reason: 'drops-refresh-failed', retryAt: 122_000 }],
  ['observation', { kind: 'failed', reason: 'candidate-preparation-failed', retryAt: 122_000 }],
  ['preparation', { kind: 'failed', reason: 'candidate-preparation-failed', retryAt: 122_000 }],
  ['commit', { kind: 'failed', reason: 'transition-commit-failed', retryAt: 122_000 }],
  ['persistence', { kind: 'failed', reason: 'persistence-failed' }],
  ['queue-write', { kind: 'failed', reason: 'persistence-failed' }],
];

describe('Farming automation operational failures', () => {
  test.each(cases)('maps %s failures without replacing a stable session', async (stage, expected) => {
    // Given: one operational boundary is configured to fail before a stable transition.
    const subject = fixture(stage);

    // When: the public automation request reaches that boundary.
    const outcome = await subject.automation.request('periodic');

    // Then: the stable outcome is returned without replacing the prior session.
    expect({
      outcome,
      selected: subject.state.appState.selectedGame,
      ownership: subject.watch.currentOwnership(),
      disposals: subject.disposals(),
    }).toEqual({
      outcome: expected,
      selected: subject.startFailure ? null : subject.incumbent,
      ownership: subject.startFailure
        ? null
        : { kind: 'managed-tab', tabId: 10, ownershipToken: 'owned-a', expectedChannel: 'incumbent' },
      disposals: stage === 'commit' ? 1 : 0,
    });
  });

  test('keeps an immediate in-memory snooze after durable snooze persistence fails', async () => {
    // Given: persistence rejects the durable snooze write.
    const subject = fixture('snooze-write');

    // When: the user snoozes before another request.
    const snooze = await subject.automation.snooze('manual-stop');
    const outcome = await subject.automation.request('periodic');

    // Then: the failure is surfaced without touching the incumbent fixture.
    expect({ snooze, outcome, selected: subject.state.appState.selectedGame }).toEqual({
      snooze: 'persistence-failed',
      outcome: { kind: 'unchanged', reason: 'snoozed' },
      selected: subject.incumbent,
    });
  });
});
