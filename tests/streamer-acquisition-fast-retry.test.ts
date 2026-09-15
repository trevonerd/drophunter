import { afterEach, describe, expect, test } from 'bun:test';
import { checkDropProgress } from '../src/background/drops-tick-monitoring.ts';
import { applyApiBackoffRecoveryState } from '../src/background/recovery-state.ts';
import { advanceQueueIfCompleted } from '../src/background/session-lifecycle-queue.ts';
import { acquireStreamerForSelectedGame } from '../src/background/streamer-acquisition.ts';
import { TwitchDirectoryUnavailableError } from '../src/background/twitch-api/errors.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import { createGame, createMinimalState } from './fixtures/queue-management.ts';

describe('fast streamer acquisition retry', () => {
  const realDateNow = Date.now;
  afterEach(() => {
    Date.now = realDateNow;
  });

  test('retries an empty directory after thirty seconds', async () => {
    Date.now = () => 1_000_000;
    const state = createMinimalState();
    state.appState.selectedGame = createGame();
    await acquireStreamerForSelectedGame(state, { onOpenStreamer: async () => false });
    expect(state.recoveryBackoffUntil).toBe(1_030_000);
  });

  test('keeps a campaign selected without querying during a ten minute API cooldown', async () => {
    let now = 1_000_000;
    Date.now = () => now;
    const state = createMinimalState();
    state.appState.isRunning = true;
    state.appState.selectedGame = createGame();
    let searches = 0;
    const parkedReasons: string[] = [];
    const acquire = () =>
      acquireStreamerForSelectedGame(state, {
        onOpenStreamer: async () => {
          searches += 1;
          state.apiBackoffUntil = now + 600_000;
          throw new TwitchDirectoryUnavailableError(new Error('rate limited'));
        },
        onSkipCurrentGame: async (reason) => {
          parkedReasons.push(reason ?? 'missing');
        },
      });
    await acquire();
    expect(state.recoveryBackoffUntil).toBe(1_600_000);
    now += 30_000;
    applyApiBackoffRecoveryState(state);
    await checkDropProgress(state, {
      onAcquireStreamerForSelectedGame: acquire,
      onEnforcePlaybackPolicy: async () => {},
      onRotateStreamerIfInvalid: async () => {},
      onAttemptAutoClaimChannelPointsBonus: async () => false,
      onAutoClaimClaimableDrops: async () => false,
      onAdvanceQueueIfCompleted: async () => true,
      onRefreshDropsData: async () => {
        throw new Error('Network refresh during cooldown');
      },
      onSaveTimingState: async () => {},
    });
    expect(parkedReasons).toEqual([]);
    expect(searches).toBe(1);
    expect(state.apiBackoffUntil).toBe(1_600_000);
  });

  test('waits for the global deadline when Twitch enters API backoff', () => {
    Date.now = () => 1_000_000;
    const state = createMinimalState();
    state.appState.recoveryReason = 'no-streamers';
    state.appState.recoveryAttempts = 1;
    state.recoveryBackoffUntil = 1_030_000;
    state.apiBackoffUntil = 1_600_000;
    applyApiBackoffRecoveryState(state);
    expect(state.recoveryBackoffUntil).toBe(1_600_000);
    expect(state.appState.recoveryReason).toBe('twitch-data-unavailable');
    expect(state.appState.recoveryAttempts).toBe(1);
  });

  test('clears campaign retry metadata after playback opens and preserves queue provenance', async () => {
    const state = createMinimalState();
    const game = createGame();
    state.appState.selectedGame = game;
    state.appState.queueEntryMetadataByKey[gameKey(game)] = {
      source: 'manual',
      addedAt: 100,
      reason: 'user-added',
      streamerRetryAt: 1_000_000,
      streamerRetryReason: 'no-streamers',
    };
    await acquireStreamerForSelectedGame(state, { onOpenStreamer: async () => true });
    expect(state.appState.queueEntryMetadataByKey[gameKey(game)]).toEqual({
      source: 'manual',
      addedAt: 100,
      reason: 'user-added',
    });
  });

  test('keeps a parked selection with an empty drop projection until its acquisition deadline', async () => {
    let now = 1_000_000;
    Date.now = () => now;
    const state = createMinimalState();
    const game = createGame();
    state.appState.selectedGame = game;
    state.appState.queue = [game];
    state.appState.isRunning = true;
    state.appState.allDrops = [];
    state.appState.pendingDrops = [];
    state.appState.currentDrop = null;
    state.previousAllDropsCount = 0;
    state.lastInventoryRefreshAt = now;
    state.appState.recoveryReason = 'no-streamers';
    state.recoveryBackoffUntil = now + 60_000;
    let acquisitions = 0;
    const tick = () =>
      checkDropProgress(state, {
        onAcquireStreamerForSelectedGame: async () => {
          acquisitions += 1;
          return false;
        },
        onEnforcePlaybackPolicy: async () => {},
        onRotateStreamerIfInvalid: async () => {},
        onAttemptAutoClaimChannelPointsBonus: async () => false,
        onAutoClaimClaimableDrops: async () => false,
        onAdvanceQueueIfCompleted: () => advanceQueueIfCompleted(state),
        onRefreshDropsData: async () => {
          throw new Error('Unexpected refresh');
        },
        onSaveTimingState: async () => {},
      });
    await tick();
    expect(acquisitions).toBe(0);
    now += 60_000;
    await tick();
    expect(acquisitions).toBe(1);
    expect(state.appState.isRunning).toBe(true);
    expect(state.appState.queue).toEqual([game]);
  });

  test('advances an expired campaign before transport work despite future recovery and API deadlines', async () => {
    Date.now = () => 1_000_000;
    const state = createMinimalState();
    const expired = createGame({ id: 'expired', expiresInMs: 0 });
    const live = createGame({ id: 'live' });
    state.appState.isRunning = true;
    state.appState.selectedGame = expired;
    state.appState.queue = [expired, live];
    state.appState.recoveryReason = 'no-streamers';
    state.recoveryBackoffUntil = 1_600_000;
    state.apiBackoffUntil = 1_600_000;
    const calls: string[] = [];
    await checkDropProgress(state, {
      onAdvanceQueueIfCompleted: async () => {
        calls.push('advance');
        state.appState.selectedGame = live;
        state.appState.queue = [live];
        return true;
      },
      onWatchTransportTick: async () => {
        calls.push('transport');
        return false;
      },
      onAcquireStreamerForSelectedGame: async () => {
        calls.push('search');
        return false;
      },
      onEnforcePlaybackPolicy: async () => {},
      onRotateStreamerIfInvalid: async () => {},
      onAttemptAutoClaimChannelPointsBonus: async () => false,
      onAutoClaimClaimableDrops: async () => false,
      onRefreshDropsData: async () => {
        throw new Error('Network refresh during cooldown');
      },
      onSaveTimingState: async () => {},
    });
    expect(calls).toEqual(['advance']);
    expect(state.appState.selectedGame).toBe(live);
    expect(state.apiBackoffUntil).toBe(1_600_000);
  });
});
