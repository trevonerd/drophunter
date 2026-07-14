import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { TWITCH_SESSION_STORAGE_KEY } from '../src/background/constants.ts';
import type { ServiceWorkerState } from '../src/background/service-worker.ts';
import {
  clearTwitchSessionCache,
  ensureSessionIntegrity,
  findSessionCandidateDeep,
  loadPageIntegrityToken,
  persistTwitchSession,
  readTwitchSessionViaExecuteScript,
  recoverTwitchSessionFromStorageKeys,
  refreshTwitchIntegrityToken,
  syncTwitchIntegrityFromContentScriptExt,
  syncTwitchSessionFromContentScriptExt,
  trySanitizeSessionCandidate,
} from '../src/background/session-management.ts';
import type { TwitchSession } from '../src/background/twitch-api/types.ts';
import { createInitialState } from '../src/shared/utils.ts';
import type { ChromeMocks } from './mocks/chrome.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

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

function createScriptExecutionMock(result: unknown): ScriptExecutionMock {
  return {
    executeScript: async () => [{ result }],
  };
}

describe('persistTwitchSession', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('sets session to storage when provided', async () => {
    const session = validSession();
    await persistTwitchSession(session);
    const stored = mocks.storage.local._store.get(TWITCH_SESSION_STORAGE_KEY) as TwitchSession;
    expect(stored).toEqual(session);
  });

  test('removes session key when null is passed', async () => {
    mocks.storage.local._store.set(TWITCH_SESSION_STORAGE_KEY, validSession());
    await persistTwitchSession(null);
    expect(mocks.storage.local._store.has(TWITCH_SESSION_STORAGE_KEY)).toBe(false);
  });
});

describe('clearTwitchSessionCache', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('nulls twitchSessionCache on state', () => {
    const state = createMinimalState({ twitchSessionCache: validSession() });
    clearTwitchSessionCache(state);
    expect(state.twitchSessionCache).toBeNull();
  });

  test('clears session from storage', async () => {
    const state = createMinimalState();
    clearTwitchSessionCache(state);
    expect(mocks.storage.local._store.has(TWITCH_SESSION_STORAGE_KEY)).toBe(false);
  });
});

describe('trySanitizeSessionCandidate', () => {
  test('returns sanitized session for valid input', () => {
    const raw = {
      oauthToken: 'oauth12345678901234567890',
      userId: '12345678',
      deviceId: 'device-abc-12345678901234567',
      uuid: 'abc12345',
    };
    const result = trySanitizeSessionCandidate(raw);
    expect(result).not.toBeNull();
    expect(result!.oauthToken).toBe('oauth12345678901234567890');
  });

  test('returns null for invalid input (missing oauthToken)', () => {
    const raw = { userId: '12345678' };
    expect(trySanitizeSessionCandidate(raw)).toBeNull();
  });

  test('returns null for invalid input (missing deviceId)', () => {
    const raw = { oauthToken: 'oauth12345678901234567890' };
    expect(trySanitizeSessionCandidate(raw)).toBeNull();
  });

  test('returns null for non-object input', () => {
    expect(trySanitizeSessionCandidate('not an object')).toBeNull();
    expect(trySanitizeSessionCandidate(null)).toBeNull();
    expect(trySanitizeSessionCandidate(123)).toBeNull();
  });

  test('returns null for token shorter than 20 chars', () => {
    const raw = {
      oauthToken: 'short',
      deviceId: 'device-abc-12345678901234567',
    };
    expect(trySanitizeSessionCandidate(raw)).toBeNull();
  });
});

describe('findSessionCandidateDeep', () => {
  test('finds session at top level', () => {
    const raw = {
      oauthToken: 'oauth12345678901234567890',
      deviceId: 'device-abc-12345678901234567',
      uuid: 'abc12345',
    };
    expect(findSessionCandidateDeep(raw)).not.toBeNull();
  });

  test('returns null when depth exceeded', () => {
    const raw = { deeply: { nested: { value: 'not-a-session' } } };
    expect(findSessionCandidateDeep(raw, 0)).toBeNull();
  });

  test('returns null for null input', () => {
    expect(findSessionCandidateDeep(null)).toBeNull();
  });

  test('parses JSON string embedded in object', () => {
    const raw = {
      key: '  {"oauthToken":"oauth12345678901234567890","deviceId":"device-abc-12345678901234567"}  ',
    };
    const result = findSessionCandidateDeep(raw);
    expect(result).not.toBeNull();
    expect(result!.oauthToken).toBe('oauth12345678901234567890');
  });

  test('returns null for string that is not JSON', () => {
    expect(findSessionCandidateDeep('not json at all')).toBeNull();
  });

  test('returns null for JSON array without session objects', () => {
    expect(findSessionCandidateDeep('[1,2,3]')).toBeNull();
  });

  test('finds session inside array', () => {
    const raw = [
      'ignore',
      { foo: 'bar' },
      {
        oauthToken: 'oauth12345678901234567890',
        deviceId: 'device-abc-12345678901234567',
      },
    ];
    const result = findSessionCandidateDeep(raw);
    expect(result).not.toBeNull();
  });

  test('finds session in nested object values', () => {
    const raw = {
      wrapper: {
        inner: {
          oauthToken: 'oauth12345678901234567890',
          deviceId: 'device-abc-12345678901234567',
        },
      },
    };
    const result = findSessionCandidateDeep(raw);
    expect(result).not.toBeNull();
  });

  test('skips non-JSON strings', () => {
    const raw = 'just some plain text without braces';
    expect(findSessionCandidateDeep(raw)).toBeNull();
  });
});

