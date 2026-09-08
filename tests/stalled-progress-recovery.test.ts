import { describe, expect, test } from 'bun:test';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { recoverStalledProgress } from '../src/background/stalled-progress-recovery.ts';
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
        onRotateManagedStreamer: async () => {},
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
        onRotateManagedStreamer: async () => {},
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
        onRotateManagedStreamer: async () => {},
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
        onRotateManagedStreamer: async () => {},
        onSkipCurrentGame: async () => {},
        onSaveState: async () => {},
        onSaveTimingState: async () => {},
      },
    );

    expect(result).toEqual({ kind: 'refresh-unavailable' });
    expect(tablessRestarts).toBe(0);
    expect(state.stalledRecoveryAttempts).toBe(0);
  });

  test('exhausts after a persisted second attempt receives two further authoritative no-progress proofs', async () => {
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
      onRotateManagedStreamer: async () => {},
      onSkipCurrentGame: async () => {
        skipped += 1;
      },
      onSaveState: async () => {},
      onSaveTimingState: async () => {},
    };

    const thirdAttempt = await recoverStalledProgress(state, { kind: 'tabless' }, dependencies);
    now = 62_000;
    const exhausted = await recoverStalledProgress(state, { kind: 'tabless' }, dependencies);

    expect(thirdAttempt).toMatchObject({ kind: 'retry-scheduled', attempt: 3 });
    expect(exhausted).toEqual({ kind: 'selection-changed' });
    expect(skipped).toBe(1);
    expect(state.lastProgressAdvanceAt).toBe(123);
  });
});
