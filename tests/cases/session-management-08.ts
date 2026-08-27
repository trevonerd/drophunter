import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ServiceWorkerState } from '../../src/background/service-worker.ts';
import { loadPageIntegrityToken } from '../../src/background/session-management.ts';
import type { TwitchSession } from '../../src/background/twitch-api/types.ts';
import { createInitialState } from '../../src/shared/utils.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';

function _createMinimalState(overrides: Partial<ServiceWorkerState> = {}): ServiceWorkerState {
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

function _validSession(overrides: Partial<TwitchSession> = {}): TwitchSession {
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

describe('loadPageIntegrityToken', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('returns token when stored and not expired', async () => {
    const futureExpiration = Date.now() + 60_000;
    mocks.storage.local._store.set('twitchIntegrity', {
      token: 'page-token-abcdefghij',
      expiration: futureExpiration,
    });

    const result = await loadPageIntegrityToken();
    expect(result).toBe('page-token-abcdefghij');
  });

  test('returns null when twitchIntegrity is not set', async () => {
    const result = await loadPageIntegrityToken();
    expect(result).toBeNull();
  });

  test('returns null when token is missing from stored object', async () => {
    mocks.storage.local._store.set('twitchIntegrity', { expiration: Date.now() + 60000 });
    const result = await loadPageIntegrityToken();
    expect(result).toBeNull();
  });

  test('returns null when token has expired', async () => {
    mocks.storage.local._store.set('twitchIntegrity', {
      token: 'expired-token-xyz',
      expiration: Date.now() - 1000,
    });
    const result = await loadPageIntegrityToken();
    expect(result).toBeNull();
  });

  test('returns token when expiration is 0 (treated as non-expiring)', async () => {
    mocks.storage.local._store.set('twitchIntegrity', { token: 'zero-expiry-token', expiration: 0 });
    const result = await loadPageIntegrityToken();
    expect(result).toBe('zero-expiry-token');
  });
});