describe('recoverTwitchSessionFromStorageKeys', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('recovers session from flat local storage keys', async () => {
    mocks.storage.local._store.set('oauthToken', 'oauth12345678901234567890');
    mocks.storage.local._store.set('deviceId', 'device-abc-12345678901234567');
    mocks.storage.local._store.set('userId', '12345678');

    const session = await recoverTwitchSessionFromStorageKeys();
    expect(session).not.toBeNull();
    expect(session!.oauthToken).toBe('oauth12345678901234567890');
    expect(session!.deviceId).toBe('device-abc-12345678901234567');
  });

  test('prefers local over sync for flat keys', async () => {
    mocks.storage.local._store.set('oauthToken', 'local-token-12345678901234567890');
    mocks.storage.sync._store.set('oauthToken', 'sync-token-12345678901234567890');
    mocks.storage.local._store.set('deviceId', 'local-device-12345678901234567');
    mocks.storage.sync._store.set('deviceId', 'sync-device-12345678901234567');

    const session = await recoverTwitchSessionFromStorageKeys();
    expect(session!.oauthToken).toBe('local-token-12345678901234567890');
    expect(session!.deviceId).toBe('local-device-12345678901234567');
  });

  test('falls back to sync when local is missing for flat keys', async () => {
    mocks.storage.sync._store.set('oauthToken', 'sync-token-12345678901234567890');
    mocks.storage.sync._store.set('deviceId', 'sync-device-12345678901234567');

    const session = await recoverTwitchSessionFromStorageKeys();
    expect(session).not.toBeNull();
    expect(session!.oauthToken).toBe('sync-token-12345678901234567890');
  });

  test('returns null when no session data in storage', async () => {
    const session = await recoverTwitchSessionFromStorageKeys();
    expect(session).toBeNull();
  });

  test('deep searches storage values when flat keys fail', async () => {
    mocks.storage.local._store.set('someKey', {
      oauthToken: 'oauth12345678901234567890',
      deviceId: 'device-abc-12345678901234567',
      uuid: 'deep-session-uuid',
    });

    const session = await recoverTwitchSessionFromStorageKeys();
    expect(session).not.toBeNull();
    expect(session!.oauthToken).toBe('oauth12345678901234567890');
    expect(session!.uuid).toBe('deep-session-uuid');
  });
});

describe('refreshTwitchIntegrityToken', () => {
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

  test('updates state cache and persists session with new token', async () => {
    const state = createMinimalState();
    const session = validSession();

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ token: 'fresh-integrity-token-12345' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const result = await refreshTwitchIntegrityToken(state, session);

    expect(result).not.toBeNull();
    expect(result!.clientIntegrity).toBe('fresh-integrity-token-12345');
    expect(state.twitchSessionCache).not.toBeNull();
    expect(state.twitchSessionCache!.clientIntegrity).toBe('fresh-integrity-token-12345');
  });

  test('returns null when fetch returns empty token', async () => {
    const state = createMinimalState();
    const session = validSession();

    globalThis.fetch = async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const result = await refreshTwitchIntegrityToken(state, session);
    expect(result).toBeNull();
  });

  test('returns null when fetch fails', async () => {
    const state = createMinimalState();
    const session = validSession();

    globalThis.fetch = async () => new Response(null, { status: 500 });

    const result = await refreshTwitchIntegrityToken(state, session);
    expect(result).toBeNull();
  });
});

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
    expect(state.twitchSessionCache!.clientIntegrity).toBe('page-intercept-token-12345');
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

describe('readTwitchSessionViaExecuteScript', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('returns null when executeScript returns null result', async () => {
    const execMock = createScriptExecutionMock(null);
    const chromeMock = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
    chromeMock.scripting = { executeScript: execMock.executeScript } as unknown;

    const result = await readTwitchSessionViaExecuteScript(123);
    expect(result).toBeNull();
  });

  test('returns null when sanitizeTwitchSession rejects the raw result', async () => {
    const execMock = createScriptExecutionMock({ userId: '12345678' });
    const chromeMock = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
    chromeMock.scripting = { executeScript: execMock.executeScript } as unknown;

    const result = await readTwitchSessionViaExecuteScript(456);
    expect(result).toBeNull();
  });

  test('returns sanitized session from executeScript result', async () => {
    const rawSession = {
      oauthToken: 'oauth12345678901234567890',
      userId: '12345678',
      deviceId: 'device-abc-12345678901234567',
      uuid: 'script-uuid-abc',
      clientIntegrity: 'script-integrity-token',
    };
    const execMock = createScriptExecutionMock(rawSession);
    const chromeMock = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
    chromeMock.scripting = { executeScript: execMock.executeScript } as unknown;

    const result = await readTwitchSessionViaExecuteScript(789);
    expect(result).not.toBeNull();
    expect(result!.oauthToken).toBe('oauth12345678901234567890');
    expect(result!.userId).toBe('12345678');
    expect(result!.deviceId).toBe('device-abc-12345678901234567');
    expect(result!.clientIntegrity).toBe('script-integrity-token');
  });

  test('returns null when chrome.scripting.executeScript throws', async () => {
    const chromeMock = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
    chromeMock.scripting = {
      executeScript: async () => {
        throw new Error('executeScript failed');
      },
    } as unknown;

    const result = await readTwitchSessionViaExecuteScript(999);
    expect(result).toBeNull();
  });
});

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
