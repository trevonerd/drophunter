import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ServiceWorkerState } from '../../src/background/service-worker.ts';
import { syncTwitchSessionFromContentScriptExt } from '../../src/background/session-management.ts';
import type { TwitchSession } from '../../src/background/twitch-api/types.ts';
import { createInitialState } from '../../src/shared/utils.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';

function createMinimalState(overrides: Partial<ServiceWorkerState> = {}): ServiceWorkerState {
  return {
    appState: createInitialState(),
    monitorTickInFlight: false,
    invalidStreamChecks: 0,
    lastStreamRotationAt: 0,
    streamValidationGraceUntil: 0,
    lastTrackedProgress: 0,
    lastTrackedMinutes: 0,
    lastTrackedDropKey: null,
    lastProgressAdvanceAt: 0,
    noProgressRotationAttempts: 0,
    playbackAttentionWarningSent: false,
    gamesCacheRefreshInFlight: null,
    twitchSessionCache: null,
    twitchSessionFetchInFlight: null,
    twitchSessionLastAttemptAt: 0,
    cachedDropsSnapshot: [],
    previousAllDropsCount: 0,
    cachedCampaignChannelsMap: {},
    lastFullRefreshAt: 0,
    dropClaimInFlight: false,
    dropClaimRetryAtById: new Map(),
    queueMissingStreak: new Map(),
    lastActivityAt: 0,
    apiConsecutiveFailures: 0,
    apiBackoffUntil: 0,
    integrityFallbackActive: false,
    integrityFallbackActiveUntil: 0,
    recoveryBackoffUntil: 0,
    lastRecoveryAttemptAt: 0,
    stalledRecoveryAttempts: 0,
    recoveryNotificationSent: false,
    lastGamesCacheRefreshAt: 0,
    ...overrides,
  };
}

function validSession(overrides: Partial<TwitchSession> = {}): TwitchSession {
  return {
    oauthToken: 'oauth12345678901234567890',
    userId: '12345678',
    deviceId: 'device-abc-12345678901234567',
    uuid: 'abc12345',
    clientId: 'kimne78kx3ncx6brgo4mv6wki5h1ko',
    ...overrides,
  };
}

interface ScriptExecutionMock {
  executeScript: (options: {
    target: { tabId: number };
    func: () => unknown;
  }) => Promise<Array<{ result: unknown }>>;
}

function _createScriptExecutionMock(result: unknown): ScriptExecutionMock {
  return {
    executeScript: async () => [{ result }],
  };
}

describe('syncTwitchSessionFromContentScriptExt', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('rejects invalid payload without touching state', async () => {
    const state = createMinimalState();
    const callbacks = {
      shouldRefreshCampaignsAfterSessionSync: () => false,
      onRefreshCampaigns: async () => {},
      onSaveState: async () => {},
      onBroadcastStateUpdate: () => {},
    };
    const result = await syncTwitchSessionFromContentScriptExt(state, { bogus: true }, null, callbacks);
    expect(result).toEqual({ success: false, error: 'Invalid session payload' });
    expect(state.twitchSessionCache).toBeNull();
  });

  test('mutates cache/timing/appState and persists; no refresh branch without tab', async () => {
    const state = createMinimalState();
    let saved = 0;
    let broadcasted = 0;
    let refreshed = 0;
    const callbacks = {
      shouldRefreshCampaignsAfterSessionSync: () => true,
      onRefreshCampaigns: async () => {
        refreshed += 1;
      },
      onSaveState: async () => {
        saved += 1;
      },
      onBroadcastStateUpdate: () => {
        broadcasted += 1;
      },
    };
    const session = validSession();
    const result = await syncTwitchSessionFromContentScriptExt(state, session, null, callbacks);
    expect(result).toEqual({ success: true });
    expect(state.twitchSessionCache).toEqual(session);
    expect(state.twitchSessionLastAttemptAt).toBe(0);
    expect(state.appState.twitchSessionDetected).toBe(true);
    expect(refreshed).toBe(0);
    expect(saved).toBe(0);
    expect(broadcasted).toBe(0);
  });

  test('refreshes + saves + broadcasts when sender has tab id and callback says refresh', async () => {
    const state = createMinimalState();
    let saved = 0;
    let broadcasted = 0;
    let refreshed = 0;
    const callbacks = {
      shouldRefreshCampaignsAfterSessionSync: () => true,
      onRefreshCampaigns: async () => {
        refreshed += 1;
      },
      onSaveState: async () => {
        saved += 1;
      },
      onBroadcastStateUpdate: () => {
        broadcasted += 1;
      },
    };
    const result = await syncTwitchSessionFromContentScriptExt(state, validSession(), 42, callbacks);
    expect(result).toEqual({ success: true });
    expect(refreshed).toBe(1);
    expect(saved).toBe(1);
    expect(broadcasted).toBe(1);
  });

  test('save+broadcast but no refresh when tab id present, callback says no refresh, but stale stop existed', async () => {
    const state = createMinimalState({
      appState: { ...createInitialState(), lastStopReason: 'sign-in-required' },
    });
    let saved = 0;
    let broadcasted = 0;
    let refreshed = 0;
    const callbacks = {
      shouldRefreshCampaignsAfterSessionSync: () => false,
      onRefreshCampaigns: async () => {
        refreshed += 1;
      },
      onSaveState: async () => {
        saved += 1;
      },
      onBroadcastStateUpdate: () => {
        broadcasted += 1;
      },
    };
    const result = await syncTwitchSessionFromContentScriptExt(state, validSession(), 42, callbacks);
    expect(result).toEqual({ success: true });
    expect(state.appState.lastStopReason).toBeNull();
    expect(refreshed).toBe(0);
    expect(saved).toBe(1);
    expect(broadcasted).toBe(1);
  });

  test('save+broadcast fires for stale stop even without tab id', async () => {
    const state = createMinimalState({
      appState: { ...createInitialState(), lastStopReason: 'sign-in-required' },
    });
    let saved = 0;
    let broadcasted = 0;
    const callbacks = {
      shouldRefreshCampaignsAfterSessionSync: () => true,
      onRefreshCampaigns: async () => {},
      onSaveState: async () => {
        saved += 1;
      },
      onBroadcastStateUpdate: () => {
        broadcasted += 1;
      },
    };
    const result = await syncTwitchSessionFromContentScriptExt(state, validSession(), null, callbacks);
    expect(result).toEqual({ success: true });
    expect(state.appState.lastStopReason).toBeNull();
    expect(saved).toBe(1);
    expect(broadcasted).toBe(1);
  });
});
