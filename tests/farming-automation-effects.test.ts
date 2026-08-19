import { describe, expect, test } from 'bun:test';
import { createFarmingAutomation } from '../src/background/farming-automation.ts';
import type { FarmingAutomationBrowser } from '../src/background/farming-automation-browser.ts';
import {
  FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY,
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

type PostCommitFailure = 'facts' | 'notification' | 'alarm' | null;

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

function fixture(failure: PostCommitFailure = null) {
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
  state.appState.isRunning = false;
  state.appState.selectedGame = null;
  state.appState.favoriteGames = [{ gameId: incumbent.id, lastKnownName: incumbent.name, addedAt: 1 }];
  const storage = createInMemoryFarmingAutomationStorage();
  const events: string[] = [];
  const base = createInMemoryFarmingAutomationPersistence({
    state,
    storage,
    getSessionRevision: () => String(currentFarmingSessionEpoch(state)),
    broadcast: () => {
      events.push('broadcast');
    },
  });
  const persistence: FarmingAutomationPersistence = {
    ...base,
    commitTransition: async (commit) => {
      events.push('commit');
      return base.commitTransition(commit);
    },
    saveFacts: async (facts) => {
      events.push('facts');
      return failure === 'facts' ? { kind: 'failed', reason: 'storage-unavailable' } : base.saveFacts(facts);
    },
  };
  const watch = createWatchTransportTransition({
    currentOwnership: null,
    prepareManaged: async (target) => ({
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
    }),
    prepareTabless: async () => null,
    release: async () => ({ kind: 'released', method: 'none' }),
  });
  const browser: FarmingAutomationBrowser = {
    watch,
    hasNotificationPermission: async () => true,
    deliverNotification: async ({ id }) => {
      events.push('notification');
      if (failure === 'notification') throw new DOMException('notification failed', 'InvalidStateError');
      return { kind: 'delivered', notificationId: id };
    },
    observeManualTabs: async () => ({ kind: 'observed', tabs: [] }),
    replaceDeadlineAlarm: async () => {
      events.push('alarm');
      return failure === 'alarm' ? 'failed' : 'scheduled';
    },
    schedulePeriodicAlarm: async () => 'scheduled',
  };
  const streamer: TwitchStreamer = {
    id: 'streamer',
    name: 'channel',
    displayName: 'Channel',
    isLive: true,
    viewerCount: 1,
  };
  const automation = createFarmingAutomation({
    state,
    persistence,
    browser,
    twitch: {
      refresh: async () => {
        events.push('refresh');
        return { kind: 'ready', snapshot, refreshPatch: deriveSafeRefreshPatch(snapshot) };
      },
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
  return { automation, candidate, events, state, storage, watch };
}

describe('Farming automation ordered effects', () => {
  test('resolves after durable state and broadcasts before notification', async () => {
    // Given: an idle extension and a healthy favorite candidate B.
    const subject = fixture();

    // When: the public request commits and completes all ordered effects.
    const outcome = await subject.automation.request('periodic');

    // Then: durable broadcasts precede notification and alarm scheduling.
    expect({
      outcome,
      events: subject.events,
      activity: subject.state.appState.automationActivity.map(({ kind }) => kind),
      cleanup: subject.storage.getLocal(FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY),
    }).toEqual({
      outcome: { kind: 'started', campaignKey: gameKey(subject.candidate), transition: 'start' },
      events: ['refresh', 'broadcast', 'commit', 'facts', 'broadcast', 'notification', 'alarm'],
      activity: ['auto-started'],
      cleanup: expect.objectContaining({ transition: 'start' }),
    });
  });

  test('maps failures without disturbing the committed session', async () => {
    // Given: each best-effort post-commit boundary fails independently.
    const failures = ['facts', 'notification', 'alarm'] as const;

    // When: each public request starts B before its configured effect failure.
    const results = await Promise.all(
      failures.map(async (failure) => {
        const subject = fixture(failure);
        return {
          failure,
          outcome: await subject.automation.request('periodic'),
          selected: gameKey(subject.state.appState.selectedGame ?? subject.candidate),
          ownership: subject.watch.currentOwnership(),
        };
      }),
    );

    // Then: B remains the live owned session after each best-effort effect failure.
    expect(results).toEqual(
      failures.map((failure) => ({
        failure,
        outcome: { kind: 'started', campaignKey: 'campaign:campaign-b', transition: 'start' },
        selected: 'campaign:campaign-b',
        ownership: { kind: 'managed-tab', tabId: 11, ownershipToken: 'owned-b', expectedChannel: 'channel' },
      })),
    );
  });

  test('does not duplicate notification or activity on the next public evaluation', async () => {
    // Given: one successful automatic start already produced its durable presentation.
    const subject = fixture();
    await subject.automation.request('periodic');

    // When: a later periodic evaluation observes the already-running best campaign.
    const outcome = await subject.automation.request('periodic');

    // Then: no second notification or activity entry is produced.
    expect({
      outcome,
      notifications: subject.events.filter((event) => event === 'notification').length,
      activity: subject.state.appState.automationActivity.length,
    }).toEqual({
      outcome: { kind: 'unchanged', reason: 'already-farming-best-campaign' },
      notifications: 1,
      activity: 1,
    });
  });
});
