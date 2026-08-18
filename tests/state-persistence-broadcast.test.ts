import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  broadcastStateUpdate,
  clearPendingTimingStateSaveForTests,
  shouldRefreshGamesCache,
} from '../src/background/state-persistence.ts';
import { createAppState, createMinimalState } from './fixtures/state-persistence.ts';
import { createTwitchDrop } from './fixtures/twitch-drop.ts';
import { type ChromeMocks, setupChromeMocks } from './mocks/chrome.ts';

describe('shouldRefreshGamesCache', () => {
  test('returns true when force=true', () => {
    const state = createMinimalState({ lastGamesCacheRefreshAt: Date.now() });
    expect(shouldRefreshGamesCache(state, true)).toBe(true);
  });

  test('returns true when cache is stale', () => {
    const state = createMinimalState({ lastGamesCacheRefreshAt: 0 });
    expect(shouldRefreshGamesCache(state, false)).toBe(true);
  });

  test('returns false when cache is still fresh (GAMES_CACHE_TTL_MS = 5 min)', () => {
    const state = createMinimalState({ lastGamesCacheRefreshAt: Date.now() });
    expect(shouldRefreshGamesCache(state, false)).toBe(false);
  });
});

describe('broadcastStateUpdate', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    clearPendingTimingStateSaveForTests();
    mocks.teardown();
  });

  test('sets badge with progress percent when currentDrop present and running', () => {
    const appState = createAppState({
      isRunning: true,
      currentDrop: createTwitchDrop({ id: 'd1', progress: 55 }),
    });

    broadcastStateUpdate(appState);

    expect(mocks.action.getBadgeState().text).toBe('55%');
  });

  test('sets badge with ... when running but no currentDrop', () => {
    const appState = createAppState({ isRunning: true, currentDrop: null });

    broadcastStateUpdate(appState);

    expect(mocks.action.getBadgeState().text).toBe('...');
  });

  test('clears badge when not running', () => {
    const appState = createAppState({ isRunning: false });

    broadcastStateUpdate(appState);

    expect(mocks.action.getBadgeState().text).toBe('');
  });

  test('clears badge when isPaused even if isRunning is true', () => {
    const appState = createAppState({ isRunning: true, isPaused: true });

    broadcastStateUpdate(appState);

    expect(mocks.action.getBadgeState().text).toBe('...');
  });

  test('sends UPDATE_STATE message via chrome.runtime.sendMessage', () => {
    const appState = createAppState({ isRunning: false });
    let captured: unknown = null;
    mocks.chrome.runtime.sendMessage = (message) => {
      captured = message;
      return Promise.resolve(undefined);
    };

    broadcastStateUpdate(appState);

    expect(captured).toEqual({ type: 'UPDATE_STATE', payload: appState });
  });

  test('sets badge background color to #9146FF', () => {
    const appState = createAppState({
      isRunning: true,
      currentDrop: createTwitchDrop({ id: 'd1', progress: 10 }),
    });

    broadcastStateUpdate(appState);

    expect(mocks.action.getBadgeState().color).toBe('#9146FF');
  });
});
