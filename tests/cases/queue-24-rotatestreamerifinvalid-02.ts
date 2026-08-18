import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { StreamRotationReason } from '../../src/background/stream-rotation.ts';
import { rotateStreamerIfInvalid } from '../../src/background/streamer-acquisition.ts';
import { createDrop, createGame, createMinimalState } from '../fixtures/queue-management.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';

export function registerQueue24Part02() {
  describe('rotateStreamerIfInvalid', () => {
    let mocks: ChromeMocks;

    beforeEach(() => {
      mocks = setupChromeMocks();
    });

    afterEach(() => {
      mocks.teardown();
    });

    test('rotates only after consecutive offline readings are confirmed', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame({ name: 'Test Game', categorySlug: 'test-game' });
      state.appState.tabId = 123;
      state.appState.currentDrop = createDrop();
      state.lastProgressAdvanceAt = Date.now();

      mocks.tabs.setTabsGetResult({ id: 123, url: 'https://twitch.tv/streamer' });

      const offlineContext = {
        channelName: 'streamer',
        categorySlug: 'test-game',
        categoryLabel: 'Test Game',
        streamTitle: 'Stream Title',
        titleContainsDrops: true,
        hasDropsSignal: true,
        isLive: false,
        pageUrl: 'https://twitch.tv/streamer',
      };

      let rotateReason: StreamRotationReason | null = null;
      const opts = {
        onFetchStreamContext: async () => offlineContext,
        onResolveCategorySlug: async () => 'test-game',
        onRotateStreamer: async (_, reason) => {
          rotateReason = reason;
        },
      };

      // First offline reading is not enough — a single one is usually a transient ad break.
      await rotateStreamerIfInvalid(state, opts);
      expect(rotateReason).toBeNull();
      expect(state.offlineChecks).toBe(1);

      // Second consecutive offline reading confirms the outage and rotates.
      await rotateStreamerIfInvalid(state, opts);
      expect(rotateReason).toBe('offline');
    });

    test('a single offline reading does not rotate while a live reading resets the streak', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame({ name: 'Test Game', categorySlug: 'test-game' });
      state.appState.tabId = 123;
      state.appState.currentDrop = createDrop();
      state.lastProgressAdvanceAt = Date.now();

      mocks.tabs.setTabsGetResult({ id: 123, url: 'https://twitch.tv/streamer' });

      const baseContext = {
        channelName: 'streamer',
        categorySlug: 'test-game',
        categoryLabel: 'Test Game',
        streamTitle: 'Stream Title',
        titleContainsDrops: true,
        hasDropsSignal: true,
        pageUrl: 'https://twitch.tv/streamer',
      };

      let isLive = false;
      let rotateReason: StreamRotationReason | null = null;
      const opts = {
        onFetchStreamContext: async () => ({ ...baseContext, isLive }),
        onResolveCategorySlug: async () => 'test-game',
        onRotateStreamer: async (_, reason) => {
          rotateReason = reason;
        },
      };

      await rotateStreamerIfInvalid(state, opts); // offline #1 -> defer
      expect(state.offlineChecks).toBe(1);

      isLive = true;
      await rotateStreamerIfInvalid(state, opts); // live -> reset streak
      expect(state.offlineChecks).toBe(0);

      isLive = false;
      await rotateStreamerIfInvalid(state, opts); // offline #1 again -> defer, no rotation
      expect(rotateReason).toBeNull();
      expect(state.offlineChecks).toBe(1);
    });

    test('enters recovery mode when progress is stalled', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame({ name: 'Test Game', categorySlug: 'test-game' });
      state.appState.tabId = 123;
      state.appState.currentDrop = createDrop({ requiredMinutes: 60 });
      state.lastProgressAdvanceAt = Date.now() - 10 * 60 * 1000;

      mocks.tabs.setTabsGetResult({ id: 123, url: 'https://twitch.tv/streamer' });

      let attemptSelfHealCalled = false;
      await rotateStreamerIfInvalid(state, {
        onFetchStreamContext: async () => ({
          channelName: 'streamer',
          categorySlug: 'test-game',
          categoryLabel: 'Test Game',
          streamTitle: 'Stream Title',
          titleContainsDrops: true,
          hasDropsSignal: true,
          isLive: true,
          pageUrl: 'https://twitch.tv/streamer',
        }),
        onResolveCategorySlug: async () => 'test-game',
        onAttemptPlaybackSelfHeal: async () => {
          attemptSelfHealCalled = true;
        },
      });

      expect(attemptSelfHealCalled).toBe(true);
      expect(state.stalledRecoveryAttempts).toBe(1);
      expect(state.appState.recoveryReason).toBe('stalled-progress');
      expect(state.appState.recoveryAttempts).toBe(1);
    });

    test('does not enter recovery for a healthy 4-hour drop with slow progress updates', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame({ name: 'Test Game', categorySlug: 'test-game' });
      state.appState.tabId = 123;
      state.appState.currentDrop = createDrop({ requiredMinutes: 240, currentMinutes: 61, progress: 25 });
      state.lastProgressAdvanceAt = Date.now() - 8 * 60 * 1000;

      mocks.tabs.setTabsGetResult({ id: 123, url: 'https://twitch.tv/streamer' });

      let attemptSelfHealCalled = false;
      let rotateReason: StreamRotationReason | null = null;
      await rotateStreamerIfInvalid(state, {
        onFetchStreamContext: async () => ({
          channelName: 'streamer',
          categorySlug: 'test-game',
          categoryLabel: 'Test Game',
          streamTitle: 'Stream Title',
          titleContainsDrops: true,
          hasDropsSignal: true,
          isLive: true,
          pageUrl: 'https://twitch.tv/streamer',
        }),
        onResolveCategorySlug: async () => 'test-game',
        onAttemptPlaybackSelfHeal: async () => {
          attemptSelfHealCalled = true;
        },
        onRotateStreamer: async (_, reason) => {
          rotateReason = reason;
        },
      });

      expect(attemptSelfHealCalled).toBe(false);
      expect(rotateReason).toBeNull();
      expect(state.stalledRecoveryAttempts).toBe(0);
      expect(state.appState.recoveryReason).toBeNull();
    });

    test('rotates with a bounded stalled attempt count when past recovery backoff', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame({ name: 'Test Game', categorySlug: 'test-game' });
      state.appState.tabId = 123;
      state.appState.currentDrop = createDrop({ requiredMinutes: 60 });
      state.lastProgressAdvanceAt = Date.now() - 10 * 60 * 1000;
      state.lastRecoveryAttemptAt = Date.now() - 5 * 60 * 1000;
      state.stalledRecoveryAttempts = 2;
      state.invalidStreamChecks = 8;
      state.lastStreamRotationAt = 0;
      state.appState.recoveryBackoffUntil = Date.now() - 60 * 1000;
      state.appState.recoveryReason = 'stalled-progress';

      mocks.tabs.setTabsGetResult({ id: 123, url: 'https://twitch.tv/streamer' });

      let rotateReason: StreamRotationReason | null = null;
      await rotateStreamerIfInvalid(state, {
        onFetchStreamContext: async () => ({
          channelName: 'streamer',
          categorySlug: 'test-game',
          categoryLabel: 'Test Game',
          streamTitle: 'Stream Title',
          titleContainsDrops: true,
          hasDropsSignal: true,
          isLive: true,
          pageUrl: 'https://twitch.tv/streamer',
        }),
        onResolveCategorySlug: async () => 'test-game',
        onRotateStreamer: async (_, reason) => {
          rotateReason = reason;
        },
      });

      expect(rotateReason).toBe('stalled-progress');
      expect(state.stalledRecoveryAttempts).toBe(3);
      expect(state.appState.recoveryAttempts).toBe(3);
    });

    test('rotates on the second stall even when a rotation happened within the cooldown window', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame({ name: 'Test Game', categorySlug: 'test-game' });
      state.appState.tabId = 123;
      state.appState.currentDrop = createDrop({ requiredMinutes: 60 });
      state.lastProgressAdvanceAt = Date.now() - 10 * 60 * 1000;
      // Self-heal already happened once, and a recent rotation would block the generic cooldown.
      state.stalledRecoveryAttempts = 1;
      state.lastStreamRotationAt = Date.now();

      mocks.tabs.setTabsGetResult({ id: 123, url: 'https://twitch.tv/streamer' });

      let rotateReason: StreamRotationReason | null = null;
      let selfHealCalled = false;
      await rotateStreamerIfInvalid(state, {
        onFetchStreamContext: async () => ({
          channelName: 'streamer',
          categorySlug: 'test-game',
          categoryLabel: 'Test Game',
          streamTitle: 'Stream Title',
          titleContainsDrops: true,
          hasDropsSignal: true,
          isLive: true,
          pageUrl: 'https://twitch.tv/streamer',
        }),
        onResolveCategorySlug: async () => 'test-game',
        onAttemptPlaybackSelfHeal: async () => {
          selfHealCalled = true;
        },
        onRotateStreamer: async (_, reason) => {
          rotateReason = reason;
        },
      });

      expect(selfHealCalled).toBe(false);
      expect(rotateReason).toBe('stalled-progress');
      expect(state.stalledRecoveryAttempts).toBe(2);
    });
  });
}
