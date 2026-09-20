import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { FarmingAutomation, FarmingAutomationOutcome } from '../src/background/farming-automation.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerContentHandlers } from '../src/background/service-worker-content-handlers.ts';
import { createFarmingAutomationUserActionHandlers } from '../src/background/service-worker-runtime-wiring.ts';
import { createServiceWorkerSettingsHandlers } from '../src/background/service-worker-settings-handlers.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import { type ChromeMocks, setupChromeMocks } from './mocks/chrome.ts';
import { fixture } from './support/farming-automation-queue-fixture.ts';
import {
  createContentDependencies,
  createSettingsDependencies,
  disabledAutomation,
  game,
} from './support/farming-automation-runtime-wiring-fixture.ts';
import './cases/farming-automation-runtime-wiring-session-recovery.ts';

describe('farming automation runtime wiring', () => {
  let chromeMocks: ChromeMocks;

  beforeEach(() => {
    chromeMocks = setupChromeMocks();
  });

  afterEach(() => {
    chromeMocks.teardown();
  });

  test('snoozes automatic favorites when the user pauses or stops an automatic session', async () => {
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

    // Then: the next automatic evaluation cannot undo the explicit user action.
    expect(calls).toEqual(['snooze:manual-pause', 'pause', 'snooze:manual-stop', 'stop']);
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

  test('clears a manual stop snooze for a newly added favorite when auto-start is enabled', async () => {
    // Given: a stopped automatic session and a campaign which is not yet a favorite.
    const state = createServiceWorkerState();
    state.appState.autoStartFavoriteGames = true;
    state.appState.availableGames = [game];
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

    // When: the user marks that campaign as a favorite.
    const result = await settings.handleSetGamePreference({ game, preference: 'favorite' });

    // Then: the explicit new favorite clears only the Stop gate and requests fresh planning.
    expect({ calls, result: result.success, favoriteCount: state.appState.favoriteGames.length }).toEqual({
      calls: ['clear-snooze', 'request:campaign-refresh'],
      result: true,
      favoriteCount: 1,
    });
  });

  test('stars a pristine campaign through authoritative refresh, favorite queueing, and start', async () => {
    // Given: a pristine state with favorite auto-start enabled and no cached campaign catalog.
    const subject = fixture('priority-list-only', { favoriteInState: false, queue: [] });
    const state = subject.state;
    const calls: string[] = [];
    const automation = subject.automation;
    const originalRequest = automation.request;
    const wrappedAutomation: FarmingAutomation = {
      ...automation,
      request: async (trigger) => {
        calls.push(`automation:${trigger}`);
        return originalRequest(trigger);
      },
      clearSnooze: async () => {
        calls.push('clear-snooze');
        return (await automation.clearSnooze?.()) ?? 'cleared';
      },
    };
    const dependencies = {
      ...createSettingsDependencies(wrappedAutomation),
      requestActivationSync: async (trigger: 'favorite-change') => {
        calls.push(`activation:${trigger}`);
        await wrappedAutomation.request('campaign-refresh');
        return { kind: 'synced' as const, campaignCount: 1 };
      },
    };
    const settings = createServiceWorkerSettingsHandlers(state, dependencies);

    // When: the user stars the campaign from the pristine popup catalog.
    const result = await settings.handleSetGamePreference({ game: subject.favorite, preference: 'favorite' });

    // Then: the favorite persists, the authoritative sync runs, and farming starts without Add/Start.
    expect({
      calls,
      result,
      favoriteCount: state.appState.favoriteGames.length,
      queue: state.appState.queue,
      isRunning: state.appState.isRunning,
    }).toEqual({
      calls: ['clear-snooze', 'activation:favorite-change', 'automation:campaign-refresh'],
      result: {
        success: true,
        preference: 'favorite',
        removedQueueEntries: 0,
        retainedQueueEntries: 0,
        autoStart: { status: 'started' },
      },
      favoriteCount: 1,
      queue: [subject.favorite],
      isRunning: true,
    });
  });

  test('keeps a starred favorite queued during manual viewing and starts after it ends', async () => {
    let now = 2_000;
    let manualActive = true;
    const subject = fixture('priority-list-only', {
      favoriteInState: false,
      manualActive: () => manualActive,
      now: () => now,
      queue: [],
    });
    const settings = createServiceWorkerSettingsHandlers(subject.state, {
      ...createSettingsDependencies(subject.automation),
      requestActivationSync: async () => {
        subject.state.appState.availableGames = [subject.manual, subject.favorite];
        await subject.automation.request('campaign-refresh');
        return { kind: 'synced', campaignCount: 2 };
      },
    });

    const waiting = await settings.handleSetGamePreference({
      game: subject.favorite,
      preference: 'favorite',
    });
    manualActive = false;
    now = subject.state.appState.nextAutomationCheckAt ?? 32_000;
    const started = await subject.automation.request('periodic');

    expect({
      waiting: waiting.autoStart,
      queued: subject.state.appState.queue.map(gameKey),
      started,
      selected: subject.state.appState.selectedGame ? gameKey(subject.state.appState.selectedGame) : null,
    }).toEqual({
      waiting: { status: 'queued', reason: 'manual-watch', retryAt: 32_000 },
      queued: [gameKey(subject.favorite)],
      started: { kind: 'started', campaignKey: gameKey(subject.favorite), transition: 'start' },
      selected: gameKey(subject.favorite),
    });
  });

  test('does not reconcile a newly added favorite while auto-start is disabled', async () => {
    // Given: favorite automation is disabled, including its parked-queue recovery exception.
    const state = createServiceWorkerState();
    state.appState.autoStartFavoriteGames = false;
    state.appState.availableGames = [game];
    const calls: string[] = [];
    const automation: FarmingAutomation = {
      request: async (trigger) => {
        calls.push(`request:${trigger}`);
        return { kind: 'unchanged', reason: 'disabled' };
      },
      snooze: async () => 'snoozed',
    };
    const settings = createServiceWorkerSettingsHandlers(state, createSettingsDependencies(automation));

    // When: the user favorites a campaign.
    const result = await settings.handleSetGamePreference({ game, preference: 'favorite' });

    // Then: preference persistence changes, while the queue planner is not invoked.
    expect({
      calls,
      favoriteCount: state.appState.favoriteGames.length,
      autoStart: result.autoStart,
    }).toEqual({
      calls: [],
      favoriteCount: 1,
      autoStart: { status: 'disabled' },
    });
  });

  test('reports the newly starred category instead of another favorite already farming', async () => {
    const state = createServiceWorkerState();
    const other = { ...game, id: 'other', campaignId: 'other-campaign', name: 'Other Game' };
    state.appState.isRunning = true;
    state.appState.selectedGame = other;
    state.appState.favoriteGames = [{ gameId: other.id, lastKnownName: other.name, addedAt: 1 }];
    const automation = disabledAutomation();
    const settings = createServiceWorkerSettingsHandlers(state, {
      ...createSettingsDependencies(automation),
      requestActivationSync: async () => ({ kind: 'synced', campaignCount: 1 }),
    });

    const result = await settings.handleSetGamePreference({ game, preference: 'favorite' });

    expect(result.autoStart).toEqual({ status: 'waiting', reason: 'campaign-data' });
  });

  test('reports session recovery before stale queue availability', async () => {
    const state = createServiceWorkerState();
    state.appState.queue = [game];
    const automation = disabledAutomation();
    const settings = createServiceWorkerSettingsHandlers(state, {
      ...createSettingsDependencies(automation),
      requestActivationSync: async () => ({ kind: 'needs-session', errorKind: 'session' }),
    });

    const result = await settings.handleSetGamePreference({ game, preference: 'favorite' });

    expect(result.autoStart).toEqual({ status: 'waiting', reason: 'session' });
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

  test('preserves a newly added favorite when authoritative auto-start sync fails', async () => {
    const state = createServiceWorkerState();
    state.appState.autoStartFavoriteGames = true;
    const automation = disabledAutomation();
    const settings = createServiceWorkerSettingsHandlers(state, {
      ...createSettingsDependencies(automation),
      requestActivationSync: async () => {
        throw new Error('offline');
      },
    });

    const result = await settings.handleSetGamePreference({ game, preference: 'favorite' });

    expect(result).toEqual({
      success: true,
      preference: 'favorite',
      removedQueueEntries: 0,
      retainedQueueEntries: 0,
      autoStart: { status: 'waiting', reason: 'refresh-failed' },
    });
    expect(state.appState.favoriteGames).toHaveLength(1);
    expect(state.appState.favoriteGames[0]?.identityKeys).toContain('game-1');
  });

  test('keeps the saved favorite when clearing the old snooze cannot be persisted', async () => {
    const state = createServiceWorkerState();
    const automation: FarmingAutomation = {
      ...disabledAutomation(),
      clearSnooze: async () => 'persistence-failed',
    };
    const settings = createServiceWorkerSettingsHandlers(state, {
      ...createSettingsDependencies(automation),
      requestActivationSync: async () => ({ kind: 'needs-session', errorKind: 'session' }),
    });

    const result = await settings.handleSetGamePreference({ game, preference: 'favorite' });

    expect(result).toMatchObject({
      success: true,
      preference: 'favorite',
      autoStart: { status: 'waiting', reason: 'session' },
    });
    expect(state.appState.favoriteGames).toHaveLength(1);
  });
});
