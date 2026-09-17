import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createServiceWorkerState } from '../../src/background/runtime-state.ts';
import { createServiceWorkerContentHandlers } from '../../src/background/service-worker-content-handlers.ts';
import { type ChromeMocks, setupChromeMocks } from '../mocks/chrome.ts';
import {
  createContentDependencies,
  disabledAutomation,
  game,
} from '../support/farming-automation-runtime-wiring-fixture.ts';

const twitchSender: chrome.runtime.MessageSender = {
  url: 'https://www.twitch.tv/drops/campaigns',
};

const freshSession = {
  oauthToken: 'fresh-token-with-enough-length',
  userId: 'viewer-1',
  deviceId: 'device-1',
  uuid: 'uuid-1',
} as const;

describe('farming automation runtime session recovery', () => {
  let chromeMocks: ChromeMocks;

  beforeEach(() => {
    chromeMocks = setupChromeMocks();
  });

  afterEach(() => {
    chromeMocks.teardown();
  });

  test('resumes a farming session stopped by an older authentication flow', async () => {
    const state = createServiceWorkerState();
    state.appState.selectedGame = game;
    state.appState.queue = [game];
    state.appState.lastStopReason = 'sign-in-required';
    state.apiConsecutiveFailures = 3;
    state.apiBackoffUntil = Date.now() + 60_000;
    let resumeCalls = 0;
    const content = createServiceWorkerContentHandlers(
      state,
      createContentDependencies(disabledAutomation(), async () => {
        resumeCalls += 1;
        state.appState.isRunning = true;
      }),
    );

    const result = await content.handleSyncTwitchSession(freshSession, twitchSender);

    expect(result).toEqual({ success: true });
    expect(resumeCalls).toBe(1);
    expect(state.appState.isRunning).toBe(true);
    expect(state.appState.lastStopReason).toBeNull();
    expect(state.apiBackoffUntil).toBe(0);
  });

  test('does not resume a manually stopped session after Twitch sync', async () => {
    const state = createServiceWorkerState();
    state.appState.selectedGame = game;
    state.appState.queue = [game];
    state.appState.lastStopReason = 'user-stop';
    let resumeCalls = 0;
    const content = createServiceWorkerContentHandlers(
      state,
      createContentDependencies(disabledAutomation(), async () => {
        resumeCalls += 1;
      }),
    );

    const result = await content.handleSyncTwitchSession(freshSession, twitchSender);

    expect(result).toEqual({ success: true });
    expect(resumeCalls).toBe(0);
    expect(state.appState.lastStopReason).toBe('user-stop');
  });
});
