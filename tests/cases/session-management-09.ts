import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ServiceWorkerState } from '../../src/background/service-worker.ts';
import { ensureSessionIntegrity } from '../../src/background/session-management.ts';
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

describe('ensureSessionIntegrity', () => {
  let mocks: ChromeMocks;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    mocks = setupChromeMocks();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mocks.teardown();
  });

  test('returns session unchanged when clientIntegrity already present and forceRefresh=false', async () => {
    const state = createMinimalState();
    const session = validSession({ clientIntegrity: 'existing-integrity-token' });

    const result = await ensureSessionIntegrity(state, session, false);
    expect(result.clientIntegrity).toBe('existing-integrity-token');
    expect(state.twitchSessionCache).toBeNull();
  });

  test('uses page token when available and no forceRefresh', async () => {
    const state = createMinimalState();
    const session = validSession();
    const futureExpiration = Date.now() + 60_000;
    mocks.storage.local._store.set('twitchIntegrity', {
      token: 'page-intercept-token-12345',
      expiration: futureExpiration,
    });

    const result = await ensureSessionIntegrity(state, session, false);
    expect(result.clientIntegrity).toBe('page-intercept-token-12345');
    expect(state.twitchSessionCache).not.toBeNull();
    expect(state.twitchSessionCache?.clientIntegrity).toBe('page-intercept-token-12345');
  });

  test('forces refresh when forceRefresh is true even with existing integrity', async () => {
    const state = createMinimalState();
    const session = validSession({ clientIntegrity: 'old-token' });
    mocks.storage.local._store.set('twitchIntegrity', {
      token: 'page-token',
      expiration: Date.now() + 60_000,
    });

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ token: 'refreshed-token-xyz' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const result = await ensureSessionIntegrity(state, session, true);
    expect(result.clientIntegrity).toBe('refreshed-token-xyz');
  });

  test('falls back to refresh when no page token available', async () => {
    const state = createMinimalState();
    const session = validSession();

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ token: 'fallback-refresh-token-abc' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const result = await ensureSessionIntegrity(state, session, false);
    expect(result.clientIntegrity).toBe('fallback-refresh-token-abc');
  });

  test('returns original session when refresh returns null', async () => {
    const state = createMinimalState();
    const session = validSession();

    globalThis.fetch = async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const result = await ensureSessionIntegrity(state, session, false);
    expect(result).toBe(session);
  });
});
