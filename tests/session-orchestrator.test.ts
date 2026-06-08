import { describe, expect, test } from 'bun:test';
import { createSessionOrchestrator } from '../src/background/session-orchestrator.ts';
import type { TwitchSession } from '../src/background/twitch-api/types.ts';
import { createInitialState } from '../src/shared/utils.ts';

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
  test('decides campaign refresh need from empty, fresh, and stale state', () => {
    const state = createState();
    const orchestrator = createSessionOrchestrator(state, {
      sanitizeTwitchSession: () => validSession,
      sessionDebugSummary: () => ({}),
      readTwitchSessionViaExecuteScript: async () => null,
      persistTwitchSession: async () => {},
      logDebug: () => {},
      logWarn: () => {},
    });

    expect(orchestrator.shouldRefreshCampaignsAfterSessionSync(60_000, 100_000)).toBe(true);

    state.appState.availableGames = [{ id: 'game-1', name: 'Game', imageUrl: '', categorySlug: 'game' }];
    state.appState.lastSuccessfulRefreshAt = 90_000;
    expect(orchestrator.shouldRefreshCampaignsAfterSessionSync(60_000, 100_000)).toBe(false);

    state.appState.lastSuccessfulRefreshAt = 1;
    expect(orchestrator.shouldRefreshCampaignsAfterSessionSync(60_000, 100_000)).toBe(true);
  });

  test('persists a session read from a Twitch drops tab', async () => {
    const state = createState();
    const injectedTabs: number[] = [];
    const persisted: TwitchSession[] = [];
    const orchestrator = createSessionOrchestrator(state, {
      tabsApi: {
        async query() {
          return [];
        },
        async sendMessage() {
          return { success: true, session: validSession };
        },
      },
      scriptingApi: {
        async executeScript(details: chrome.scripting.ScriptInjection<[], unknown>) {
          injectedTabs.push(details.target.tabId);
          return [];
        },
      },
      sanitizeTwitchSession: (candidate) => (candidate === validSession ? validSession : null),
      sessionDebugSummary: () => ({ available: true }),
      readTwitchSessionViaExecuteScript: async () => null,
      persistTwitchSession: async (session) => {
        persisted.push(session);
      },
      logDebug: () => {},
      logWarn: () => {},
    });

    const session = await orchestrator.persistSessionFromDropsPage(77);

    expect(session).toBe(validSession);
    expect(state.twitchSessionCache).toBe(validSession);
    expect(state.twitchSessionLastAttemptAt).toBe(0);
    expect(injectedTabs).toEqual([77]);
    expect(persisted).toEqual([validSession]);
  });

  test('retries session extraction when the Drops page is loaded before Twitch storage is ready', async () => {
    const state = createState();
    const sendAttempts: Array<number> = [];
    const persisted: TwitchSession[] = [];
    const orchestrator = createSessionOrchestrator(state, {
      tabsApi: {
        async query() {
          return [];
        },
        async sendMessage() {
          sendAttempts.push(1);
          if (sendAttempts.length < 2) {
            return { success: false };
          }
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
      persistTwitchSession: async (session) => {
        persisted.push(session);
      },
      sessionReadAttempts: 3,
      sessionReadRetryDelayMs: 0,
      logDebug: () => {},
      logWarn: () => {},
    });

    const session = await orchestrator.persistSessionFromDropsPage(88);

    expect(session).toBe(validSession);
    expect(sendAttempts).toHaveLength(2);
    expect(state.twitchSessionCache).toBe(validSession);
    expect(persisted).toEqual([validSession]);
  });
});
