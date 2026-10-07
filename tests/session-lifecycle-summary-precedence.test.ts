import { describe, expect, test } from 'bun:test';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { handleStartFarming } from '../src/background/session-lifecycle.ts';
import type { TwitchDrop, TwitchGame } from '../src/types/index.ts';
import { createQueueProgressionFixture } from './support/queue-progression.ts';

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
    const running = await createQueueProgressionFixture(state, {
      transitionCampaign: async () => {
        refreshCalls += 1;
        return { kind: 'completed' };
      },
      stopMonitoring: () => {
        stopCalls += 1;
      },
    }).advanceIfCompleted();

    // Then
    expect(running).toBe(true);
    expect(state.appState.selectedGame).toEqual(selected);
    expect(state.appState.queue).toEqual([selected, next]);
    expect(state.appState.isRunning).toBe(true);
    expect(refreshCalls).toBe(0);
    expect(stopCalls).toBe(0);
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

  test('keeps Start authorized when only an unresolved subscription reward remains', async () => {
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
    expect(result).toEqual({ success: true });
    expect(state.appState.isRunning).toBe(true);
    expect(state.appState.selectedGame).toEqual(requested);
    expect(state.appState.queue).toEqual([requested, queued]);
    expect(refreshCalls).toBe(1);
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

  test('waits on subscription-only rewards without declaring completion', async () => {
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
    const running = await createQueueProgressionFixture(state, {
      transitionCampaign: async () => ({ kind: 'waiting' }),
    }).advanceIfCompleted();

    // Then
    expect(running).toBe(true);
    expect(state.appState.selectedGame).toEqual(terminal);
    expect(state.appState.lastStopReason).toBeNull();
    expect(state.appState.queueAcquisitionRound?.nextRoundAt).toBeGreaterThan(Date.now());
  });

  test('waits on unverifiable rewards without declaring completion', async () => {
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
    const running = await createQueueProgressionFixture(state, {
      transitionCampaign: async () => ({ kind: 'waiting' }),
    }).advanceIfCompleted();

    // Then
    expect(running).toBe(true);
    expect(state.appState.selectedGame).toEqual(terminal);
    expect(state.appState.lastStopReason).toBeNull();
    expect(state.appState.queueAcquisitionRound?.nextRoundAt).toBeGreaterThan(Date.now());
  });
});
