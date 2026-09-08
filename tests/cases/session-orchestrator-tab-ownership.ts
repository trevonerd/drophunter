import { expect, test } from 'bun:test';
import { createSessionOrchestrator } from '../../src/background/session-orchestrator.ts';
import type { TwitchSession } from '../../src/background/twitch-api/types.ts';
import { createInitialState } from '../../src/shared/utils.ts';

const session: TwitchSession = {
  oauthToken: 'oauth-token-with-enough-length',
  userId: '123',
  deviceId: 'device-id',
  uuid: 'session-uuid',
};

test('closes a temporary Drops tab only when it remains untouched', async () => {
  const events: string[] = [];
  const temporaryTab = { id: 80, url: 'https://www.twitch.tv/drops/inventory', active: false, windowId: 9 };
  const orchestrator = createSessionOrchestrator(
    { appState: createInitialState(), twitchSessionCache: null, twitchSessionLastAttemptAt: 0 },
    {
      tabsApi: {
        async query(query) {
          return query.windowId ? [{ id: 1 }, temporaryTab] : [];
        },
        async create(properties) {
          events.push(`create:${String(properties.active)}`);
          return temporaryTab;
        },
        async get() {
          return temporaryTab;
        },
        async remove(tabId) {
          events.push(`remove:${tabId}`);
        },
        async sendMessage(tabId) {
          events.push(`read:${tabId}`);
          return { success: true, session };
        },
      },
      scriptingApi: {
        async executeScript() {
          return [];
        },
      },
      sanitizeTwitchSession: (candidate) => (candidate === session ? session : null),
      sessionDebugSummary: () => ({}),
      readTwitchSessionViaExecuteScript: async () => null,
      persistTwitchSession: async () => {
        events.push('persist');
      },
      discardPersistedTwitchSessionIfMatches: async () => {},
      validateRecoveredTwitchSession: async () => true,
      getSessionRevision: () => 0,
      waitForTabComplete: async () => {
        events.push('wait');
      },
      sessionReadAttempts: 1,
      logDebug: () => {},
      logWarn: () => {},
    },
  );

  expect(await orchestrator.recoverTwitchSessionAfterAuthError('background-tab')).toBe(session);
  expect(events).toEqual(['create:false', 'wait', 'read:80', 'remove:80', 'persist']);
});
