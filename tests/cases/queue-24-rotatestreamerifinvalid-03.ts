import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ServiceWorkerState } from '../../src/background/service-worker.ts';
import type { StalledProgressSource } from '../../src/background/stalled-progress-recovery.ts';
import { rotateStreamerIfInvalid } from '../../src/background/streamer-acquisition.ts';
import type { TwitchDrop } from '../../src/types/index.ts';
import { createDrop, createGame, createMinimalState } from '../fixtures/queue-management.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';
import { rotateIfInvalidOptions } from '../support/rotate-streamer-if-invalid-options.ts';

export function registerQueue24Part03() {
  describe('rotateStreamerIfInvalid', () => {
    let mocks: ChromeMocks;

    beforeEach(() => {
      mocks = setupChromeMocks();
    });

    afterEach(() => {
      mocks.teardown();
    });

    async function runNoDropsSignalScenario(options: {
      pendingDrops?: TwitchDrop[];
      currentDrop?: TwitchDrop;
    }): Promise<{ state: ServiceWorkerState; rotateCalls: number }> {
      const state = createMinimalState();
      state.appState.selectedGame = createGame({ name: 'Test Game', categorySlug: 'test-game' });
      state.appState.tabId = 123;
      state.appState.pendingDrops = options.pendingDrops ?? [];
      if (options.currentDrop) {
        state.appState.currentDrop = options.currentDrop;
      }

      mocks.tabs.setTabsGetResult({ id: 123, url: 'https://twitch.tv/streamer' });

      let rotateCalls = 0;
      const opts = rotateIfInvalidOptions({
        onFetchStreamContext: async () => ({
          channelName: 'streamer',
          categorySlug: 'test-game',
          categoryLabel: 'Test Game',
          streamTitle: 'Stream Title',
          titleContainsDrops: false,
          hasDropsSignal: false,
          isLive: true,
          pageUrl: 'https://twitch.tv/streamer',
        }),
        onResolveCategorySlug: async () => 'test-game',
        onRotateStreamer: async () => {
          rotateCalls += 1;
          return true;
        },
      });

      for (let attempt = 0; attempt < 8; attempt += 1) {
        await rotateStreamerIfInvalid(state, opts);
      }

      return { state, rotateCalls };
    }

    test('delegates a confirmed stall to stalled-progress recovery without rotating', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame({ name: 'Test Game', categorySlug: 'test-game' });
      state.appState.tabId = 123;
      state.appState.currentDrop = createDrop({ requiredMinutes: 60 });
      state.lastProgressAdvanceAt = Date.now() - 10 * 60 * 1000;
      state.stalledRecoveryAttempts = 1;
      state.lastStreamRotationAt = 0;

      mocks.tabs.setTabsGetResult({ id: 123, url: 'https://twitch.tv/streamer' });

      const stallSources: StalledProgressSource[] = [];
      let rotateCalled = false;
      await rotateStreamerIfInvalid(
        state,
        rotateIfInvalidOptions({
          onRecoverStalledProgress: async (source) => {
            stallSources.push(source);
            return { kind: 'recovered' };
          },
          onRotateStreamer: async () => {
            rotateCalled = true;
            return true;
          },
        }),
      );

      expect(stallSources).toEqual([{ kind: 'managed-tab', tabId: 123 }]);
      expect(rotateCalled).toBe(false);
      expect(state.stalledRecoveryAttempts).toBe(1);
    });
    test('does not increment checks when progress is live with weak signal', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame({ name: 'Test Game', categorySlug: 'test-game' });
      state.appState.tabId = 123;
      state.appState.currentDrop = createDrop();
      state.lastProgressAdvanceAt = Date.now();
      state.invalidStreamChecks = 3;

      mocks.tabs.setTabsGetResult({ id: 123, url: 'https://twitch.tv/streamer' });

      await rotateStreamerIfInvalid(
        state,
        rotateIfInvalidOptions({
          onFetchStreamContext: async () => ({
            channelName: 'streamer',
            categorySlug: 'test-game',
            categoryLabel: 'Test Game',
            streamTitle: 'Stream Title',
            titleContainsDrops: false,
            hasDropsSignal: false,
            isLive: true,
            pageUrl: 'https://twitch.tv/streamer',
          }),
          onResolveCategorySlug: async () => 'test-game',
        }),
      );

      expect(state.invalidStreamChecks).toBe(0);
    });

    test('does not recover for a pending unverifiable Twitch-native reward without Drops signal', async () => {
      const { state, rotateCalls } = await runNoDropsSignalScenario({
        pendingDrops: [
          createDrop({
            rewardKind: 'twitch-badge',
            verificationState: 'unverifiable',
          }),
        ],
      });

      expect(rotateCalls).toBe(0);
      expect(state.invalidStreamChecks).toBe(0);
    });

    test('does not recover for a pending subscription-gated remainder without Drops signal', async () => {
      const { state, rotateCalls } = await runNoDropsSignalScenario({
        pendingDrops: [createDrop({ acquisitionMethod: 'subscription' })],
      });

      expect(rotateCalls).toBe(0);
      expect(state.invalidStreamChecks).toBe(0);
    });

    test('does not recover when the current reward is a non-automatable remainder', async () => {
      const { state, rotateCalls } = await runNoDropsSignalScenario({
        currentDrop: createDrop({ acquisitionMethod: 'subscription' }),
      });

      expect(rotateCalls).toBe(0);
      expect(state.invalidStreamChecks).toBe(0);
    });

    test('keeps Drops-signal recovery for pending watch-time, unknown, and fresh Twitch-native rewards', async () => {
      const { state, rotateCalls } = await runNoDropsSignalScenario({
        pendingDrops: [
          createDrop({ id: 'watch-time', acquisitionMethod: 'watch-time' }),
          createDrop({ id: 'unknown', acquisitionMethod: 'unknown' }),
          createDrop({
            id: 'fresh-twitch-native',
            rewardKind: 'twitch-emote',
            verificationState: 'unassessed',
          }),
        ],
      });

      expect(rotateCalls).toBe(1);
      expect(state.invalidStreamChecks).toBe(0);
    });

    test('does not recover for an event-only pending remainder without Drops signal', async () => {
      const { state, rotateCalls } = await runNoDropsSignalScenario({
        pendingDrops: [createDrop({ acquisitionMethod: 'other-event' })],
      });

      expect(rotateCalls).toBe(0);
      expect(state.invalidStreamChecks).toBe(0);
    });
  });
}
