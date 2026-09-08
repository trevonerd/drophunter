import { describe, expect, test } from 'bun:test';
import { acquireStreamerForSelectedGame } from '../../src/background/streamer-acquisition.ts';
import { TwitchDirectoryUnavailableError } from '../../src/background/twitch-api/errors.ts';
import { createGame, createMinimalState } from '../fixtures/queue-management.ts';

export function registerQueue12Part01() {
  describe('acquireStreamerForSelectedGame', () => {
    test('sets one-minute no-streamers recovery on first failed acquisition', async () => {
      const state = createMinimalState({ stalledRecoveryAttempts: 2 });
      state.appState.selectedGame = createGame({ name: 'Rainbow Six Siege' });
      const before = Date.now();

      let openCalls = 0;
      await acquireStreamerForSelectedGame(state, {
        onOpenStreamer: async () => {
          openCalls += 1;
          return false;
        },
      });

      expect(openCalls).toBe(1);
      expect(state.appState.recoveryReason).toBe('no-streamers');
      expect(state.appState.recoveryAttempts).toBe(1);
      expect(state.recoveryBackoffUntil).toBeGreaterThanOrEqual(before + 60_000);
      expect(state.recoveryBackoffUntil).toBeLessThanOrEqual(Date.now() + 60_000);
      expect(state.stalledRecoveryAttempts).toBe(2);
    });

    test('retries an unavailable directory without treating it as proof that no streamer exists', async () => {
      const state = createMinimalState({ apiConsecutiveFailures: 1 });
      state.appState.selectedGame = createGame({ name: 'Rainbow Six Siege' });
      state.apiBackoffUntil = Date.now() + 60_000;
      let skipCalled = false;

      const opened = await acquireStreamerForSelectedGame(state, {
        onOpenStreamer: async () => {
          throw new TwitchDirectoryUnavailableError(new Error('service error'));
        },
        onSkipCurrentGame: async () => {
          skipCalled = true;
        },
      });

      expect(opened).toBe(false);
      expect(skipCalled).toBe(false);
      expect(state.appState.recoveryReason).toBe('directory-unavailable');
      expect(state.appState.recoveryAttempts).toBe(1);
      expect(state.appState.recoveryBackoffUntil).toBe(state.apiBackoffUntil);
    });

    test('does not search again while no-streamers retry backoff is active', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame();
      state.appState.recoveryReason = 'no-streamers';
      state.appState.recoveryAttempts = 1;
      state.recoveryBackoffUntil = Date.now() + 60_000;

      let openCalls = 0;
      await acquireStreamerForSelectedGame(state, {
        onOpenStreamer: async () => {
          openCalls += 1;
          return true;
        },
      });

      expect(openCalls).toBe(0);
    });

    test('does not search again while directory retry backoff is active', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame();
      state.appState.recoveryReason = 'directory-unavailable';
      state.appState.recoveryAttempts = 1;
      state.recoveryBackoffUntil = Date.now() + 60_000;

      let openCalls = 0;
      await acquireStreamerForSelectedGame(state, {
        onOpenStreamer: async () => {
          openCalls += 1;
          return true;
        },
      });

      expect(openCalls).toBe(0);
    });

    test('skips current game after the one no-streamers retry also fails', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame();
      state.appState.recoveryReason = 'no-streamers';
      state.appState.recoveryAttempts = 1;
      state.recoveryBackoffUntil = Date.now() - 1;

      let skipCalled = false;
      await acquireStreamerForSelectedGame(state, {
        onOpenStreamer: async () => false,
        onSkipCurrentGame: async () => {
          skipCalled = true;
        },
      });

      expect(skipCalled).toBe(true);
      expect(state.stalledRecoveryAttempts).toBe(0);
    });

    test('clears no-streamers recovery when a streamer opens', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame();
      state.appState.recoveryReason = 'no-streamers';
      state.appState.recoveryAttempts = 1;
      state.appState.recoveryBackoffUntil = Date.now() - 1;
      state.recoveryBackoffUntil = state.appState.recoveryBackoffUntil;

      await acquireStreamerForSelectedGame(state, {
        onOpenStreamer: async () => true,
      });

      expect(state.appState.recoveryReason).toBeNull();
      expect(state.appState.recoveryAttempts).toBeNull();
      expect(state.recoveryBackoffUntil).toBe(0);
    });
  });
}
