import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ServiceWorkerState } from '../../src/background/service-worker.ts';
import { readTwitchSessionViaExecuteScript } from '../../src/background/session-management.ts';
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

function createScriptExecutionMock(result: unknown): ScriptExecutionMock {
  return {
    executeScript: async () => [{ result }],
  };
}

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
    chromeMock.scripting = { executeScript: execMock.executeScript };

    const result = await readTwitchSessionViaExecuteScript(123);
    expect(result).toBeNull();
  });

  test('returns null when sanitizeTwitchSession rejects the raw result', async () => {
    const execMock = createScriptExecutionMock({ userId: '12345678' });
    const chromeMock = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
    chromeMock.scripting = { executeScript: execMock.executeScript };

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
    chromeMock.scripting = { executeScript: execMock.executeScript };

    const result = await readTwitchSessionViaExecuteScript(789);
    expect(result).not.toBeNull();
    expect(result?.oauthToken).toBe('oauth12345678901234567890');
    expect(result?.userId).toBe('12345678');
    expect(result?.deviceId).toBe('device-abc-12345678901234567');
    expect(result?.clientIntegrity).toBe('script-integrity-token');
  });

  test('returns null when chrome.scripting.executeScript throws', async () => {
    const chromeMock = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
    chromeMock.scripting = {
      executeScript: async () => {
        throw new Error('executeScript failed');
      },
    };

    const result = await readTwitchSessionViaExecuteScript(999);
    expect(result).toBeNull();
  });
});
