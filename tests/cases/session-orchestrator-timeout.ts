import { expect, spyOn, test } from 'bun:test';
import { createSessionOrchestrator } from '../../src/background/session-orchestrator.ts';
import { createInitialState } from '../../src/shared/utils.ts';

test('auth timeout prevents a late open-tab read from creating a Drops tab', async () => {
  let releaseRead: () => void = () => {};
  const readGate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  let createCalls = 0;
  const orchestrator = createSessionOrchestrator(
    { appState: createInitialState(), twitchSessionCache: null, twitchSessionLastAttemptAt: 0 },
    {
      tabsApi: {
        async query() {
          return [{ id: 51, url: 'https://www.twitch.tv/drops/inventory', active: false }];
        },
        async create() {
          createCalls += 1;
          return null;
        },
        async sendMessage() {
          await readGate;
          return { success: false };
        },
      },
      scriptingApi: {
        async executeScript() {
          return [];
        },
      },
      sanitizeTwitchSession: () => null,
      sessionDebugSummary: () => ({}),
      readTwitchSessionViaExecuteScript: async () => null,
      persistTwitchSession: async () => {},
      discardPersistedTwitchSessionIfMatches: async () => {},
      validateRecoveredTwitchSession: async () => true,
      getSessionRevision: () => 0,
      authRecoveryTimeoutMs: 25,
      logDebug: () => {},
      logWarn: () => {},
    },
  );

  const recovery = orchestrator.recoverTwitchSessionAfterAuthError('background-tab');
  await new Promise((resolve) => setTimeout(resolve, 40));
  releaseRead();
  expect(await recovery).toBeNull();
  await Promise.resolve();
  expect(createCalls).toBe(0);
});

test('auth timeout closes an owned Drops tab when readiness never completes', async () => {
  let readinessStarted = false;
  let signalRemoval: () => void = () => {};
  const removed = new Promise<void>((resolve) => {
    signalRemoval = resolve;
  });
  const tab = { id: 52, url: 'https://www.twitch.tv/drops/inventory', active: false, windowId: 7 };
  const never = new Promise<void>(() => {});
  const orchestrator = createSessionOrchestrator(
    { appState: createInitialState(), twitchSessionCache: null, twitchSessionLastAttemptAt: 0 },
    {
      tabsApi: {
        async query(query) {
          return query.windowId ? [{ id: 1 }, tab] : [];
        },
        async create() {
          return tab;
        },
        async get() {
          return tab;
        },
        async remove() {
          signalRemoval();
        },
        async sendMessage() {
          return { success: false };
        },
      },
      sanitizeTwitchSession: () => null,
      sessionDebugSummary: () => ({}),
      readTwitchSessionViaExecuteScript: async () => null,
      persistTwitchSession: async () => {},
      discardPersistedTwitchSessionIfMatches: async () => {},
      validateRecoveredTwitchSession: async () => true,
      getSessionRevision: () => 0,
      waitForTabComplete: async () => {
        readinessStarted = true;
        return never;
      },
      authRecoveryTimeoutMs: 1,
      logDebug: () => {},
      logWarn: () => {},
    },
  );

  const clock = spyOn(Date, 'now').mockReturnValue(Date.now());
  try {
    expect(await orchestrator.recoverTwitchSessionAfterAuthError('background-tab')).toBeNull();
    expect(readinessStarted).toBe(true);
    await removed;
  } finally {
    clock.mockRestore();
  }
});
