import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { FarmingAutomation, FarmingAutomationOutcome } from '../src/background/farming-automation.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerContentHandlers } from '../src/background/service-worker-content-handlers.ts';
import { createFarmingAutomationUserActionHandlers } from '../src/background/service-worker-runtime-wiring.ts';
import { createServiceWorkerSettingsHandlers } from '../src/background/service-worker-settings-handlers.ts';
import { type ChromeMocks, setupChromeMocks } from './mocks/chrome.ts';
import {
  createContentDependencies,
  createSettingsDependencies,
  disabledAutomation,
  game,
} from './support/farming-automation-runtime-wiring-fixture.ts';

describe('farming automation runtime wiring', () => {
  let chromeMocks: ChromeMocks;

  beforeEach(() => {
    chromeMocks = setupChromeMocks();
  });

  afterEach(() => {
    chromeMocks.teardown();
  });

  test('does not snooze automatic favorites when the user pauses or stops an automatic session', async () => {
    // Given: automatic favorites remain enabled while a session receives user transport controls.
    const calls: string[] = [];
    const handlers = createFarmingAutomationUserActionHandlers(
      {
        request: async () => ({ kind: 'unchanged', reason: 'disabled' }),
        snooze: async (reason) => {
          calls.push(`snooze:${reason}`);
          return 'snoozed';
        },
      },
      {
        automaticFavoritesEnabled: () => true,
        handlePauseFarming: async () => {
          calls.push('pause');
          return { success: true };
        },
        handleResumeFarming: async () => ({ success: true }),
        handleStopFarming: async () => {
          calls.push('stop');
          return { success: true };
        },
      },
    );

    // When: Pause and Stop are invoked through their public runtime handlers.
    await handlers.pauseFarming();
    await handlers.stopFarming();

    // Then: they stop the current transport without suppressing the next favorite evaluation.
    expect(calls).toEqual(['pause', 'stop']);
  });

  test('clears a previous manual snooze when auto-start is enabled again', async () => {
    // Given: auto-start was disabled after a manual stop and its snooze is still persisted.
    const state = createServiceWorkerState();
    state.appState.autoStartFavoriteGames = false;
    const calls: string[] = [];
    const automation: FarmingAutomation = {
      request: async (trigger) => {
        calls.push(`request:${trigger}`);
        return { kind: 'unchanged', reason: 'no-eligible-campaign' };
      },
      snooze: async () => 'snoozed',
      clearSnooze: async () => {
        calls.push('clear-snooze');
        return 'cleared';
      },
    };
    const settings = createServiceWorkerSettingsHandlers(state, createSettingsDependencies(automation));

    // When: the user re-enables favorite auto-start.
    const result = await settings.handleSetAutoStartFavorites({ enabled: true });

    // Then: the prior manual stop cannot remain an invisible gate.
    expect({ calls, result, enabled: state.appState.autoStartFavoriteGames }).toEqual({
      calls: ['clear-snooze', 'request:campaign-refresh'],
      result: { success: true, autoStartFavoriteGames: true },
      enabled: true,
    });
  });

  test('keeps favorite auto-start enabled when browser notifications are disabled', async () => {
    const state = createServiceWorkerState();
    state.appState.autoStartFavoriteGames = true;
    const dependencies = createSettingsDependencies(disabledAutomation());
    dependencies.notificationController.setNotificationsEnabled = async () => ({
      success: true,
      notificationsEnabled: false,
    });
    const handlers = createServiceWorkerSettingsHandlers(state, dependencies);

    const result = await handlers.handleSetNotificationsEnabled({ enabled: false });

    expect(result).toEqual({ success: true, notificationsEnabled: false });
    expect(state.appState.autoStartFavoriteGames).toBe(true);
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

  test('keeps a hidden game persisted when the follow-up automation refresh rejects', async () => {
    const state = createServiceWorkerState();
    state.appState.availableGames = [game];
    const automation: FarmingAutomation = {
      request: async () => {
        throw new Error('automation unavailable');
      },
      snooze: async () => 'snoozed',
    };
    const settings = createServiceWorkerSettingsHandlers(state, createSettingsDependencies(automation));

    const result = await settings.handleSetGamePreference({ game, preference: 'hidden' });

    expect(result).toEqual({
      success: true,
      preference: 'hidden',
      removedQueueEntries: 0,
      retainedQueueEntries: 0,
    });
    expect(state.appState.hiddenGames).toHaveLength(1);
    expect(state.appState.hiddenGames[0]?.identityKeys).toContain('game-1');
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
