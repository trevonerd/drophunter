import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createFarmingSession } from '../../src/background/farming-session.ts';
import { createServiceWorkerTwitchGateway } from '../../src/background/service-worker-twitch-gateway.ts';
import type { TwitchSession } from '../../src/background/twitch-api/types.ts';
import {
  createAfkAdapters as createAdapters,
  createAfkState as createState,
  afkDrop as drop,
  healthyWatch,
  afkStreamer as streamer,
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

  test('keeps a transient inventory network failure silent before a confirmed stall', async () => {
    const state = createState();
    state.twitchSessionCache = { ...twitchSession, clientIntegrity: 'existing-integrity-token' };
    let createCalls = 0;
    let recoveryRequests = 0;
    chromeMocks.chrome.tabs.query = async (queryInfo) =>
      'windowId' in queryInfo ? [{ id: 999 }, { id: 1000 }] : [];
    chromeMocks.chrome.tabs.create = async () => {
      createCalls += 1;
      return { id: 999, windowId: 1, status: 'complete' };
    };

    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        throw new TypeError('Network request failed');
      }
      return new Response(
        JSON.stringify({
          data: {
            currentUser: {
              inventory: { dropCampaignsInProgress: [], gameEventDrops: [] },
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };
    const gateway = createServiceWorkerTwitchGateway(state, {
      recoverTwitchSession: async () => {
        recoveryRequests += 1;
      },
    });

    await gateway.fetchInventorySnapshot([drop]);

    expect(createCalls).toBe(0);
    expect(state.twitchSessionCache).toEqual({
      ...twitchSession,
      clientIntegrity: 'existing-integrity-token',
    });
    expect(fetchCalls).toBe(1);
    expect(recoveryRequests).toBe(0);
    expect(state.apiBackoffUntil).toBeGreaterThan(Date.now());
    expect(state.appState.isRunning).toBe(true);
  });

  test('recovers a stalled inventory refresh through one existing Twitch tab', async () => {
    const state = createState();
    state.twitchSessionCache = { ...twitchSession, clientIntegrity: 'existing-integrity-token' };
    const refreshedSession: TwitchSession = {
      oauthToken: 'refreshed-oauth-token-with-valid-length',
      userId: '123456789',
      deviceId: 'refreshed-device-id',
      uuid: 'refreshed-uuid',
      clientIntegrity: 'refreshed-integrity-token',
    };
    const createdTabs: Array<{ url?: string; active?: boolean }> = [];
    const removedTabs: number[] = [];
    chromeMocks.chrome.tabs.query = async () => [
      { id: 77, url: 'https://www.twitch.tv/drops/inventory', active: false },
    ];
    chromeMocks.chrome.tabs.create = async (properties) => {
      createdTabs.push(properties);
      return { id: 77, windowId: 1, status: 'complete', ...properties };
    };
    chromeMocks.chrome.tabs.get = async (tabId) => ({ id: tabId, windowId: 1, status: 'complete' });
    chromeMocks.chrome.tabs.sendMessage = async () => ({ success: true, session: refreshedSession });
    chromeMocks.chrome.tabs.remove = async (tabId) => {
      removedTabs.push(tabId);
    };
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) throw new Error('401 invalid oauth token');
      return new Response(
        JSON.stringify({
          data: {
            currentUser: {
              inventory: { dropCampaignsInProgress: [], gameEventDrops: [] },
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };
    let recoveryRequests = 0;
    const gateway = createServiceWorkerTwitchGateway(state, {
      recoverTwitchSession: async () => {
        recoveryRequests += 1;
      },
    });

    await gateway.fetchInventorySnapshot([drop], { sessionRecoveryMode: 'background-tab' });

    expect(createdTabs).toEqual([]);
    expect(removedTabs).toEqual([]);
    expect(fetchCalls).toBe(2);
    expect(recoveryRequests).toBe(0);
    expect(state.twitchSessionCache).toMatchObject(refreshedSession);
    expect(state.appState.isRunning).toBe(true);
  });

  test('blocks after invalid OAuth remains unresolved by existing Twitch tabs', async () => {
    const state = createState();
    state.twitchSessionCache = { ...twitchSession, clientIntegrity: 'existing-integrity-token' };
    let createdTabs = 0;
    let removedTabs = 0;
    let notifications = 0;
    let systemAlerts = 0;
    let transportStops = 0;
    chromeMocks.chrome.tabs.query = async () => [];
    chromeMocks.chrome.tabs.create = async (properties) => {
      createdTabs += 1;
      return { id: 88, windowId: 1, status: 'complete', ...properties };
    };
    chromeMocks.chrome.tabs.get = async (tabId) => ({ id: tabId, windowId: 1, status: 'complete' });
    chromeMocks.chrome.tabs.sendMessage = async () => ({ success: false });
    chromeMocks.chrome.tabs.remove = async () => {
      removedTabs += 1;
    };
    globalThis.fetch = async () => {
      throw new Error('401 invalid oauth token');
    };
    const farmingSession = createFarmingSession(
      state,
      createAdapters({
        notify: async () => {
          notifications += 1;
        },
        telegramSystemAlert: async () => {
          systemAlerts += 1;
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
        options.stopReason
          ? farmingSession.stop(options)
          : farmingSession.recoverTwitchSession({ notification: options.notification }),
    });

    await gateway.fetchInventorySnapshot([drop], { sessionRecoveryMode: 'background-tab' });
    await gateway.fetchInventorySnapshot([drop], { sessionRecoveryMode: 'background-tab' });

    expect(createdTabs).toBe(0);
    expect(removedTabs).toBe(0);
    expect(notifications).toBe(1);
    expect(systemAlerts).toBe(1);
    expect(transportStops).toBe(1);
    expect(state.appState.recoveryReason).toBeNull();
    expect(state.appState.twitchSessionSyncState.status).toBe('blocked');
    expect(state.appState.isRunning).toBe(false);
    expect(state.appState.activeStreamer).toBeNull();
  });

  test('ticks the watch transport while API refresh is backing off', async () => {
    const state = createState();
    state.apiBackoffUntil = Date.now() + 60_000;
    let transportTicks = 0;
    const farmingSession = createFarmingSession(
      state,
      createAdapters({
        watchTransport: {
          start: async () => healthyWatch(),
          tick: async () => {
            transportTicks += 1;
            return healthyWatch();
          },
          stop: async () => {},
          setPreference: async () => {},
        },
      }),
    );

    await farmingSession.checkDropProgress();

    expect(transportTicks).toBe(1);
  });

  test('resumes a terminal authentication stop without another user start', async () => {
    const state = createState();
    state.appState.isRunning = false;
    state.appState.activeStreamer = null;
    state.appState.lastStopReason = 'sign-in-required';
    state.appState.lastStopMessage = 'Reconnect Twitch.';
    state.appState.twitchSessionSyncState = { status: 'blocked', attempts: 3, nextRetryAt: null };
    state.apiConsecutiveFailures = 3;
    state.apiBackoffUntil = Date.now() + 60_000;
    let transportStarts = 0;
    const farmingSession = createFarmingSession(
      state,
      createAdapters({
        watchTransport: {
          start: async () => {
            transportStarts += 1;
            state.appState.activeStreamer = streamer;
            return healthyWatch();
          },
          tick: async () => healthyWatch(),
          stop: async () => {},
          setPreference: async () => {},
        },
      }),
    );

    await farmingSession.resumeAfterAuthRecovery();

    expect(state.appState.isRunning).toBe(true);
    expect(state.appState.lastStopReason).toBeNull();
    expect(state.appState.activeStreamer).toEqual(streamer);
    expect(state.appState.twitchSessionSyncState).toEqual({
      status: 'ready',
      attempts: 0,
      nextRetryAt: null,
    });
    expect(state.apiConsecutiveFailures).toBe(0);
    expect(state.apiBackoffUntil).toBe(0);
    expect(transportStarts).toBe(1);
  });
});
