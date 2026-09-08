import { describe, expect, test } from 'bun:test';
import { createSessionOrchestrator } from '../../src/background/session-orchestrator.ts';
import type { TwitchSession } from '../../src/background/twitch-api/types.ts';
import { createInitialState } from '../../src/shared/utils.ts';

const validSession: TwitchSession = {
  oauthToken: 'oauth-token-with-enough-length',
  userId: '123',
  deviceId: 'device-id',
  uuid: 'session-uuid',
};

function createState() {
  return {
    appState: createInitialState(),
    twitchSessionCache: null as TwitchSession | null,
    twitchSessionLastAttemptAt: 123,
  };
}

describe('session orchestrator', () => {
  test('keeps a recovery tab that was navigated or focused by the user', async () => {
    const state = createState();
    let removed = false;
    const original = { id: 81, url: 'https://www.twitch.tv/drops/inventory', active: false, windowId: 9 };
    const orchestrator = createSessionOrchestrator(state, {
      tabsApi: {
        async query(query) {
          return query.windowId ? [{ id: 1 }, original] : [];
        },
        async create() {
          return original;
        },
        async get() {
          return { ...original, url: 'https://www.twitch.tv/settings', active: true };
        },
        async remove() {
          removed = true;
        },
        async sendMessage() {
          return { success: true, session: validSession };
        },
      },
      scriptingApi: {
        async executeScript() {
          return [];
        },
      },
      sanitizeTwitchSession: (candidate) => (candidate === validSession ? validSession : null),
      sessionDebugSummary: () => ({}),
      readTwitchSessionViaExecuteScript: async () => null,
      persistTwitchSession: async () => {},
      validateRecoveredTwitchSession: async () => true,
      getSessionRevision: () => 0,
      discardPersistedTwitchSessionIfMatches: async () => {},
      sessionReadAttempts: 1,
      logDebug: () => {},
      logWarn: () => {},
    });

    expect(await orchestrator.recoverTwitchSessionAfterAuthError('background-tab')).toBe(validSession);
    expect(removed).toBe(false);
  });

  test('does not publish a recovered session after its revision becomes stale', async () => {
    const state = createState();
    let revision = 0;
    let releaseValidation: () => void = () => {};
    const validation = new Promise<void>((resolve) => {
      releaseValidation = resolve;
    });
    let persisted = false;
    const orchestrator = createSessionOrchestrator(state, {
      tabsApi: {
        async query() {
          return [{ id: 82, url: 'https://www.twitch.tv/drops/inventory', active: false }];
        },
        async create() {
          return null;
        },
        async sendMessage() {
          return { success: true, session: validSession };
        },
      },
      sanitizeTwitchSession: (candidate) => (candidate === validSession ? validSession : null),
      sessionDebugSummary: () => ({}),
      readTwitchSessionViaExecuteScript: async () => null,
      persistTwitchSession: async () => {
        persisted = true;
      },
      validateRecoveredTwitchSession: async () => {
        await validation;
        return true;
      },
      getSessionRevision: () => revision,
      discardPersistedTwitchSessionIfMatches: async () => {},
      logDebug: () => {},
      logWarn: () => {},
    });

    const recovery = orchestrator.recoverTwitchSessionAfterAuthError('background-tab');
    await Promise.resolve();
    revision += 1;
    releaseValidation();
    expect(await recovery).toBeNull();
    expect(persisted).toBe(false);
    expect(state.twitchSessionCache).toBeNull();
  });

  test('recovers from an existing Twitch tab without creating or closing a user tab', async () => {
    const state = createState();
    const events: string[] = [];
    const orchestrator = createSessionOrchestrator(state, {
      tabsApi: {
        async query() {
          return [{ id: 33, url: 'https://www.twitch.tv/drops/inventory', active: true }];
        },
        async create() {
          events.push('create');
          return null;
        },
        async sendMessage(tabId) {
          events.push(`read:${tabId}`);
          return { success: true, session: validSession };
        },
      },
      sanitizeTwitchSession: (candidate) => (candidate === validSession ? validSession : null),
      sessionDebugSummary: () => ({ available: true }),
      readTwitchSessionViaExecuteScript: async () => null,
      persistTwitchSession: async () => {
        events.push('persist');
      },
      validateRecoveredTwitchSession: async () => true,
      getSessionRevision: () => 0,
      discardPersistedTwitchSessionIfMatches: async () => {},
      closeTemporaryTabIfSafe: async () => {
        events.push('close');
        return true;
      },
      logDebug: () => {},
      logWarn: () => {},
    });

    const session = await orchestrator.recoverTwitchSessionAfterAuthError('background-tab');

    expect(session).toBe(validSession);
    expect(events).toEqual(['read:33', 'persist']);
  });

  test('uses one temporary-tab recovery budget while the session revision remains unresolved', async () => {
    const state = createState();
    let createCalls = 0;
    let currentTime = 10_000;
    const orchestrator = createSessionOrchestrator(state, {
      tabsApi: {
        async query() {
          return [];
        },
        async create() {
          createCalls += 1;
          return { id: 44, url: 'https://www.twitch.tv/drops/campaigns', active: false };
        },
        async sendMessage() {
          return { success: false };
        },
      },
      scriptingApi: {
        async executeScript() {
          return [];
        },
      },
      sanitizeTwitchSession: () => null,
      sessionDebugSummary: () => ({ available: false }),
      readTwitchSessionViaExecuteScript: async () => null,
      persistTwitchSession: async () => {},
      validateRecoveredTwitchSession: async () => true,
      getSessionRevision: () => 0,
      discardPersistedTwitchSessionIfMatches: async () => {},
      waitForTabComplete: async () => {},
      sessionReadAttempts: 1,
      now: () => currentTime,
      logDebug: () => {},
      logWarn: () => {},
    });

    expect(await orchestrator.recoverTwitchSessionAfterAuthError('background-tab')).toBeNull();
    state.appState.twitchSessionSyncState = {
      status: 'retrying',
      attempts: 1,
      nextRetryAt: Date.now() + 60_000,
    };
    expect(await orchestrator.recoverTwitchSessionAfterAuthError('background-tab')).toBeNull();
    expect(createCalls).toBe(1);
    currentTime += 60_000;
    expect(await orchestrator.recoverTwitchSessionAfterAuthError('background-tab')).toBeNull();
    expect(createCalls).toBe(2);
  });

  test('deduplicates concurrent recovery through one existing Twitch tab', async () => {
    const state = createState();
    let queryCalls = 0;
    let readCalls = 0;
    let releaseRead: () => void = () => undefined;
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const orchestrator = createSessionOrchestrator(state, {
      tabsApi: {
        async query() {
          queryCalls += 1;
          return [{ id: 55, url: 'https://www.twitch.tv/drops/inventory', active: false }];
        },
        async create() {
          throw new Error('must not create a Twitch tab');
        },
        async sendMessage() {
          readCalls += 1;
          await readGate;
          return { success: true, session: validSession };
        },
      },
      scriptingApi: {
        async executeScript() {
          return [];
        },
      },
      sanitizeTwitchSession: (candidate) => (candidate === validSession ? validSession : null),
      sessionDebugSummary: () => ({ available: true }),
      readTwitchSessionViaExecuteScript: async () => null,
      persistTwitchSession: async () => {},
      validateRecoveredTwitchSession: async () => true,
      getSessionRevision: () => 0,
      discardPersistedTwitchSessionIfMatches: async () => {},
      waitForTabComplete: async () => {},
      logDebug: () => {},
      logWarn: () => {},
    });

    const first = orchestrator.recoverTwitchSessionAfterAuthError('background-tab');
    const second = orchestrator.recoverTwitchSessionAfterAuthError('background-tab');
    releaseRead();
    expect(await Promise.all([first, second])).toEqual([validSession, validSession]);
    expect(queryCalls).toBe(1);
    expect(readCalls).toBe(1);
  });
});
