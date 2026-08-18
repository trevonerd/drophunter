import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { FarmingAutomation, FarmingAutomationOutcome } from '../src/background/farming-automation.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerContentHandlers } from '../src/background/service-worker-content-handlers.ts';
import { createServiceWorkerSettingsHandlers } from '../src/background/service-worker-settings-handlers.ts';
import type { TwitchGame } from '../src/types/index.ts';
import { type ChromeMocks, setupChromeMocks } from './mocks/chrome.ts';

const game: TwitchGame = {
  id: 'game-1',
  campaignId: 'campaign-1',
  name: 'Game One',
  imageUrl: 'https://example.test/game.png',
  dropCount: 1,
};

function createSettingsDependencies(automation: FarmingAutomation) {
  return {
    automation,
    browserEvents: {
      watchTransport: {
        setPreference: async () => undefined,
        start: async () => ({ kind: 'started' as const }),
        stop: async () => undefined,
      },
    },
    notificationController: {
      setNotificationsEnabled: async () => ({ success: true, notificationsEnabled: true }),
    },
    stateLifecycle: {
      awaitInitialization: async () => undefined,
      trackActivity: async () => undefined,
    },
    telegramNotifier: {
      sendTestAlert: async () => ({ success: true }),
      setTelegramAlertsEnabled: async () => ({ success: true, telegramAlertsEnabled: true }),
      setTelegramCredentials: async () => ({ success: true, configured: true, chatId: '1' }),
    },
  };
}

function createContentDependencies(
  automation: FarmingAutomation,
  resumeAfterAuthRecovery: () => Promise<void> = async () => undefined,
) {
  return {
    automation,
    farmingSession: { resumeAfterAuthRecovery, stop: async () => undefined },
    notify: async () => undefined,
    stateLifecycle: {
      awaitInitialization: async () => undefined,
      ensureStateHydratedForCache: async () => undefined,
      getInitPromise: () => null,
      trackActivity: async () => undefined,
    },
    twitchGateway: {
      ensureContentScriptOnTab: async () => undefined,
      fetchDropsSnapshot: async () => null,
      persistSessionFromDropsPage: async () => null,
      shouldRefreshCampaignsAfterSessionSync: () => false,
    },
  };
}

function disabledAutomation(): FarmingAutomation {
  return {
    request: async () => ({ kind: 'unchanged', reason: 'disabled' }),
    snooze: async () => 'snoozed',
  };
}

describe('farming automation runtime wiring', () => {
  let chromeMocks: ChromeMocks;

  beforeEach(() => {
    chromeMocks = setupChromeMocks();
  });

  afterEach(() => {
    chromeMocks.teardown();
  });

  test('maps all runtime automation sources exhaustively', async () => {
    // Given runtime handlers that can use only the Farming automation public interface.
    const triggers: string[] = [];
    const userOutcomes: FarmingAutomationOutcome[] = [
      { kind: 'started', campaignKey: 'campaign-1', transition: 'start' },
      { kind: 'unchanged', reason: 'no-eligible-campaign' },
      { kind: 'failed', reason: 'drops-refresh-failed' },
    ];
    const automation: FarmingAutomation = {
      request: async (trigger) => {
        triggers.push(trigger);
        return trigger === 'user-request'
          ? (userOutcomes.shift() ?? { kind: 'unchanged', reason: 'no-eligible-campaign' })
          : { kind: 'unchanged', reason: 'disabled' };
      },
      snooze: async () => 'snoozed',
    };
    const settings = createServiceWorkerSettingsHandlers(
      createServiceWorkerState(),
      createSettingsDependencies(automation),
    );
    const content = createServiceWorkerContentHandlers(
      createServiceWorkerState(),
      createContentDependencies(automation),
    );

    // When every campaign-setting source, UPDATE_GAMES, and each explicit outcome runs once.
    await settings.handleSetGameFavorite({ game, favorite: true });
    await settings.handleSetCampaignPriorityMode({ mode: 'ending-soonest' });
    await settings.handleSetFarmCategoryScope({ scope: 'all' });
    await settings.handleSetAutoStartFavorites({ enabled: true });
    await content.handleUpdateGames([game]);
    const explicitResponses = [
      await settings.handleEvaluateAutoStart(),
      await settings.handleEvaluateAutoStart(),
      await settings.handleEvaluateAutoStart(),
    ];

    // Then each source maps once and the discriminated outcomes retain their response semantics.
    expect(triggers).toEqual([
      'campaign-refresh',
      'campaign-refresh',
      'campaign-refresh',
      'campaign-refresh',
      'campaign-refresh',
      'user-request',
      'user-request',
      'user-request',
    ]);
    expect(explicitResponses).toEqual([
      { success: true, started: true, reason: 'Campaign started automatically.' },
      { success: true, started: false, reason: 'no-eligible-campaign' },
      { success: false, started: false, error: 'drops-refresh-failed' },
    ]);
  });

  test('resumes a farming session stopped by an older authentication flow', async () => {
    const state = createServiceWorkerState();
    state.appState.selectedGame = game;
    state.appState.queue = [game];
    state.appState.lastStopReason = 'sign-in-required';
    state.apiConsecutiveFailures = 3;
    state.apiBackoffUntil = Date.now() + 60_000;
    let resumeCalls = 0;
    const content = createServiceWorkerContentHandlers(
      state,
      createContentDependencies(disabledAutomation(), async () => {
        resumeCalls += 1;
        state.appState.isRunning = true;
      }),
    );
    const sender: chrome.runtime.MessageSender = {
      url: 'https://www.twitch.tv/drops/campaigns',
    };

    const result = await content.handleSyncTwitchSession(
      {
        oauthToken: 'fresh-token-with-enough-length',
        userId: 'viewer-1',
        deviceId: 'device-1',
        uuid: 'uuid-1',
      },
      sender,
    );

    expect(result).toEqual({ success: true });
    expect(resumeCalls).toBe(1);
    expect(state.appState.isRunning).toBe(true);
    expect(state.appState.lastStopReason).toBeNull();
    expect(state.apiBackoffUntil).toBe(0);
  });

  test('does not resume a manually stopped session after Twitch sync', async () => {
    const state = createServiceWorkerState();
    state.appState.selectedGame = game;
    state.appState.queue = [game];
    state.appState.lastStopReason = 'user-stop';
    let resumeCalls = 0;
    const content = createServiceWorkerContentHandlers(
      state,
      createContentDependencies(disabledAutomation(), async () => {
        resumeCalls += 1;
      }),
    );
    const sender: chrome.runtime.MessageSender = {
      url: 'https://www.twitch.tv/drops/campaigns',
    };

    const result = await content.handleSyncTwitchSession(
      {
        oauthToken: 'fresh-token-with-enough-length',
        userId: 'viewer-1',
        deviceId: 'device-1',
        uuid: 'uuid-1',
      },
      sender,
    );

    expect(result).toEqual({ success: true });
    expect(resumeCalls).toBe(0);
    expect(state.appState.lastStopReason).toBe('user-stop');
  });
});
