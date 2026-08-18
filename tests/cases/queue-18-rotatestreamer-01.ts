import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS } from '../../src/background/stream-rotation.ts';
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
      await rotateStreamer(state, 'stalled-progress', {});
      expect(state.noProgressRotationAttempts).toBe(1);
    });

    test('records the current channel as the one to avoid on the next selection', async () => {
      const state = createMinimalState();
      state.appState.activeStreamer = { id: 'alpha', name: 'alpha', displayName: 'Alpha', isLive: true };

      await rotateStreamer(state, 'stalled-progress', { onOpenStreamer: async () => true });

      expect(state.avoidStreamerName).toBe('alpha');
      expect(state.appState.activeStreamer).toBeNull();
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

    test('does not enter persistent recovery for stalled progress because stalled flow has its own cap', async () => {
      const state = createMinimalState({ noProgressRotationAttempts: 3 });

      let enterRecoveryCalled = false;
      await rotateStreamer(state, 'stalled-progress', {
        onEnterPersistentRecovery: async () => {
          enterRecoveryCalled = true;
        },
      });

      expect(enterRecoveryCalled).toBe(false);
    });

    test('does not forward skip callback through persistent recovery for stalled progress', async () => {
      const state = createMinimalState({ noProgressRotationAttempts: 3 });
      const skipCurrentGame = async () => {};

      let forwardedSkip: (() => Promise<void>) | undefined;
      await rotateStreamer(state, 'stalled-progress', {
        onEnterPersistentRecovery: async (_state, _reason, _message, recoveryOpts) => {
          forwardedSkip = recoveryOpts?.onSkipCurrentGame;
        },
        onSkipCurrentGame: skipCurrentGame,
      });

      expect(forwardedSkip).toBeUndefined();
    });

    test('returns false when stalled rotation has no replacement streamer', async () => {
      const state = createMinimalState({ noProgressRotationAttempts: 3 });

      const result = await rotateStreamer(state, 'stalled-progress', {
        onEnterPersistentRecovery: async () => {},
      });

      expect(result).toBe(false);
    });

    test('skips as stalled progress when a stalled rotation cannot open a replacement', async () => {
      const state = createMinimalState({ stalledRecoveryAttempts: 2 });

      let skipCalled = false;
      await rotateStreamer(state, 'stalled-progress', {
        onOpenStreamer: async () => false,
        onSkipCurrentGame: async () => {
          skipCalled = true;
        },
      });

      expect(skipCalled).toBe(true);
      expect(state.appState.recoveryReason).not.toBe('no-streamers');
    });

    test('sets rotation timestamps', async () => {
      const state = createMinimalState();
      const before = Date.now();

      await rotateStreamer(state, 'offline', {});

      expect(state.appState.lastRotationAt).toBeGreaterThanOrEqual(before);
      expect(state.lastStreamRotationAt).toBeGreaterThanOrEqual(before);
      expect(state.lastProgressAdvanceAt).toBeGreaterThanOrEqual(before);
    });

    test('sets lastRotationReason on appState', async () => {
      const state = createMinimalState();
      await rotateStreamer(state, 'offline', {});
      expect(state.appState.lastRotationReason).toBe('offline');
    });

    test('clears activeStreamer', async () => {
      const state = createMinimalState();
      state.appState.activeStreamer = { id: 'streamer-1', name: 'test', displayName: 'Test', isLive: true };

      await rotateStreamer(state, 'offline', {});

      expect(state.appState.activeStreamer).toBeNull();
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

    test('does not enter persistent recovery when a non-stall replacement fails to open', async () => {
      const state = createMinimalState({ noProgressRotationAttempts: 3 });

      let enterRecoveryCalled = false;
      await rotateStreamer(state, 'offline', {
        onOpenStreamer: async () => false,
        onEnterPersistentRecovery: async () => {
          enterRecoveryCalled = true;
        },
      });

      expect(enterRecoveryCalled).toBe(false);
    });

    test('does not forward skip callback through persistent recovery for non-stall open failures', async () => {
      const state = createMinimalState({ noProgressRotationAttempts: 3 });
      const skipCurrentGame = async () => {};

      let forwardedSkip: (() => Promise<void>) | undefined;
      await rotateStreamer(state, 'offline', {
        onOpenStreamer: async () => false,
        onEnterPersistentRecovery: async (_state, _reason, _message, recoveryOpts) => {
          forwardedSkip = recoveryOpts?.onSkipCurrentGame;
        },
        onSkipCurrentGame: skipCurrentGame,
      });

      expect(forwardedSkip).toBeUndefined();
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

    test('calls onSaveTimingState even when entering recovery', async () => {
      const state = createMinimalState({ noProgressRotationAttempts: 3 });

      let saveTimingCalled = false;
      await rotateStreamer(state, 'stalled-progress', {
        onEnterPersistentRecovery: async () => {},
        onSaveTimingState: async () => {
          saveTimingCalled = true;
        },
      });

      expect(saveTimingCalled).toBe(true);
    });

    test('caps stalled progress retry attempts without entering persistent recovery', async () => {
      const state = createMinimalState({
        noProgressRotationAttempts: MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS,
      });

      let enterRecoveryCalled = false;
      await rotateStreamer(state, 'stalled-progress', {
        onEnterPersistentRecovery: async () => {
          enterRecoveryCalled = true;
        },
      });

      expect(state.noProgressRotationAttempts).toBe(MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS);
      expect(enterRecoveryCalled).toBe(false);
    });
  });
}
