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

  test('does not create a Twitch tab when no existing tab can resynchronize OAuth', async () => {
    const state = createState();
    let createCalls = 0;
    let closeCalls = 0;
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
      waitForTabComplete: async () => {},
      closeTemporaryTabIfSafe: async () => {
        closeCalls += 1;
        return true;
      },
      sessionReadAttempts: 1,
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
    expect(createCalls).toBe(0);
    expect(closeCalls).toBe(0);
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
