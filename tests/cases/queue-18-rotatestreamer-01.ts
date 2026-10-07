import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { rotateStreamer } from '../../src/background/streamer-acquisition.ts';
import { createMinimalState } from '../fixtures/queue-management.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';

export function registerQueue18Part01() {
  describe('rotateStreamer', () => {
    let mocks: ChromeMocks;

    beforeEach(() => {
      mocks = setupChromeMocks();
    });

    afterEach(() => {
      mocks.teardown();
    });

    test('increments noProgressRotationAttempts for stalled-progress reason', async () => {
      const state = createMinimalState({ noProgressRotationAttempts: 0 });
      state.appState.activeStreamer = { id: 'alpha', name: 'alpha', displayName: 'Alpha', isLive: true };
      await rotateStreamer(state, 'stalled-progress', {
        onOpenStreamer: async () => {
          state.appState.activeStreamer = { id: 'beta', name: 'beta', displayName: 'Beta', isLive: true };
          return true;
        },
      });
      expect(state.noProgressRotationAttempts).toBe(1);
    });

    test('records the current channel as the one to avoid on the next selection', async () => {
      const state = createMinimalState();
      state.appState.activeStreamer = { id: 'alpha', name: 'alpha', displayName: 'Alpha', isLive: true };

      await rotateStreamer(state, 'stalled-progress', {
        onOpenStreamer: async () => {
          state.appState.activeStreamer = { id: 'beta', name: 'beta', displayName: 'Beta', isLive: true };
          return true;
        },
      });

      expect(state.avoidStreamerName).toBe('alpha');
      expect(state.appState.activeStreamer?.name).toBe('beta');
      expect(state.offlineChecks).toBe(0);
    });

    test('does not increment noProgressRotationAttempts for open-failed reason', async () => {
      const state = createMinimalState({ noProgressRotationAttempts: 0 });
      await rotateStreamer(state, 'open-failed', {});
      expect(state.noProgressRotationAttempts).toBe(0);
    });

    test('does not increment for other rotation reasons', async () => {
      const state = createMinimalState({ noProgressRotationAttempts: 0 });
      await rotateStreamer(state, 'offline', {
        onOpenStreamer: async () => true,
      });
      expect(state.noProgressRotationAttempts).toBe(0);
    });

    test('returns false when stalled rotation has no replacement streamer', async () => {
      const state = createMinimalState({ noProgressRotationAttempts: 3 });

      const result = await rotateStreamer(state, 'stalled-progress', {});

      expect(result).toBe(false);
    });

    test('does not skip or clear the incumbent when a stalled replacement cannot open', async () => {
      const state = createMinimalState({ stalledRecoveryAttempts: 2 });
      state.appState.activeStreamer = { id: 'alpha', name: 'alpha', displayName: 'Alpha', isLive: true };

      let skipCalled = false;
      await rotateStreamer(state, 'stalled-progress', {
        onOpenStreamer: async () => false,
        onSkipCurrentGame: async () => {
          skipCalled = true;
        },
      });

      expect(skipCalled).toBe(false);
      expect(state.appState.activeStreamer?.name).toBe('alpha');
      expect(state.appState.recoveryReason).not.toBe('no-streamers');
    });

    test('sets rotation timestamps', async () => {
      const state = createMinimalState();
      const before = Date.now();

      await rotateStreamer(state, 'offline', {
        onOpenStreamer: async () => {
          state.appState.activeStreamer = { id: 'beta', name: 'beta', displayName: 'Beta', isLive: true };
          return true;
        },
      });

      expect(state.appState.lastRotationAt).toBeGreaterThanOrEqual(before);
      expect(state.lastStreamRotationAt).toBeGreaterThanOrEqual(before);
      expect(state.lastProgressAdvanceAt).toBe(0);
    });

    test('sets lastRotationReason on appState', async () => {
      const state = createMinimalState();
      await rotateStreamer(state, 'offline', {
        onOpenStreamer: async () => {
          state.appState.activeStreamer = { id: 'beta', name: 'beta', displayName: 'Beta', isLive: true };
          return true;
        },
      });
      expect(state.appState.lastRotationReason).toBe('offline');
    });

    test('preserves activeStreamer when the replacement does not open', async () => {
      const state = createMinimalState();
      state.appState.activeStreamer = { id: 'streamer-1', name: 'test', displayName: 'Test', isLive: true };

      await rotateStreamer(state, 'offline', { onOpenStreamer: async () => false });

      expect(state.appState.activeStreamer?.name).toBe('test');
    });

    test('calls onOpenStreamer', async () => {
      const state = createMinimalState();

      let openStreamerCalled = false;
      await rotateStreamer(state, 'offline', {
        onOpenStreamer: async () => {
          openStreamerCalled = true;
          return true;
        },
      });

      expect(openStreamerCalled).toBe(true);
    });

    test('returns true when streamer opened successfully', async () => {
      const state = createMinimalState();

      const result = await rotateStreamer(state, 'offline', {
        onOpenStreamer: async () => true,
      });

      expect(result).toBe(true);
    });

    test('returns false when streamer open fails', async () => {
      const state = createMinimalState();

      const result = await rotateStreamer(state, 'offline', {
        onOpenStreamer: async () => false,
      });

      expect(result).toBe(false);
    });

    test('does not increment no-progress attempts when opening a replacement fails', async () => {
      const state = createMinimalState({ noProgressRotationAttempts: 0 });

      await rotateStreamer(state, 'offline', {
        onOpenStreamer: async () => false,
      });

      expect(state.noProgressRotationAttempts).toBe(0);
    });

    test('calls onSaveState', async () => {
      const state = createMinimalState();

      let saveStateCalled = false;
      await rotateStreamer(state, 'offline', {
        onOpenStreamer: async () => true,
        onSaveState: async () => {
          saveStateCalled = true;
        },
      });

      expect(saveStateCalled).toBe(true);
    });

    test('calls onSaveTimingState', async () => {
      const state = createMinimalState();

      let saveTimingCalled = false;
      await rotateStreamer(state, 'offline', {
        onOpenStreamer: async () => true,
        onSaveTimingState: async () => {
          saveTimingCalled = true;
        },
      });

      expect(saveTimingCalled).toBe(true);
    });

    test('does not persist rotation timing when a stalled replacement fails', async () => {
      const state = createMinimalState({ noProgressRotationAttempts: 3 });

      let saveTimingCalled = false;
      await rotateStreamer(state, 'stalled-progress', {
        onOpenStreamer: async () => false,
        onSaveTimingState: async () => {
          saveTimingCalled = true;
        },
      });

      expect(saveTimingCalled).toBe(false);
    });
  });
}
