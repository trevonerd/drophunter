import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ServiceWorkerState } from '../../src/background/service-worker.ts';
import { ensureTwitchSession } from '../../src/background/session-management.ts';
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

describe('ensureTwitchSession', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('invalidates a cached session when a forced tab reread finds no replacement', async () => {
    const session = validSession();
    const state = createMinimalState({ twitchSessionCache: session });
    let cacheClears = 0;

    const result = await ensureTwitchSession(
      state,
      true,
      { onFindTwitchSessionInOpenTabs: async () => null },
      {
        sanitizeTwitchSession: () => null,
        sessionDebugSummary: () => ({}),
        persistTwitchSession: async () => {},
        clearTwitchSessionCache: () => {
          cacheClears += 1;
          state.twitchSessionCache = null;
        },
      },
    );

    expect(result).toBeNull();
    expect(state.twitchSessionCache).toBeNull();
    expect(cacheClears).toBe(1);
  });

  test('does not clear a newer session synced while an older lookup is in flight', async () => {
    const session = validSession();
    const state = createMinimalState({ twitchSessionCache: null });
    let releaseLookup: (value: ReturnType<typeof validSession> | null) => void = () => {};
    const lookup = new Promise<ReturnType<typeof validSession> | null>((resolve) => {
      releaseLookup = resolve;
    });
    let cacheClears = 0;

    const pending = ensureTwitchSession(
      state,
      false,
      { onFindTwitchSessionInOpenTabs: () => lookup },
      {
        sanitizeTwitchSession: () => null,
        sessionDebugSummary: () => ({}),
        persistTwitchSession: async () => {},
        clearTwitchSessionCache: () => {
          cacheClears += 1;
          state.twitchSessionCache = null;
        },
      },
    );
    await Promise.resolve();
    state.twitchSessionCache = session;
    releaseLookup(null);

    expect(await pending).toBe(session);
    expect(cacheClears).toBe(0);
  });
});
