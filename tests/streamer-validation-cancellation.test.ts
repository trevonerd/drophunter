import { describe, expect, test } from 'bun:test';
import { invalidateFarmingSessionEpoch } from '../src/background/farming-session-revision.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { rotateStreamerIfInvalid } from '../src/background/streamer-validation.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

describe('streamer validation cancellation', () => {
  for (const action of ['stop', 'restart', 'selection'] as const) {
    test.each([
      'tab',
      'missing-tab',
      'context',
      'category',
    ] as const)(`ignores pending %s validation after ${action}`, async (boundary) => {
      const mocks = setupChromeMocks();
      try {
        const state = createServiceWorkerState();
        const campaign = { id: 'game-a', campaignId: 'campaign-a', name: 'Game A', imageUrl: '' };
        state.appState.selectedGame = campaign;
        state.appState.isRunning = true;
        state.appState.tabId = 8;
        state.invalidStreamChecks = 3;
        state.offlineChecks = 2;
        let enterBoundary: () => void = () => undefined;
        const entered = new Promise<void>((resolve) => {
          enterBoundary = resolve;
        });
        let finishBoundary: () => void = () => undefined;
        const finished = new Promise<void>((resolve) => {
          finishBoundary = resolve;
        });
        const waitAt = async (candidate: string) => {
          if (boundary !== candidate) return;
          enterBoundary();
          await finished;
        };
        mocks.tabs.get = async (id) => {
          await waitAt(boundary === 'missing-tab' ? 'missing-tab' : 'tab');
          if (boundary === 'missing-tab') throw new Error('tab closed');
          return { id, url: 'https://www.twitch.tv/channel-a', windowId: 1, status: 'complete' };
        };
        const effects: string[] = [];
        const pending = rotateStreamerIfInvalid(state, {
          onFetchStreamContext: async () => {
            await waitAt('context');
            return {
              channelName: 'channel-a',
              categorySlug: 'wrong-game',
              categoryLabel: 'Wrong game',
              streamTitle: 'Drops',
              titleContainsDrops: true,
              hasDropsSignal: true,
              isLive: true,
              pageUrl: 'https://www.twitch.tv/channel-a',
            };
          },
          onResolveCategorySlug: async () => {
            await waitAt('category');
            return 'game-a';
          },
          onRotateStreamer: async () => {
            effects.push('rotate');
            return true;
          },
        });
        await entered;
        if (action !== 'selection') invalidateFarmingSessionEpoch(state);
        state.appState.isRunning = action !== 'stop';
        state.appState.selectedGame =
          action === 'stop'
            ? null
            : { ...campaign, campaignId: action === 'selection' ? 'campaign-b' : 'campaign-a' };
        const expectedState = structuredClone(state);
        finishBoundary();
        await pending;
        expect(state).toEqual(expectedState);
        expect(effects).toEqual([]);
      } finally {
        mocks.teardown();
      }
    });
  }
});
