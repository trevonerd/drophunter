import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createServiceWorkerState } from '../../src/background/runtime-state.ts';
import { twitchSessionRecoveryIntent } from '../../src/background/service-worker-content-handlers.ts';
import { createServiceWorkerTwitchContentHandlers } from '../../src/background/service-worker-twitch-content-handlers.ts';
import { type ChromeMocks, setupChromeMocks } from '../mocks/chrome.ts';
import { farmableSessionGame as game } from '../support/farming-session-watch-transport.ts';

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

  test('does not convert a manual stop into an authentication resume intent', () => {
    expect(
      twitchSessionRecoveryIntent({
        lastStopReason: 'user-stop',
        twitchSessionSyncState: { status: 'ready', attempts: 0, nextRetryAt: null },
      }),
    ).toBe('none');
    expect(
      twitchSessionRecoveryIntent({
        lastStopReason: 'sign-in-required',
        twitchSessionSyncState: { status: 'blocked', attempts: 2, nextRetryAt: null },
      }),
    ).toBe('resume');
    expect(
      twitchSessionRecoveryIntent({
        lastStopReason: null,
        twitchSessionSyncState: { status: 'retrying', attempts: 2, nextRetryAt: 123 },
      }),
    ).toBe('continue');
  });

  test('a recovered Twitch session becomes ready and resumes a blocked farming target', async () => {
    const state = createServiceWorkerState();
    state.appState.selectedGame = game;
    state.appState.queue = [game];
    state.appState.lastStopReason = 'sign-in-required';
    state.appState.lastStopMessage = 'Reconnect Twitch.';
    state.appState.twitchSessionSyncState = { status: 'blocked', attempts: 2, nextRetryAt: null };
    state.apiConsecutiveFailures = 2;
    state.apiBackoffUntil = Date.now() + 60_000;
    let resumes = 0;
    const handlers = createServiceWorkerTwitchContentHandlers(state, {
      awaitInitialization: async () => {},
      shouldRefreshCampaignsAfterSessionSync: () => false,
      requestAuthRecoveredSync: async () => {},
      resumeAfterAuthRecovery: async () => {
        resumes += 1;
        state.appState.isRunning = true;
        state.appState.lastStopReason = null;
        state.appState.lastStopMessage = null;
      },
      recordChannelPointsBonusClaimed: async () => {},
    });

    const result = await handlers.handleSyncTwitchSession(
      {
        oauthToken: 'valid-oauth-token-with-enough-length',
        userId: 'viewer-1',
        deviceId: 'device-1',
        uuid: 'uuid-1',
      },
      {
        tab: {
          id: 7,
          index: 0,
          windowId: 1,
          url: 'https://www.twitch.tv/drops/campaigns',
          pinned: false,
          highlighted: true,
          active: true,
          frozen: false,
          incognito: false,
          selected: true,
          discarded: false,
          autoDiscardable: true,
          groupId: -1,
          lastAccessed: Date.now(),
        },
      },
    );

    expect(result.success).toBe(true);
    expect(resumes).toBe(1);
    expect(state.appState.isRunning).toBe(true);
    expect(state.appState.twitchSessionSyncState).toMatchObject({
      status: 'ready',
      attempts: 0,
      nextRetryAt: null,
    });
    expect(state.apiConsecutiveFailures).toBe(0);
    expect(state.apiBackoffUntil).toBe(0);
  });
});
