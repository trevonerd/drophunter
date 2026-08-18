import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { StreamRotationReason } from '../../src/background/stream-rotation.ts';
import { rotateStreamerIfInvalid } from '../../src/background/streamer-acquisition.ts';
import { createDrop, createGame, createMinimalState } from '../fixtures/queue-management.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';

export function registerQueue24Part01() {
  describe('rotateStreamerIfInvalid', () => {
    let mocks: ChromeMocks;

    beforeEach(() => {
      mocks = setupChromeMocks();
    });

    afterEach(() => {
      mocks.teardown();
    });

    test('returns early if no selected game', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = null;

      let rotateStreamerCalled = false;
      await rotateStreamerIfInvalid(state, {
        onRotateStreamer: async () => {
          rotateStreamerCalled = true;
        },
      });

      expect(rotateStreamerCalled).toBe(false);
    });

    test('rotates when no tabId and not in recovery backoff', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame();
      state.appState.tabId = null;
      state.recoveryBackoffUntil = 0;

      let rotateReason: StreamRotationReason | null = null;
      await rotateStreamerIfInvalid(state, {
        onRotateStreamer: async (_, reason) => {
          rotateReason = reason;
        },
      });

      expect(rotateReason).toBe('open-failed');
    });

    test('does not rotate when in recovery backoff for open-failed', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame();
      state.appState.tabId = null;
      state.recoveryBackoffUntil = Date.now() + 60000;
      state.appState.recoveryReason = 'open-failed';

      let rotateStreamerCalled = false;
      await rotateStreamerIfInvalid(state, {
        onRotateStreamer: async () => {
          rotateStreamerCalled = true;
        },
      });

      expect(rotateStreamerCalled).toBe(false);
    });

    test('clears tabId when tab not found', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame();
      state.appState.tabId = 999;

      await rotateStreamerIfInvalid(state, {
        onRotateStreamer: async () => {},
      });

      expect(state.appState.tabId).toBeNull();
      expect(state.appState.activeStreamer).toBeNull();
    });

    test('returns early during stream validation grace period', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame();
      state.appState.tabId = 123;
      state.streamValidationGraceUntil = Date.now() + 60000;

      let fetchContextCalled = false;
      mocks.tabs.setTabsGetResult({ id: 123, url: 'https://twitch.tv/streamer' });

      await rotateStreamerIfInvalid(state, {
        onFetchStreamContext: async () => {
          fetchContextCalled = true;
          return null;
        },
      });

      expect(fetchContextCalled).toBe(true);
    });

    test('increments invalidStreamChecks when context is null but on Twitch', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame();
      state.appState.tabId = 123;
      state.invalidStreamChecks = 0;

      mocks.tabs.setTabsGetResult({ id: 123, url: 'https://twitch.tv/streamer' });

      await rotateStreamerIfInvalid(state, {
        onFetchStreamContext: async () => null,
      });

      expect(state.invalidStreamChecks).toBe(1);
    });

    test('keeps current streamer when context is missing but drop progress is recent', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame();
      state.appState.tabId = 123;
      state.appState.currentDrop = createDrop({ requiredMinutes: 60, currentMinutes: 12 });
      state.lastProgressAdvanceAt = Date.now();
      state.invalidStreamChecks = 7;

      mocks.tabs.setTabsGetResult({ id: 123, url: 'https://twitch.tv/streamer' });

      let rotateStreamerCalled = false;
      await rotateStreamerIfInvalid(state, {
        onFetchStreamContext: async () => null,
        onRotateStreamer: async () => {
          rotateStreamerCalled = true;
          return true;
        },
      });

      expect(rotateStreamerCalled).toBe(false);
      expect(state.invalidStreamChecks).toBe(0);
    });

    test('rotates on missing context when progress is not recent and invalid checks reach threshold', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame();
      state.appState.tabId = 123;
      state.appState.currentDrop = createDrop({ requiredMinutes: 60, currentMinutes: 12 });
      state.lastProgressAdvanceAt = Date.now() - 10 * 60 * 1000;
      state.invalidStreamChecks = 7;
      state.lastStreamRotationAt = 0;

      mocks.tabs.setTabsGetResult({ id: 123, url: 'https://twitch.tv/streamer' });

      let rotateReason: StreamRotationReason | null = null;
      await rotateStreamerIfInvalid(state, {
        onFetchStreamContext: async () => null,
        onRotateStreamer: async (_, reason) => {
          rotateReason = reason;
          return true;
        },
      });

      expect(rotateReason).toBe('missing-context');
      expect(state.invalidStreamChecks).toBe(0);
    });

    test('sets invalidStreamChecks to threshold when navigated away from Twitch', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame();
      state.appState.tabId = 123;
      state.invalidStreamChecks = 0;
      state.lastStreamRotationAt = Date.now();

      mocks.tabs.setTabsGetResult({ id: 123, url: 'https://youtube.com/watch' });

      await rotateStreamerIfInvalid(state, {
        onFetchStreamContext: async () => null,
      });

      expect(state.invalidStreamChecks).toBe(8);
    });

    test('rotates when invalidStreamChecks reaches threshold', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame();
      state.appState.tabId = 123;
      state.invalidStreamChecks = 7;
      state.lastStreamRotationAt = 0;

      mocks.tabs.setTabsGetResult({ id: 123, url: 'https://twitch.tv/streamer' });

      let rotateReason: StreamRotationReason | null = null;
      await rotateStreamerIfInvalid(state, {
        onFetchStreamContext: async () => null,
        onRotateStreamer: async (_, reason) => {
          rotateReason = reason;
        },
      });

      expect(rotateReason).toBe('missing-context');
      expect(state.invalidStreamChecks).toBe(0);
    });

    test('does not rotate when within cooldown period', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame();
      state.appState.tabId = 123;
      state.invalidStreamChecks = 8;
      state.lastStreamRotationAt = Date.now();

      mocks.tabs.setTabsGetResult({ id: 123, url: 'https://twitch.tv/streamer' });

      let rotateStreamerCalled = false;
      await rotateStreamerIfInvalid(state, {
        onFetchStreamContext: async () => null,
        onRotateStreamer: async () => {
          rotateStreamerCalled = true;
        },
      });

      expect(rotateStreamerCalled).toBe(false);
    });

    test('resets invalidStreamChecks when stream is healthy', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame();
      state.appState.tabId = 123;
      state.invalidStreamChecks = 3;
      state.appState.activeStreamer = {
        id: 'streamer-1',
        name: 'streamer',
        displayName: 'Streamer',
        isLive: true,
      };

      mocks.tabs.setTabsGetResult({ id: 123, url: 'https://twitch.tv/streamer' });

      await rotateStreamerIfInvalid(state, {
        onFetchStreamContext: async () => ({
          channelName: 'streamer',
          categorySlug: 'test-game',
          categoryLabel: 'Test Game',
          streamTitle: 'Playing Test Game',
          titleContainsDrops: true,
          hasDropsSignal: true,
          isLive: true,
          pageUrl: 'https://twitch.tv/streamer',
        }),
        onResolveCategorySlug: async () => 'test-game',
      });

      expect(state.invalidStreamChecks).toBe(0);
    });
  });
}
