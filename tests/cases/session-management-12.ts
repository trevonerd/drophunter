import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { TWITCH_SESSION_STORAGE_KEY } from '../../src/background/constants.ts';
import type { ServiceWorkerState } from '../../src/background/service-worker.ts';
import { syncTwitchIntegrityFromContentScriptExt } from '../../src/background/session-management.ts';
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

describe('syncTwitchIntegrityFromContentScriptExt', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('rejects empty token', async () => {
    const state = createMinimalState();
    const result = await syncTwitchIntegrityFromContentScriptExt(state, { token: '   ' });
    expect(result).toEqual({ success: false, error: 'Empty integrity token' });
  });

  test('rejects missing payload', async () => {
    const state = createMinimalState();
    const result = await syncTwitchIntegrityFromContentScriptExt(state, undefined);
    expect(result).toEqual({ success: false, error: 'Empty integrity token' });
  });

  test('resets fallback flags and writes storage; no cached session means no persist call', async () => {
    const state = createMinimalState({
      integrityFallbackActive: true,
      integrityFallbackActiveUntil: 12345,
    });
    const result = await syncTwitchIntegrityFromContentScriptExt(state, {
      token: 'integrity-token-xyz',
      expiration: 9999,
      request_id: 'req-1',
    });
    expect(result).toEqual({ success: true });
    expect(state.integrityFallbackActive).toBe(false);
    expect(state.integrityFallbackActiveUntil).toBe(0);
    const stored = mocks.storage.local._store.get('twitchIntegrity') as Record<string, unknown>;
    expect(stored).toEqual({
      token: 'integrity-token-xyz',
      expiration: 9999,
      request_id: 'req-1',
    });
  });

  test('mutates cached session clientIntegrity and persists when session exists', async () => {
    const existing = validSession({ clientIntegrity: 'old-token' });
    const state = createMinimalState({
      twitchSessionCache: existing,
      integrityFallbackActive: true,
    });
    const result = await syncTwitchIntegrityFromContentScriptExt(state, {
      token: 'new-token',
      expiration: 123,
    });
    expect(result).toEqual({ success: true });
    expect(state.twitchSessionCache?.clientIntegrity).toBe('new-token');
    expect(state.integrityFallbackActive).toBe(false);
    const stored = mocks.storage.local._store.get(TWITCH_SESSION_STORAGE_KEY) as TwitchSession;
    expect(stored.clientIntegrity).toBe('new-token');
  });
});
