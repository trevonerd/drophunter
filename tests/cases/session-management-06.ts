import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ServiceWorkerState } from '../../src/background/service-worker.ts';
import { recoverTwitchSessionFromStorageKeys } from '../../src/background/session-management.ts';
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
    expect(session?.oauthToken).toBe('oauth12345678901234567890');
    expect(session?.deviceId).toBe('device-abc-12345678901234567');
  });

  test('prefers local over sync for flat keys', async () => {
    mocks.storage.local._store.set('oauthToken', 'local-token-12345678901234567890');
    mocks.storage.sync._store.set('oauthToken', 'sync-token-12345678901234567890');
    mocks.storage.local._store.set('deviceId', 'local-device-12345678901234567');
    mocks.storage.sync._store.set('deviceId', 'sync-device-12345678901234567');

    const session = await recoverTwitchSessionFromStorageKeys();
    expect(session?.oauthToken).toBe('local-token-12345678901234567890');
    expect(session?.deviceId).toBe('local-device-12345678901234567');
  });

  test('falls back to sync when local is missing for flat keys', async () => {
    mocks.storage.sync._store.set('oauthToken', 'sync-token-12345678901234567890');
    mocks.storage.sync._store.set('deviceId', 'sync-device-12345678901234567');

    const session = await recoverTwitchSessionFromStorageKeys();
    expect(session).not.toBeNull();
    expect(session?.oauthToken).toBe('sync-token-12345678901234567890');
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
    expect(session?.oauthToken).toBe('oauth12345678901234567890');
    expect(session?.uuid).toBe('deep-session-uuid');
  });
});
