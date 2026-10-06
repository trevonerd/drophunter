import { describe, expect, test } from 'bun:test';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { recoverStalledProgress } from '../src/background/stalled-progress-recovery.ts';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import { createInitialState } from '../src/shared/utils.ts';
import type { TwitchDrop, TwitchGame } from '../src/types/index.ts';

const game: TwitchGame = {
  id: 'game-1',
  name: 'Game',
  imageUrl: '',
  campaignId: 'campaign-1',
};

const drop: TwitchDrop = {
  id: 'drop-1',
  name: 'Reward',
  gameId: game.id,
  gameName: game.name,
  imageUrl: '',
  progress: 10,
  currentMinutes: 1,
  claimed: false,
  campaignId: game.campaignId,
  acquisitionMethod: 'watch-time',
  rewardKind: 'in-game',
  verificationState: 'unassessed',
};

function createStalledState() {
  const state = createServiceWorkerState();
  state.appState.isRunning = true;
  state.appState.selectedGame = game;
  state.appState.currentDrop = drop;
  return state;
}

describe('stalled progress recovery', () => {
  test('preserves silent Twitch retry state when background session recovery fails', async () => {
    const state = createStalledState();
    let inventoryRefreshes = 0;

    const result = await recoverStalledProgress(
      state,
      { kind: 'tabless' },
      {
        now: () => 1_000,
        onCampaignRefresh: async () => {
          state.appState.twitchSessionSyncState = {
            status: 'retrying',
            attempts: 1,
            nextRetryAt: 60_000,
          };
          return 'auth-required';
        },
        onInventoryRefresh: async () => {
          inventoryRefreshes += 1;
          return 'refreshed';
        },
        onAdvanceQueueIfCompleted: async () => false,
        onAttemptPlaybackSelfHeal: async () => {},
        onRestartTablessWatcher: async () => {},
        onRotateStreamer: async () => {},
        onSkipCurrentGame: async () => {},
        onSaveState: async () => {},
        onSaveTimingState: async () => {},
      },
    );

    expect(result).toEqual({ kind: 'auth-required' });
    expect(inventoryRefreshes).toBe(0);
    expect(state.appState.recoveryReason).toBeNull();
    expect(state.appState.twitchSessionSyncState.status).toBe('retrying');
    expect(state.stalledRecoveryAttempts).toBe(0);
    expect(state.appState.isRunning).toBe(true);
  });

  test('returns recovered when the advanced refresh observes new progress', async () => {
    const state = createStalledState();

    const result = await recoverStalledProgress(
      state,
      { kind: 'tabless' },
      {
        now: () => 1_000,
        onCampaignRefresh: async () => 'refreshed',
        onInventoryRefresh: async () => {
          state.appState.currentDrop = { ...drop, progress: 20, currentMinutes: 2 };
          return 'refreshed';
        },
        onAdvanceQueueIfCompleted: async () => false,
        onAttemptPlaybackSelfHeal: async () => {},
        onRestartTablessWatcher: async () => {},
        onRotateStreamer: async () => {},
        onSkipCurrentGame: async () => {},
        onSaveState: async () => {},
        onSaveTimingState: async () => {},
      },
    );

    expect(result).toEqual({ kind: 'recovered' });
    expect(state.appState.recoveryReason).toBeNull();
    expect(state.stalledRecoveryAttempts).toBe(0);
  });

  test('does not start stalled recovery when an authoritative refresh is unavailable', async () => {
    const state = createStalledState();
    let inventoryRefreshes = 0;
    let tablessRestarts = 0;

    const result = await recoverStalledProgress(
      state,
      { kind: 'tabless' },
      {
        now: () => 1_000,
        onCampaignRefresh: async () => 'transient-failure',
        onInventoryRefresh: async () => {
          inventoryRefreshes += 1;
          return 'refreshed';
        },
        onAdvanceQueueIfCompleted: async () => false,
        onAttemptPlaybackSelfHeal: async () => {},
        onRestartTablessWatcher: async () => {
          tablessRestarts += 1;
        },
        onRotateStreamer: async () => {},
        onSkipCurrentGame: async () => {},
        onSaveState: async () => {},
        onSaveTimingState: async () => {},
      },
    );

    expect(result).toEqual({ kind: 'refresh-unavailable' });
    expect(inventoryRefreshes).toBe(0);
    expect(tablessRestarts).toBe(0);
    expect(state.stalledRecoveryAttempts).toBe(0);
    expect(state.appState.recoveryReason).toBeNull();
  });

  test('does not rotate when inventory evidence is unavailable after a campaign refresh', async () => {
    const state = createStalledState();
    let tablessRestarts = 0;

    const result = await recoverStalledProgress(
      state,
      { kind: 'tabless' },
      {
        now: () => 1_000,
        onCampaignRefresh: async () => 'refreshed',
        onInventoryRefresh: async () => 'transient-failure',
        onAdvanceQueueIfCompleted: async () => false,
        onAttemptPlaybackSelfHeal: async () => {},
        onRestartTablessWatcher: async () => {
          tablessRestarts += 1;
        },
        onRotateStreamer: async () => {},
        onSkipCurrentGame: async () => {},
        onSaveState: async () => {},
        onSaveTimingState: async () => {},
      },
    );

    expect(result).toEqual({ kind: 'refresh-unavailable' });
    expect(tablessRestarts).toBe(0);
    expect(state.stalledRecoveryAttempts).toBe(0);
  });

  test('waits a full effective stall window after a successful replacement start', async () => {
    const state = createStalledState();
    state.appState.currentDrop = { ...drop, requiredMinutes: 300 };
    state.appState.recoveryReason = 'stalled-progress';
    state.stalledRecoveryAttempts = 1;
    state.lastProgressAdvanceAt = 55_000;
    let rotations = 0;
    let stateSaves = 0;
    let timingSaves = 0;
    let now = 60_000;

    const result = await recoverStalledProgress(
      state,
      { kind: 'tabless' },
      {
        now: () => now,
        onCampaignRefresh: async () => 'refreshed',
        onInventoryRefresh: async () => 'refreshed',
        onAdvanceQueueIfCompleted: async () => false,
        onAttemptPlaybackSelfHeal: async () => {},
        onRestartTablessWatcher: async () => {},
        onRotateStreamer: async () => {
          rotations += 1;
        },
        onSkipCurrentGame: async () => {},
        onSaveState: async () => {
          stateSaves += 1;
        },
        onSaveTimingState: async () => {
          timingSaves += 1;
        },
      },
    );

    now = 1_020_000;
    expect(result).toMatchObject({ kind: 'retry-scheduled', started: false, retryAt: 1_075_000 });
    expect(rotations).toBe(0);
    expect(state.recoveryBackoffUntil).toBe(1_075_000);
    expect(state.appState.recoveryBackoffUntil).toBe(1_075_000);
    expect(stateSaves).toBe(1);
    expect(timingSaves).toBe(1);
  });

  test('preserves player retry state and incumbent baseline when replacement playback fails', async () => {
    const state = createStalledState();
    state.appState.activeStreamer = { id: 'A', name: 'A', displayName: 'A', isLive: true };
    state.appState.recoveryReason = 'stalled-progress';
    state.stalledRecoveryAttempts = 1;
    state.lastProgressAdvanceAt = 0;
    let skipped = 0;

    const result = await recoverStalledProgress(
      state,
      { kind: 'tabless' },
      {
        now: () => 1_000_000,
        onCampaignRefresh: async () => 'refreshed',
        onInventoryRefresh: async () => 'refreshed',
        onAdvanceQueueIfCompleted: async () => false,
        onAttemptPlaybackSelfHeal: async () => {},
        onRestartTablessWatcher: async () => {},
        onRotateStreamer: async () => {
          state.appState.recoveryReason = 'open-failed';
          state.recoveryBackoffUntil = 1_060_000;
          return false;
        },
        onSkipCurrentGame: async () => {
          skipped += 1;
        },
        onSaveState: async () => {},
        onSaveTimingState: async () => {},
      },
    );

    expect(result).toMatchObject({ kind: 'retry-scheduled', started: false, retryAt: 1_060_000 });
    expect(state.appState.recoveryReason).toBe('open-failed');
    expect(state.lastProgressAdvanceAt).toBe(0);
    expect(state.appState.activeStreamer?.name).toBe('A');
    expect(skipped).toBe(0);
  });

  test('does not exhaust from attempt counters without four distinct confirmed stalled channels', async () => {
    const state = createStalledState();
    state.lastProgressAdvanceAt = 123;
    state.stalledRecoveryAttempts = 2;
    state.appState.recoveryReason = 'stalled-progress';
    let now = 1_000;
    let skipped = 0;
    const dependencies = {
      now: () => now,
      onCampaignRefresh: async () => 'refreshed' as const,
      onInventoryRefresh: async () => 'refreshed' as const,
      onAdvanceQueueIfCompleted: async () => false,
      onAttemptPlaybackSelfHeal: async () => {},
      onRestartTablessWatcher: async () => {},
      onRotateStreamer: async () => {},
      onSkipCurrentGame: async () => {
        skipped += 1;
      },
      onSaveState: async () => {},
      onSaveTimingState: async () => {},
    };

    const thirdAttempt = await recoverStalledProgress(state, { kind: 'tabless' }, dependencies);
    now = 62_000;
    const exhausted = await recoverStalledProgress(state, { kind: 'tabless' }, dependencies);

    expect(thirdAttempt).toMatchObject({ kind: 'retry-scheduled', started: false });
    expect(exhausted).toMatchObject({ kind: 'retry-scheduled', started: false });
    expect(skipped).toBe(0);
    expect(state.lastProgressAdvanceAt).toBe(123);
  });

  test('records each confirmed channel once and exhausts only after A through D stall', async () => {
    const state = createStalledState();
    state.appState.activeStreamer = { id: 'A', name: ' A ', displayName: 'A', isLive: true };
    let currentTime = 1_000_000;
    let repairs = 0;
    let rotations = 0;
    let skips = 0;
    const candidates = ['B', 'C', 'D'];
    const dependencies = {
      now: () => currentTime,
      onCampaignRefresh: async () => 'refreshed' as const,
      onInventoryRefresh: async () => 'refreshed' as const,
      onAdvanceQueueIfCompleted: async () => false,
      onAttemptPlaybackSelfHeal: async () => {
        repairs += 1;
      },
      onRestartTablessWatcher: async () => {
        repairs += 1;
      },
      onRotateStreamer: async () => {
        const name = candidates[rotations];
        if (!name) throw new Error('Missing replacement streamer fixture');
        state.appState.activeStreamer = {
          id: name,
          name,
          displayName: name,
          isLive: true,
        };
        rotations += 1;
        state.lastProgressAdvanceAt = currentTime;
        return true;
      },
      onSkipCurrentGame: async () => {
        skips += 1;
      },
      onSaveState: async () => {},
      onSaveTimingState: async () => {},
    };

    const first = await recoverStalledProgress(state, { kind: 'tabless' }, dependencies);
    for (let index = 0; index < 4; index += 1) {
      currentTime = state.lastProgressAdvanceAt + 20 * 60_000;
      await recoverStalledProgress(state, { kind: 'tabless' }, dependencies);
    }

    expect(first).toMatchObject({ kind: 'retry-scheduled', attempt: 1, started: true });
    expect(repairs).toBe(1);
    expect(rotations).toBe(3);
    expect(skips).toBe(1);
    expect(state.appState.queueEntryMetadataByKey[gameKey(game)]?.stalledStreamerNames).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  test('uses persisted channel history to avoid repeating the initial player repair after restart', async () => {
    const state = createStalledState();
    state.appState.activeStreamer = { id: 'A', name: 'A', displayName: 'A', isLive: true };
    state.appState.queueEntryMetadataByKey[gameKey(game)] = {
      source: 'manual',
      addedAt: 1,
      reason: 'user-added',
      stalledStreamerNames: ['a'],
    };
    let repairs = 0;
    let rotations = 0;

    const result = await recoverStalledProgress(
      state,
      { kind: 'tabless' },
      {
        now: () => 1_000_000,
        onCampaignRefresh: async () => 'refreshed',
        onInventoryRefresh: async () => 'refreshed',
        onAdvanceQueueIfCompleted: async () => false,
        onAttemptPlaybackSelfHeal: async () => {
          repairs += 1;
        },
        onRestartTablessWatcher: async () => {
          repairs += 1;
        },
        onRotateStreamer: async () => {
          rotations += 1;
          return true;
        },
        onSkipCurrentGame: async () => {},
        onSaveState: async () => {},
        onSaveTimingState: async () => {},
      },
    );

    expect(result).toMatchObject({ kind: 'retry-scheduled', started: true });
    expect(repairs).toBe(0);
    expect(rotations).toBe(1);
  });

  test('normalizes and persists stalled streamer names by campaign identity', () => {
    const sibling = { ...game, campaignId: 'campaign-2' };
    const appState = createInitialState();
    appState.queueEntryMetadataByKey[gameKey(game)] = {
      source: 'manual',
      addedAt: 1,
      reason: 'user-added',
      stalledStreamerNames: [' A ', 'a', '', 'B', 4 as never, 'C', 'D', 'E'],
    };
    appState.queueEntryMetadataByKey[gameKey(sibling)] = {
      source: 'manual',
      addedAt: 1,
      reason: 'user-added',
      stalledStreamerNames: ['sibling'],
    };

    const restored = normalizeStoredAppState(JSON.parse(JSON.stringify(appState)));

    expect(restored.queueEntryMetadataByKey[gameKey(game)]?.stalledStreamerNames).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(restored.queueEntryMetadataByKey[gameKey(sibling)]?.stalledStreamerNames).toEqual(['sibling']);
  });
});
