import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createAutomationEventNotifier } from '../src/background/automation-event-notifier.ts';
import { dismissFarmingMessage } from '../src/background/dismiss-farming-message.ts';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { createNotificationController } from '../src/background/notifications.ts';
import { createWatchHealth } from '../src/background/watch-health.ts';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';
import { farmingMessages } from '../src/shared/farming-messages.ts';
import {
  createDrop,
  createFarmingSessionAdapters,
  createGame,
  createMinimalState,
  createStreamer,
} from './fixtures/queue-management.ts';
import { type ChromeMocks, setupChromeMocks } from './mocks/chrome.ts';

let chrome: ChromeMocks;
beforeEach(() => {
  chrome = setupChromeMocks();
});
afterEach(() => {
  chrome.teardown();
});

function fixture() {
  chrome.tabs.setTabsGetResult({ id: 123, url: 'https://www.twitch.tv/streamer-1' });
  const state = createMinimalState();
  const game = createGame({ campaignId: 'attention-campaign' });
  const drop = createDrop({ campaignId: game.campaignId });
  state.appState.isRunning = true;
  state.appState.notificationsEnabled = true;
  state.appState.selectedGame = game;
  state.appState.activeStreamer = createStreamer();
  state.appState.queue = [game];
  state.appState.tabId = 123;
  state.appState.allDrops = [drop];
  state.appState.pendingDrops = [drop];
  state.appState.currentDrop = drop;
  state.cachedDropsSnapshot = [drop];
  state.lastInventoryRefreshAt = Date.now();
  state.lastProgressAdvanceAt = Date.now();
  state.appState.watchHealth = createWatchHealth(
    'managed-tab',
    'degraded',
    'user-interaction-required',
    Date.now,
  );
  const receipts = new Set<string>();
  const browserAlerts: chrome.notifications.NotificationCreateOptions[] = [];
  const telegramAlerts: string[] = [];
  let rejectBrowser = false;
  const notifications = createNotificationController(state, {
    permissionsApi: { contains: async () => true },
    notificationsApi: {
      create: async (id, options) => {
        if (rejectBrowser) throw new Error('Notification delivery unavailable');
        if (options) browserAlerts.push(options);
        return typeof id === 'string' ? id : 'notification';
      },
    },
    saveState: async () => {},
  });
  const session = () => {
    const notifier = createAutomationEventNotifier({
      notifyBrowser: notifications.notifyAutomation,
      notifyTelegram: async (reason) => {
        telegramAlerts.push(reason);
        return true;
      },
      persistence: {
        hasSeen: (key) => receipts.has(key),
        markSeen: (key) => {
          receipts.add(key);
        },
      },
    });
    return createFarmingSession(
      state,
      createFarmingSessionAdapters({
        automationNotify: notifier.notify,
        watchTransport: {
          start: async () => ({ kind: 'failed', health: null }),
          tick: async () =>
            state.appState.watchHealth ?? createWatchHealth('managed-tab', 'healthy', 'heartbeat', Date.now),
          stop: async () => {},
          setPreference: async () => {},
        },
      }),
    );
  };
  return {
    state,
    session,
    browserAlerts,
    telegramAlerts,
    failBrowser: (fail: boolean) => {
      rejectBrowser = fail;
    },
  };
}

test('the main farming flow keeps the gesture local across ticks and worker reconstruction', async () => {
  const f = fixture();
  await f.session().checkDropProgress();
  const first = farmingMessages(f.state.appState);
  await f.session().checkDropProgress();
  expect(farmingMessages(f.state.appState)).toEqual(first);
  expect(first).toHaveLength(1);
  expect(first[0]).toMatchObject({ kind: 'info', text: expect.stringContaining('Click Play') });
  expect(f.browserAlerts).toEqual([]);
  expect(f.telegramAlerts).toEqual([]);
});

test('dismissal survives popup and worker reconstruction without changing farming intent', async () => {
  const f = fixture();
  const id = farmingMessages(f.state.appState)[0]?.id;
  if (!id) throw new Error('Expected the player indication');
  expect(await dismissFarmingMessage(f.state, id, async () => {})).toEqual({ success: true });
  f.state.appState = normalizeStoredAppState(structuredClone(f.state.appState));
  expect(farmingMessages(f.state.appState)).toEqual([]);
  expect(f.state.appState.isRunning).toBe(true);
  expect(f.state.appState.selectedGame?.campaignId).toBe('attention-campaign');
  expect(f.browserAlerts).toEqual([]);
  expect(f.telegramAlerts).toEqual([]);
});

test('unknown IDs and failed storage cannot hide a farming message', async () => {
  const f = fixture();
  const messages = farmingMessages(f.state.appState);
  expect((await dismissFarmingMessage(f.state, 'unknown', async () => {})).success).toBe(false);
  const id = messages[0]?.id;
  if (!id) throw new Error('Expected the player indication');
  expect(
    (
      await dismissFarmingMessage(f.state, id, async () => {
        throw new Error('Disk unavailable');
      })
    ).success,
  ).toBe(false);
  expect(farmingMessages(f.state.appState)).toEqual(messages);
});

test('verified player start removes the local gesture indication', async () => {
  const f = fixture();
  expect(farmingMessages(f.state.appState)).toHaveLength(1);
  f.state.appState.watchHealth = createWatchHealth('managed-tab', 'healthy', 'heartbeat', Date.now);
  expect(farmingMessages(f.state.appState)).toEqual([]);
});

for (const mode of ['paused', 'stopped', 'recovered'] as const) {
  test(`does not send a player attention alert after farming is ${mode}`, async () => {
    const f = fixture();
    f.state.appState.isPaused = mode === 'paused';
    f.state.appState.isRunning = mode !== 'stopped';
    if (mode === 'recovered') {
      f.state.appState.watchHealth = createWatchHealth('managed-tab', 'healthy', 'heartbeat', Date.now);
      f.state.monitorTickInFlight = true;
      f.state.monitorTickDeadlineAt = Date.now() + 60_000;
    }
    await f.session().checkDropProgress();
    expect(f.browserAlerts).toHaveLength(0);
    expect(f.telegramAlerts).toHaveLength(0);
  });
}
