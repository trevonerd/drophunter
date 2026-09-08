import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { stopForSignInRequiredIfRunning } from '../../src/background/api-drops-wrapper.ts';
import { createFarmingSession } from '../../src/background/farming-session.ts';
import { createServiceWorkerTwitchGateway } from '../../src/background/service-worker-twitch-gateway.ts';
import {
  createAfkAdapters as createAdapters,
  createAfkState as createState,
  afkDrop as drop,
  healthyWatch,
  expiredTwitchSession as twitchSession,
} from '../fixtures/afk-auth-recovery.ts';
import { type ChromeMocks, setupChromeMocks } from '../mocks/chrome.ts';

describe('AFK Twitch authentication recovery', () => {
  let chromeMocks: ChromeMocks;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    chromeMocks = setupChromeMocks();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    chromeMocks.teardown();
  });

  test('blocks once when neither cached reward nor watch transport can continue', async () => {
    const state = createState();
    state.appState.currentDrop = null;
    state.appState.pendingDrops = [];
    state.appState.allDrops = [];
    state.appState.activeStreamer = null;
    state.appState.tabId = null;
    state.appState.watchHealth = null;
    state.cachedDropsSnapshot = [];
    state.twitchSessionCache = { ...twitchSession, clientIntegrity: 'existing-integrity-token' };
    let notifications = 0;
    let transportStops = 0;
    chromeMocks.chrome.tabs.query = async () => [];
    chromeMocks.chrome.tabs.create = async (properties) => ({
      id: 89,
      windowId: 1,
      status: 'complete',
      ...properties,
    });
    chromeMocks.chrome.tabs.get = async (tabId) => ({ id: tabId, windowId: 1, status: 'complete' });
    chromeMocks.chrome.tabs.sendMessage = async () => ({ success: false });
    chromeMocks.chrome.tabs.remove = async () => {};
    globalThis.fetch = async () => {
      throw new Error('401 invalid oauth token');
    };
    const farmingSession = createFarmingSession(
      state,
      createAdapters({
        notify: async () => {
          notifications += 1;
        },
        watchTransport: {
          start: async () => healthyWatch(),
          tick: async () => healthyWatch(),
          stop: async () => {
            transportStops += 1;
          },
          setPreference: async () => {},
        },
      }),
    );
    const gateway = createServiceWorkerTwitchGateway(state, {
      recoverTwitchSession: (options) =>
        options.stopReason ? farmingSession.stop(options) : farmingSession.recoverTwitchSession(),
    });

    await gateway.fetchInventorySnapshot([drop], { sessionRecoveryMode: 'background-tab' });

    expect(state.appState.isRunning).toBe(false);
    expect(state.appState.lastStopReason).toBe('sign-in-required');
    expect(state.appState.twitchSessionSyncState.status).toBe('blocked');
    expect(transportStops).toBe(1);
    expect(notifications).toBe(1);
  });

  test('blocks after explicit auth recovery fails when cached rewards have no active transport', async () => {
    const state = createState();
    state.appState.activeStreamer = null;
    state.appState.tabId = null;
    state.appState.watchHealth = null;
    let stopOptions: { stopReason?: string; stopMessage?: string | null } | null = null;

    await stopForSignInRequiredIfRunning(state, async (options) => {
      stopOptions = options;
    });

    expect(stopOptions?.stopReason).toBe('sign-in-required');
    expect(state.appState.twitchSessionSyncState.status).toBe('blocked');
  });

  test('delivers sign-in-required once through the common notifier', async () => {
    const state = createState();
    const automaticEvents: Array<{ event: string; transitionId: string; message: string }> = [];
    let legacyNotifications = 0;
    const farmingSession = createFarmingSession(
      state,
      createAdapters({
        notify: async () => {
          legacyNotifications += 1;
        },
        telegramSystemAlert: async () => {
          legacyNotifications += 1;
        },
        automationNotify: async (notification) => {
          automaticEvents.push(notification);
        },
      }),
    );

    await farmingSession.stop({
      notification: { title: 'Sign-in required', message: 'Please sign in to Twitch.' },
      stopReason: 'sign-in-required',
      stopMessage: 'Please sign in to Twitch.',
    });

    expect(legacyNotifications).toBe(0);
    expect(automaticEvents).toEqual([
      {
        event: 'sign-in-required',
        transitionId: 'sign-in-required:campaign-1:0',
        message: 'Please sign in to Twitch.',
        campaignId: 'campaign-1',
        title: 'Sign-in required',
        telegramReason: 'sign-in-required',
      },
    ]);
  });
});
