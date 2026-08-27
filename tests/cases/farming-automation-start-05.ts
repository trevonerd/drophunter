import { describe, expect, test } from 'bun:test';
import { createFarmingAutomation } from '../../src/background/farming-automation.ts';
import type { FarmingAutomationBrowser } from '../../src/background/farming-automation-browser.ts';
import {
  FARMING_AUTOMATION_FACTS_STORAGE_KEY,
  type FarmingAutomationFactsV1,
  type FarmingAutomationPersistence,
} from '../../src/background/farming-automation-contracts.ts';
import {
  createInMemoryFarmingAutomationPersistence,
  createInMemoryFarmingAutomationStorage,
} from '../../src/background/farming-automation-persistence.ts';
import type { FarmingAutomationTwitchSnapshot } from '../../src/background/farming-automation-twitch.ts';
import { deriveSafeRefreshPatch } from '../../src/background/farming-automation-twitch.ts';
import { currentFarmingSessionEpoch } from '../../src/background/farming-session-revision.ts';
import { createServiceWorkerState } from '../../src/background/runtime-state.ts';
import { createWatchTransportTransition } from '../../src/background/watch-transport-transition.ts';
import { gameKey } from '../../src/shared/game-selection.ts';
import type { TwitchDrop, TwitchGame, TwitchStreamer } from '../../src/types/index.ts';

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

function startFixture(
  refreshGate: Promise<void> = Promise.resolve(),
  notificationPermission = true,
  refreshFails: () => boolean = () => false,
) {
  const later = campaign('campaign-later', '2030-08-03T16:00:00.000Z');
  const best = campaign('campaign-best', '2030-08-03T12:00:00.000Z');
  const drops = [reward(later), reward(best)];
  const snapshot: FarmingAutomationTwitchSnapshot = {
    games: [later, best],
    drops,
    campaignDropsByKey: { [gameKey(later)]: [drops[0]], [gameKey(best)]: [drops[1]] },
    campaignChannelsMap: {},
    updatedAt: 1_000,
  };
  const state = createServiceWorkerState();
  state.appState.autoStartFavoriteGames = true;
  state.appState.notificationsEnabled = true;
  state.appState.campaignPriorityMode = 'ending-soonest';
  state.appState.favoriteGames = [{ gameId: 'shared-game', lastKnownName: 'Shared Game', addedAt: 1 }];
  const events: string[] = [];
  const storage = createInMemoryFarmingAutomationStorage();
  const basePersistence = createInMemoryFarmingAutomationPersistence({
    state,
    storage,
    getSessionRevision: () => String(currentFarmingSessionEpoch(state)),
    broadcast: () => {
      events.push('broadcast');
    },
  });
  const persistence: FarmingAutomationPersistence = {
    ...basePersistence,
    commitTransition: async (commit) => {
      events.push('commit');
      return basePersistence.commitTransition(commit);
    },
    saveFacts: async (facts) => {
      events.push('facts');
      return basePersistence.saveFacts(facts);
    },
  };
  const watch = createWatchTransportTransition({
    currentOwnership: null,
    prepareManaged: async (target) => ({
      target,
      ownership: {
        kind: 'managed-tab',
        tabId: 22,
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
        events.push('dispose');
      },
    }),
    prepareTabless: async () => null,
    release: async () => ({ kind: 'released', method: 'closed' }),
  });
  const browser: FarmingAutomationBrowser = {
    watch,
    hasNotificationPermission: async () => notificationPermission,
    deliverNotification: async (notification) => {
      events.push(`notification:${notification.id}`);
      return { kind: 'delivered', notificationId: notification.id };
    },
    observeManualTabs: async () => ({ kind: 'observed', tabs: [] }),
    replaceDeadlineAlarm: async () => {
      events.push('alarm');
      return 'scheduled';
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
        await refreshGate;
        if (refreshFails()) throw new DOMException('Injected refresh failure', 'NetworkError');
        return { kind: 'ready', snapshot, refreshPatch: deriveSafeRefreshPatch(snapshot) };
      },
      fetchDirectory: async (game) => ({
        kind: 'ready',
        target: {
          campaignKey: gameKey(game),
          campaignId: game.campaignId ?? null,
          gameId: game.id,
          gameName: game.name,
          categoryId: game.categoryId ?? null,
          categorySlug: game.name,
        },
        streamers: [streamer],
        languageFilterApplied: false,
      }),
    },
    now: () => 2_000,
    random: () => 0,
    onStarted: () => events.push('monitor'),
  });
  const refreshCount = () => events.filter((event) => event === 'refresh').length;
  return { automation, best, events, persistence, refreshCount, state, storage };
}

describe('Farming automation start', () => {
  test('keeps a stalled favorite suppressed across failed refreshes and re-enables it after confirmation', async () => {
    let refreshFails = true;
    const subject = startFixture(Promise.resolve(), true, () => refreshFails);
    const campaignKey = gameKey(subject.best);

    const suppressed = await subject.automation.suppressCampaignUntilRefresh(campaignKey);
    const failed = await subject.automation.request('periodic');
    const factsAfterFailure = subject.storage.getLocal(
      FARMING_AUTOMATION_FACTS_STORAGE_KEY,
    ) as FarmingAutomationFactsV1;

    expect(suppressed).toBe('suppressed');
    expect(failed).toEqual({ kind: 'failed', reason: 'drops-refresh-failed', retryAt: 122_000 });
    expect(factsAfterFailure.suppressedCampaignKeys).toEqual([campaignKey]);
    expect(subject.state.appState.favoriteGames).toHaveLength(1);
    expect(subject.state.appState.isRunning).toBe(false);

    refreshFails = false;
    const confirmed = await subject.automation.request('periodic');
    const factsAfterSuccess = subject.storage.getLocal(
      FARMING_AUTOMATION_FACTS_STORAGE_KEY,
    ) as FarmingAutomationFactsV1;

    expect(confirmed).toEqual({ kind: 'started', campaignKey, transition: 'start' });
    expect(factsAfterSuccess.suppressedCampaignKeys).toEqual([]);
  });
});
