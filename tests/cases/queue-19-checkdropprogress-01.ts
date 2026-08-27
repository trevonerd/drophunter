import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { checkDropProgress } from '../../src/background/drops-tick.ts';
import type { StreamRotationReason } from '../../src/background/stream-rotation.ts';
import { rotateStreamerIfInvalid } from '../../src/background/streamer-acquisition.ts';
import { createDrop, createGame, createMinimalState } from '../fixtures/queue-management.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';

export function registerQueue19Part01() {
  describe('checkDropProgress', () => {
    let mocks: ChromeMocks;

    beforeEach(() => {
      mocks = setupChromeMocks();
    });

    afterEach(() => {
      mocks.teardown();
    });

    test('refreshes drop data before stream validation so fresh progress prevents stalled recovery', async () => {
      const state = createMinimalState();
      state.appState.isRunning = true;
      state.appState.selectedGame = createGame({ name: 'Test Game', categorySlug: 'test-game' });
      state.appState.tabId = 123;
      state.appState.currentDrop = createDrop({ requiredMinutes: 60, currentMinutes: 12 });
      state.lastFullRefreshAt = Date.now();
      state.lastProgressAdvanceAt = Date.now() - 10 * 60 * 1000;

      mocks.tabs.setTabsGetResult({ id: 123, url: 'https://twitch.tv/streamer' });

      const calls: string[] = [];
      let attemptSelfHealCalled = false;
      let rotateReason: StreamRotationReason | null = null;

      await checkDropProgress(state, {
        onEnforcePlaybackPolicy: async () => {
          calls.push('playback-policy');
        },
        onAcquireStreamerForSelectedGame: async () => false,
        onRefreshDropsData: async () => {
          calls.push('refresh-drops');
          state.lastProgressAdvanceAt = Date.now();
          state.lastTrackedMinutes = 13;
          state.appState.currentDrop = createDrop({ requiredMinutes: 60, currentMinutes: 13 });
        },
        onRotateStreamerIfInvalid: async () => {
          calls.push('validate-stream');
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
              return true;
            },
          });
        },
        onAttemptAutoClaimChannelPointsBonus: async () => false,
        onAutoClaimClaimableDrops: async () => false,
        onAdvanceQueueIfCompleted: async () => true,
        onSaveTimingState: async () => undefined,
      });

      expect(calls).toEqual(['playback-policy', 'refresh-drops', 'validate-stream']);
      expect(attemptSelfHealCalled).toBe(false);
      expect(rotateReason).toBeNull();
    });

    test('persists heartbeat timing when API backoff skips network refresh work', async () => {
      const state = createMinimalState({
        apiBackoffUntil: Date.now() + 60_000,
        lastHeartbeatAt: 0,
      });
      state.appState.isRunning = true;
      state.appState.selectedGame = createGame();

      let refreshCalled = false;
      let autoClaimCalls = 0;
      let savedHeartbeat = 0;
      await checkDropProgress(state, {
        onEnforcePlaybackPolicy: async () => undefined,
        onAcquireStreamerForSelectedGame: async () => false,
        onRefreshDropsData: async () => {
          refreshCalled = true;
        },
        onRotateStreamerIfInvalid: async () => undefined,
        onAttemptAutoClaimChannelPointsBonus: async () => false,
        onAutoClaimClaimableDrops: async () => {
          autoClaimCalls += 1;
          return false;
        },
        onAdvanceQueueIfCompleted: async () => true,
        onSaveTimingState: async (nextState) => {
          savedHeartbeat = nextState.lastHeartbeatAt;
        },
      });

      expect(refreshCalled).toBe(false);
      expect(autoClaimCalls).toBe(1);
      expect(state.lastHeartbeatAt).toBeGreaterThan(0);
      expect(savedHeartbeat).toBe(state.lastHeartbeatAt);
      expect(state.monitorTickInFlight).toBe(false);
    });

    test('claims immediately after refresh before queue advancement and stream rotation', async () => {
      const state = createMinimalState();
      state.appState.isRunning = true;
      state.appState.selectedGame = createGame();
      state.lastFullRefreshAt = Date.now();
      const calls: string[] = [];

      await checkDropProgress(state, {
        onEnforcePlaybackPolicy: async () => {
          calls.push('playback');
        },
        onAcquireStreamerForSelectedGame: async () => false,
        onRefreshDropsData: async () => {
          calls.push('refresh');
        },
        onAutoClaimClaimableDrops: async () => {
          calls.push('claim');
          return false;
        },
        onAdvanceQueueIfCompleted: async () => {
          calls.push('queue');
          return true;
        },
        onRotateStreamerIfInvalid: async () => {
          calls.push('rotate');
        },
        onAttemptAutoClaimChannelPointsBonus: async () => {
          calls.push('channel-points');
          return false;
        },
        onSaveTimingState: async () => undefined,
      });

      expect(calls).toEqual(['playback', 'refresh', 'claim', 'queue', 'rotate', 'channel-points', 'queue']);
    });

    test('never requests a campaign refresh from the progress tick', async () => {
      const state = createMinimalState();
      state.appState.isRunning = true;
      state.appState.selectedGame = createGame({ name: 'Test Game', categorySlug: 'test-game' });
      state.lastFullRefreshAt = Date.now() - 3 * 60 * 1000;

      const refreshOptions: Array<
        | {
            includeCampaignFetch?: boolean;
            includeInventoryFetch?: boolean;
            forceInventoryFetch?: boolean;
          }
        | undefined
      > = [];

      await checkDropProgress(state, {
        onEnforcePlaybackPolicy: async () => undefined,
        onAcquireStreamerForSelectedGame: async () => false,
        onRefreshDropsData: async (opts) => {
          refreshOptions.push(opts);
        },
        onRotateStreamerIfInvalid: async () => undefined,
        onAttemptAutoClaimChannelPointsBonus: async () => false,
        onAutoClaimClaimableDrops: async () => false,
        onAdvanceQueueIfCompleted: async () => true,
        onSaveTimingState: async () => undefined,
      });

      expect(refreshOptions[0]).toEqual({ includeCampaignFetch: false, includeInventoryFetch: true });
    });

    test('does not validate the old tab while no-streamers retry backoff is active', async () => {
      const state = createMinimalState();
      state.appState.isRunning = true;
      state.appState.selectedGame = createGame({ name: 'No Live Game' });
      state.appState.tabId = 123;
      state.appState.recoveryReason = 'no-streamers';
      state.appState.recoveryAttempts = 1;
      state.recoveryBackoffUntil = Date.now() + 60_000;

      let playbackPolicyCalls = 0;
      let validationCalls = 0;
      let acquisitionCalls = 0;

      await checkDropProgress(state, {
        onEnforcePlaybackPolicy: async () => {
          playbackPolicyCalls += 1;
        },
        onRotateStreamerIfInvalid: async () => {
          validationCalls += 1;
        },
        onAcquireStreamerForSelectedGame: async () => {
          acquisitionCalls += 1;
          return false;
        },
        onRefreshDropsData: async () => undefined,
        onAttemptAutoClaimChannelPointsBonus: async () => false,
        onAutoClaimClaimableDrops: async () => false,
        onAdvanceQueueIfCompleted: async () => true,
        onSaveTimingState: async () => undefined,
      });

      expect(playbackPolicyCalls).toBe(0);
      expect(validationCalls).toBe(0);
      expect(acquisitionCalls).toBe(0);
      expect(state.appState.tabId).toBe(123);
    });

    test('retries streamer acquisition directly when no-streamers backoff expires', async () => {
      const state = createMinimalState();
      state.appState.isRunning = true;
      state.appState.selectedGame = createGame({ name: 'No Live Game' });
      state.appState.tabId = 123;
      state.appState.recoveryReason = 'no-streamers';
      state.appState.recoveryAttempts = 1;
      state.recoveryBackoffUntil = Date.now() - 1;

      let validationCalls = 0;
      let acquisitionCalls = 0;

      await checkDropProgress(state, {
        onEnforcePlaybackPolicy: async () => undefined,
        onRotateStreamerIfInvalid: async () => {
          validationCalls += 1;
        },
        onAcquireStreamerForSelectedGame: async () => {
          acquisitionCalls += 1;
          return false;
        },
        onRefreshDropsData: async () => undefined,
        onAttemptAutoClaimChannelPointsBonus: async () => false,
        onAutoClaimClaimableDrops: async () => false,
        onAdvanceQueueIfCompleted: async () => true,
        onSaveTimingState: async () => undefined,
      });

      expect(validationCalls).toBe(0);
      expect(acquisitionCalls).toBe(1);
    });
  });
}
