import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createFarmingSessionContext } from '../src/background/farming-session-context.ts';
import { createFarmingSessionHandlers } from '../src/background/farming-session-handlers.ts';
import { createNotificationController } from '../src/background/notifications.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerSettingsHandlers } from '../src/background/service-worker-settings-handlers.ts';
import { saveState } from '../src/background/state-persistence.ts';
import { createTelegramNotifier } from '../src/background/telegram-notifications.ts';
import { createInactiveWatchHealth } from '../src/background/watch-transport-state.ts';
import { createFarmingSessionAdapters, createGame } from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { createDeferred } from './support/farming-automation-fixtures.ts';

let mocks: ReturnType<typeof setupChromeMocks>;
beforeEach(() => {
  mocks = setupChromeMocks();
});
afterEach(() => {
  mocks.teardown();
});

function createSettings(state = createServiceWorkerState()) {
  const handlers = createServiceWorkerSettingsHandlers(state, {
    stateLifecycle: { trackActivity: async () => {}, awaitInitialization: async () => {} },
    notificationController: createNotificationController(state, {
      saveState: (enabled, isCurrent = () => true) =>
        saveState(state, {
          updateAppState: (appState) =>
            isCurrent() ? { ...appState, notificationsEnabled: enabled } : appState,
        }),
    }),
    telegramNotifier: createTelegramNotifier(state, {
      saveState: (enabled, isCurrent = () => true) =>
        saveState(state, {
          updateAppState: (appState) =>
            isCurrent() ? { ...appState, telegramAlertsEnabled: enabled } : appState,
        }),
      loadCredentials: async () => null,
      saveCredentials: async () => {},
    }),
    automation: {
      request: async () => ({ kind: 'unchanged', reason: 'disabled' }),
      suppressCampaignUntilRefresh: async () => 'suppressed',
    },
    browserEvents: {
      watchTransport: {
        setPreference: async () => {},
        start: async () => ({ kind: 'cancelled' }),
        stop: async () => {},
        tick: async () => createInactiveWatchHealth(null, 'managed-tab', Date.now()),
        adopt: () => {},
        currentOwnership: () => null,
        currentTarget: () => null,
        restore: async () => false,
        prepare: async () => ({ kind: 'failed', reason: 'candidate-unavailable' }),
      },
    },
  });
  return { state, handlers };
}

test('failed preference write retains the accepted monitor preference', async () => {
  const { state, handlers } = createSettings();
  state.appState.monitorAutoOpen = false;
  mocks.storage.local.set = async () => {
    throw new Error('storage unavailable');
  };
  await expect(handlers.handleSetMonitorAutoOpen({ enabled: true })).rejects.toThrow('storage unavailable');
  expect(state.appState.monitorAutoOpen).toBe(false);
});

test('failed settings writes retain preferences and manual Pause authorization', async () => {
  const { state, handlers } = createSettings();
  state.appState.isPaused = true;
  state.appState.autoStartFavoriteGames = false;
  state.appState.autoClaimDrops = false;
  state.appState.autoClaimChannelPointsBonus = false;
  state.appState.muteFarmingTab = false;
  const accepted = structuredClone(state.appState);
  mocks.storage.local.set = async () => {
    throw new Error('storage unavailable');
  };
  const changes = [
    () => handlers.handleSetMuteFarmingTab({ enabled: true }),
    () => handlers.handleSetAutoClaimDrops({ enabled: true }),
    () => handlers.handleSetAutoClaimChannelPointsBonus({ enabled: true }),
    () => handlers.handleSetStreamerSelectionMode({ mode: 'top-viewers' }),
    () => handlers.handleSetPreferredStreamerLanguage({ language: 'it' }),
    () => handlers.handleSetTelegramSystemAlertsEnabled({ enabled: !accepted.telegramSystemAlertsEnabled }),
    () => handlers.handleSetCampaignPriorityMode({ mode: 'priority-list-only' }),
    () => handlers.handleSetFarmCategoryScope({ scope: 'favorites-only' }),
    () => handlers.handleSetGamePreference({ game: createGame(), preference: 'favorite' }),
    () => handlers.handleSetAutoStartFavorites({ enabled: true }),
  ];
  for (const change of changes) {
    await expect(change()).rejects.toThrow('storage unavailable');
    expect(state.appState).toEqual(accepted);
  }
});

test('failed optional alert writes cannot enable notification delivery', async () => {
  const { state, handlers } = createSettings();
  mocks.permissions.setContainsResult(true);
  mocks.storage.local.set = async () => {
    throw new Error('storage unavailable');
  };
  await expect(handlers.handleSetNotificationsEnabled({ enabled: true })).rejects.toThrow(
    'storage unavailable',
  );
  expect(state.appState.notificationsEnabled).toBe(false);
  await expect(handlers.handleSetTelegramAlertsEnabled({ enabled: true })).rejects.toThrow(
    'storage unavailable',
  );
  expect(state.appState.telegramAlertsEnabled).toBe(false);
});

