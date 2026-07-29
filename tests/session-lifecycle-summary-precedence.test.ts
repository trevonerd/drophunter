import { describe, expect, test } from 'bun:test';
import { applyStopState } from '../src/background/recovery-state.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { advanceQueueIfCompleted, handleStartFarming } from '../src/background/session-lifecycle.ts';
import type { TwitchDrop, TwitchGame } from '../src/types/index.ts';

function createGame(overrides: Partial<TwitchGame> = {}): TwitchGame {
  return {
    id: 'game-1',
    name: 'Test Game',
    imageUrl: 'https://example.com/game.png',
    campaignId: 'campaign-1',
    ...overrides,
  };
}

function createDrop(game: TwitchGame, overrides: Partial<TwitchDrop> = {}): TwitchDrop {
  return {
    id: 'drop-1',
    name: 'Test Drop',
    gameId: game.id,
    gameName: game.name,
    imageUrl: 'https://example.com/drop.png',
    campaignId: game.campaignId,
    progress: 25,
    currentMinutes: 15,
    requiredMinutes: 60,
    remainingMinutes: 45,
    claimed: false,
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
    ...overrides,
  };
}

describe('farming-complete summary precedence', () => {
  test('keeps the current campaign running when a duplicate summary is stale but a current reward is automatable', async () => {
    // Given
    const state = createServiceWorkerState();
    const selected = createGame({ rewardSummary: { completion: 'farmable', remainderReasons: [] } });
    const staleDuplicate = createGame({
      rewardSummary: { completion: 'farming-complete', remainderReasons: ['subscription-required'] },
    });
    const next = createGame({ id: 'game-2', campaignId: 'campaign-2', name: 'Next Game' });
    const currentReward = createDrop(selected);
    state.appState.isRunning = true;
    state.appState.selectedGame = selected;
    state.appState.availableGames = [staleDuplicate, next];
    state.appState.queue = [selected, next];
    state.appState.allDrops = [currentReward];
    state.appState.pendingDrops = [currentReward];
    state.appState.currentDrop = null;
    let refreshCalls = 0;
    let stopCalls = 0;

    // When
    const running = await advanceQueueIfCompleted(state, {
      onRefreshDropsData: async () => {
        refreshCalls += 1;
      },
      onSaveTimingState: async () => {},
      onApplyStopState: () => {
        stopCalls += 1;
      },
    });

    // Then
    expect(running).toBe(true);
    expect(state.appState.selectedGame).toEqual(selected);
    expect(state.appState.queue).toEqual([selected, next]);
    expect(state.appState.isRunning).toBe(true);
    expect(refreshCalls).toBe(0);
    expect(stopCalls).toBe(0);
  });

  test('starts the refreshed queued campaign when pending reward evidence contradicts its stale summary', async () => {
    // Given
    const state = createServiceWorkerState();
    const completed = createGame({ id: 'game-1', campaignId: 'campaign-complete' });
    const queued = createGame({
      id: 'game-2',
      name: 'Queued Game',
      campaignId: 'campaign-queued',
      rewardSummary: { completion: 'farming-complete', remainderReasons: ['unverifiable-twitch'] },
    });
    const completedReward = createDrop(completed, { claimed: true, progress: 100, remainingMinutes: 0 });
    const queuedReward = createDrop(queued, { id: 'queued-drop' });
    state.appState.isRunning = true;
    state.appState.selectedGame = completed;
    state.appState.availableGames = [completed, queued];
    state.appState.queue = [completed, queued];
    state.appState.allDrops = [completedReward];
    state.appState.pendingDrops = [];
    state.appState.currentDrop = null;
    let openCalls = 0;

    // When
    const running = await advanceQueueIfCompleted(state, {
      onSaveTimingState: async () => {},
      onRefreshDropsData: async () => {
        state.appState.allDrops = [queuedReward];
        state.appState.pendingDrops = [queuedReward];
        state.appState.currentDrop = queuedReward;
      },
      onOpenStreamer: async () => {
        openCalls += 1;
        return true;
      },
      onApplyStopState: applyStopState,
    });

    // Then
    expect(running).toBe(true);
    expect(state.appState.selectedGame).toEqual(queued);
    expect(state.appState.queue).toEqual([queued]);
    expect(state.appState.isRunning).toBe(true);
    expect(state.appState.lastStopReason).toBeNull();
    expect(openCalls).toBe(1);
  });

  test('starts a requested campaign when its current automatable reward contradicts a stale summary', async () => {
    // Given
    const state = createServiceWorkerState();
    const requested = createGame({
      rewardSummary: { completion: 'farming-complete', remainderReasons: ['subscription-required'] },
    });
    const queued = createGame({ id: 'game-2', campaignId: 'campaign-2' });
    state.appState.availableGames = [requested, queued];
    state.appState.queue = [queued];
    state.appState.pendingDrops = [createDrop(requested)];
    state.appState.currentDrop = null;
    let refreshCalls = 0;

    // When
    const result = await handleStartFarming(
      state,
      { game: requested },
      {
        onRefreshDropsData: async () => {
          refreshCalls += 1;
        },
      },
    );

    // Then
    expect(result).toEqual({ success: true });
    expect(state.appState.isRunning).toBe(true);
    expect(state.appState.selectedGame).toEqual(requested);
    expect(state.appState.queue).toEqual([requested, queued]);
    expect(refreshCalls).toBe(1);
  });

  test('still rejects Start before mutation when only a subscription reward remains', async () => {
    // Given
    const state = createServiceWorkerState();
    const requested = createGame({
      rewardSummary: { completion: 'farming-complete', remainderReasons: ['subscription-required'] },
    });
    const queued = createGame({ id: 'game-2', campaignId: 'campaign-2' });
    state.appState.availableGames = [requested, queued];
    state.appState.queue = [queued];
    state.appState.pendingDrops = [createDrop(requested, { acquisitionMethod: 'subscription' })];
    let refreshCalls = 0;

    // When
    const result = await handleStartFarming(
      state,
      { game: requested },
      {
        onRefreshDropsData: async () => {
          refreshCalls += 1;
        },
      },
    );

    // Then
    expect(result).toEqual({
      success: false,
      error: 'All farmable rewards claimed · Subscription required for remaining rewards',
    });
    expect(state.appState.isRunning).toBe(false);
    expect(state.appState.selectedGame).toBeNull();
    expect(state.appState.queue).toEqual([queued]);
    expect(refreshCalls).toBe(0);
  });

  test('rejects an all-acquired campaign before mutating the farming session', async () => {
    // Given
    const state = createServiceWorkerState();
    const requested = createGame({
      rewardSummary: { completion: 'all-acquired', remainderReasons: [] },
    });
    const queued = createGame({ id: 'game-2', campaignId: 'campaign-2' });
    state.appState.availableGames = [requested, queued];
    state.appState.queue = [queued];
    let refreshCalls = 0;

    // When
    const result = await handleStartFarming(
      state,
      { game: requested },
      {
        onRefreshDropsData: async () => {
          refreshCalls += 1;
        },
      },
    );

    // Then
    expect(result).toEqual({ success: false, error: 'All campaign rewards are already acquired.' });
    expect(state.appState.isRunning).toBe(false);
    expect(state.appState.selectedGame).toBeNull();
    expect(state.appState.queue).toEqual([queued]);
    expect(refreshCalls).toBe(0);
  });

  test('retains subscription-only terminal inspection and reason-specific stop state', async () => {
    // Given
    const state = createServiceWorkerState();
    const terminal = createGame({
      rewardSummary: { completion: 'farming-complete', remainderReasons: ['subscription-required'] },
    });
    const subscriptionReward = createDrop(terminal, { acquisitionMethod: 'subscription' });
    state.appState.isRunning = true;
    state.appState.selectedGame = terminal;
    state.appState.availableGames = [terminal];
    state.appState.queue = [terminal];
    state.appState.allDrops = [subscriptionReward];
    state.appState.pendingDrops = [subscriptionReward];
    state.appState.currentDrop = null;

    // When
    const running = await advanceQueueIfCompleted(state, { onApplyStopState: applyStopState });

    // Then
    expect(running).toBe(false);
    expect(state.appState.selectedGame).toEqual(terminal);
    expect(state.appState.lastStopReason).toBe('farming-complete');
    expect(state.appState.lastStopMessage).toContain('Subscription required');
  });

  test('retains unverifiable-only terminal inspection and reason-specific stop state', async () => {
    // Given
    const state = createServiceWorkerState();
    const terminal = createGame({
      rewardSummary: { completion: 'farming-complete', remainderReasons: ['unverifiable-twitch'] },
    });
    const unverifiableReward = createDrop(terminal, {
      rewardKind: 'twitch-emote',
      verificationState: 'unverifiable',
    });
    state.appState.isRunning = true;
    state.appState.selectedGame = terminal;
    state.appState.availableGames = [terminal];
    state.appState.queue = [terminal];
    state.appState.allDrops = [unverifiableReward];
    state.appState.pendingDrops = [unverifiableReward];
    state.appState.currentDrop = null;

    // When
    const running = await advanceQueueIfCompleted(state, { onApplyStopState: applyStopState });

    // Then
    expect(running).toBe(false);
    expect(state.appState.selectedGame).toEqual(terminal);
    expect(state.appState.lastStopReason).toBe('unverifiable-twitch');
    expect(state.appState.lastStopMessage).toContain('could not be verified');
  });
});
