import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { StreamRotationReason } from '../../src/background/stream-rotation.ts';
import { OFFLINE_CONFIRMATION_CHECKS } from '../../src/background/stream-rotation.ts';
import { rotateStreamerIfInvalid } from '../../src/background/streamer-acquisition.ts';
import { createDrop, createGame, createMinimalState } from '../fixtures/queue-management.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';

export function registerQueue24Part04() {
  describe('rotateStreamerIfInvalid', () => {
    let mocks: ChromeMocks;

    beforeEach(() => {
      mocks = setupChromeMocks();
    });

    afterEach(() => {
      mocks.teardown();
    });

    test('keeps current streamer when long-drop progress is active despite invalid page signals', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame({ name: 'Test Game', categorySlug: 'test-game' });
      state.appState.tabId = 123;
      state.appState.currentDrop = createDrop({ requiredMinutes: 240, currentMinutes: 61, progress: 25 });
      state.lastProgressAdvanceAt = Date.now() - 8 * 60 * 1000;
      state.invalidStreamChecks = 7;
      state.lastStreamRotationAt = 0;

      mocks.tabs.setTabsGetResult({ id: 123, url: 'https://twitch.tv/streamer' });

      let rotateReason: StreamRotationReason | null = null;
      await rotateStreamerIfInvalid(state, {
        onFetchStreamContext: async () => ({
          channelName: 'streamer',
          categorySlug: 'other-game',
          categoryLabel: 'Other Game',
          streamTitle: 'Stream Title',
          titleContainsDrops: false,
          hasDropsSignal: false,
          isLive: true,
          pageUrl: 'https://twitch.tv/streamer',
        }),
        onResolveCategorySlug: async () => 'test-game',
        onRotateStreamer: async (_, reason) => {
          rotateReason = reason;
          return true;
        },
      });

      expect(rotateReason).toBeNull();
      expect(state.invalidStreamChecks).toBe(0);
    });

    test('clears recovery state when rotating from offline after stalled recovery', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame({ name: 'Test Game', categorySlug: 'test-game' });
      state.appState.tabId = 123;
      state.appState.currentDrop = createDrop();
      state.appState.recoveryReason = 'stalled-progress';
      state.stalledRecoveryAttempts = 2;
      state.lastProgressAdvanceAt = Date.now();
      // One prior offline reading already on record so this one confirms the outage.
      state.offlineChecks = OFFLINE_CONFIRMATION_CHECKS - 1;

      mocks.tabs.setTabsGetResult({ id: 123, url: 'https://twitch.tv/streamer' });

      await rotateStreamerIfInvalid(state, {
        onFetchStreamContext: async () => ({
          channelName: 'streamer',
          categorySlug: 'test-game',
          categoryLabel: 'Test Game',
          streamTitle: 'Stream Title',
          titleContainsDrops: true,
          hasDropsSignal: true,
          isLive: false,
          pageUrl: 'https://twitch.tv/streamer',
        }),
        onResolveCategorySlug: async () => 'test-game',
        onRotateStreamer: async () => {},
      });

      expect(state.appState.recoveryReason).toBeNull();
      expect(state.stalledRecoveryAttempts).toBe(0);
    });
  });
}