test.each([true, false])(
  'Telegram toggle %s reports the accepted flag after a newer toggle',
  async (enabled) => {
    const { state, handlers } = createSettings();
    state.appState.telegramAlertsEnabled = !enabled;
    mocks.permissions.setContainsResult(true);
    const gate = holdNextAppStateWrite();
    const pending = handlers.handleSetTelegramAlertsEnabled({ enabled });
    await gate.entered.promise;
    state.optionalPermissionRevisions.telegramAlertsEnabled += 1;
    const newer = handlers.handleSetTelegramAlertsEnabled({ enabled: !enabled });
    gate.release.resolve(undefined);
    await expect(pending).resolves.toEqual({ success: true, telegramAlertsEnabled: !enabled });
    await expect(newer).resolves.toEqual({ success: true, telegramAlertsEnabled: !enabled });
    expect(state.appState.telegramAlertsEnabled).toBe(!enabled);
  },
);

test('watch source changes require a durable preference write', async () => {
  const { state, handlers } = createSettings();
  state.appState.watchTransportPreference = 'managed-tab';
  mocks.storage.local.set = async () => {
    throw new Error('storage unavailable');
  };
  await expect(handlers.handleSetWatchTransportMode({ mode: 'tabless' })).rejects.toThrow(
    'storage unavailable',
  );
  expect(state.appState.watchTransportPreference).toBe('managed-tab');
});

function createSession(state: ReturnType<typeof createServiceWorkerState>) {
  const context = createFarmingSessionContext(state, createFarmingSessionAdapters({ saveState }));
  context.transitionCampaign = async () => ({ kind: 'cancelled' });
  return createFarmingSessionHandlers(context, {
    onEnsureWorkspace: async () => {},
    onRefreshDropsData: async () => {},
    onAdvanceQueueIfCompleted: async () => false,
    onAcquireStreamer: async () => true,
    onStartMonitoring: () => {},
    onStopMonitoring: () => {},
  });
}

function holdNextAppStateWrite() {
  const entered = createDeferred<void>();
  const release = createDeferred<void>();
  const set = mocks.storage.local.set;
  let first = true;
  mocks.storage.local.set = async (value) => {
    if (value.appState && first) {
      first = false;
      const snapshot = structuredClone(value);
      entered.resolve(undefined);
      await release.promise;
      await set(snapshot);
    } else await set(value);
  };
  return { entered, release };
}

test('a preference saved during Start survives live and durable queue publication', async () => {
  const { state, handlers } = createSettings();
  const session = createSession(state);
  const gate = holdNextAppStateWrite();
  const game = createGame({ campaignId: 'campaign-1' });
  const start = session.handleStartFarming({ game });
  await gate.entered.promise;
  const toggle = handlers.handleSetMonitorAutoOpen({ enabled: false });
  await Promise.resolve();
  await Promise.resolve();
  gate.release.resolve(undefined);
  await expect(start).resolves.toEqual({ success: true });
  await expect(toggle).resolves.toEqual({ success: true, monitorAutoOpen: false });
  expect(state.appState.monitorAutoOpen).toBe(false);
  expect(state.appState.manualQueueAuthorized).toBe(true);
  expect(mocks.storage.local._store.get('appState')).toMatchObject({
    monitorAutoOpen: false,
    manualQueueAuthorized: true,
    selectedGame: game,
  });
});

test('Start preserves preferences whose earlier storage write is still pending', async () => {
  const { state, handlers } = createSettings();
  const session = createSession(state);
  const gate = holdNextAppStateWrite();
  const toggle = handlers.handleSetMonitorAutoOpen({ enabled: false });
  await gate.entered.promise;
  const game = createGame({ campaignId: 'campaign-1' });
  const start = session.handleStartFarming({ game });
  await Promise.resolve();
  await Promise.resolve();
  gate.release.resolve(undefined);
  await Promise.all([start, toggle]);
  expect(state.appState.monitorAutoOpen).toBe(false);
  expect(mocks.storage.local._store.get('appState')).toMatchObject({
    monitorAutoOpen: false,
    manualQueueAuthorized: true,
    selectedGame: game,
  });
});

test.each(['Pause', 'Stop'] as const)(
  'favorite automation enable retains a newer manual %s',
  async (action) => {
    const { state, handlers } = createSettings();
    state.appState.autoStartFavoriteGames = false;
    state.appState.isRunning = true;
    state.appState.manualQueueAuthorized = true;
    const session = createSession(state);
    const gate = holdNextAppStateWrite();
    const toggle = handlers.handleSetAutoStartFavorites({ enabled: true });
    await gate.entered.promise;
    const control = action === 'Pause' ? session.handlePauseFarming() : session.handleStopFarming();
    await Promise.resolve();
    await Promise.resolve();
    gate.release.resolve(undefined);
    await Promise.all([toggle, control]);
    expect(state.appState.autoStartFavoriteGames).toBe(true);
    const expected =
      action === 'Pause'
        ? { isPaused: true, manualQueueAuthorized: true }
        : { isRunning: false, lastStopReason: 'user-stop', manualQueueAuthorized: false };
    expect(state.appState).toMatchObject(expected);
    expect(mocks.storage.local._store.get('appState')).toMatchObject(expected);
  },
);
