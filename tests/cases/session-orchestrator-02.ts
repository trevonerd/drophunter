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

    const session = await orchestrator.recoverTwitchSessionAfterAuthError();

    expect(session).toBe(validSession);
    expect(events).toEqual(['read:33', 'persist']);
  });

  test('never opens a temporary tab during automatic auth recovery', async () => {
    const state = createState();
    let createCalls = 0;
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
      closeTemporaryTabIfSafe: async () => true,
      sessionReadAttempts: 1,
      logDebug: () => {},
      logWarn: () => {},
    });

    expect(await orchestrator.recoverTwitchSessionAfterAuthError()).toBeNull();
    state.appState.recoveryReason = 'sign-in-required';
    expect(await orchestrator.recoverTwitchSessionAfterAuthError()).toBeNull();
    expect(createCalls).toBe(0);
  });

  test('deduplicates concurrent passive auth recovery requests', async () => {
    const state = createState();
    let createCalls = 0;
    const orchestrator = createSessionOrchestrator(state, {
      tabsApi: {
        async query() {
          return [];
        },
        async create() {
          createCalls += 1;
          return { id: 55, url: 'https://www.twitch.tv/drops/campaigns', active: false };
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
      sessionDebugSummary: () => ({ available: true }),
      readTwitchSessionViaExecuteScript: async () => null,
      persistTwitchSession: async () => {},
      waitForTabComplete: async () => {},
      closeTemporaryTabIfSafe: async () => true,
      logDebug: () => {},
      logWarn: () => {},
    });

    const first = orchestrator.recoverTwitchSessionAfterAuthError();
    const second = orchestrator.recoverTwitchSessionAfterAuthError();
    expect(await Promise.all([first, second])).toEqual([null, null]);
    expect(createCalls).toBe(0);
  });
});
