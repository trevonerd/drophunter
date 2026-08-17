import { describe, expect, test } from 'bun:test';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import {
  advanceQueueIfCompleted,
  handleStartFarming,
  resetStreamTrackingState,
  skipCurrentGameAndAdvanceQueue,
  skipCurrentGameDueToStall,
  stopFarmingSession,
} from '../src/background/session-lifecycle.ts';
import * as queueLifecycle from '../src/background/session-lifecycle-queue.ts';
import * as startLifecycle from '../src/background/session-lifecycle-start.ts';
import * as stopLifecycle from '../src/background/session-lifecycle-stop.ts';
import type { TwitchDrop, TwitchGame } from '../src/types/index.ts';

function game(id: string): TwitchGame {
  return {
    id,
    name: `Game ${id}`,
    imageUrl: `https://example.com/${id}.png`,
    campaignId: `campaign-${id}`,
  };
}

function drop(selectedGame: TwitchGame, claimed = false): TwitchDrop {
  return {
    id: `drop-${selectedGame.id}`,
    name: `Drop ${selectedGame.id}`,
    gameId: selectedGame.id,
    gameName: selectedGame.name,
    imageUrl: selectedGame.imageUrl,
    campaignId: selectedGame.campaignId,
    progress: claimed ? 100 : 25,
    currentMinutes: claimed ? 60 : 15,
    requiredMinutes: 60,
    remainingMinutes: claimed ? 0 : 45,
    claimed,
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
  };
}

describe('session lifecycle facade', () => {
  test('re-exports every focused lifecycle implementation', () => {
    // Given
    const focusedImplementations = [
      queueLifecycle.advanceQueueIfCompleted,
      queueLifecycle.skipCurrentGameAndAdvanceQueue,
      queueLifecycle.skipCurrentGameDueToStall,
      startLifecycle.handleStartFarming,
      stopLifecycle.resetStreamTrackingState,
      stopLifecycle.stopFarmingSession,
    ];

    // When
    const facadeImplementations = [
      advanceQueueIfCompleted,
      skipCurrentGameAndAdvanceQueue,
      skipCurrentGameDueToStall,
      handleStartFarming,
      resetStreamTrackingState,
      stopFarmingSession,
    ];

    // Then
    expect(facadeImplementations).toEqual(focusedImplementations);
  });

  test('preserves manual start queue mutation and persistence count', async () => {
    // Given
    const selectedGame = game('start');
    const state = createServiceWorkerState();
    state.appState.availableGames = [selectedGame];
    state.appState.pendingDrops = [drop(selectedGame)];
    let saveCalls = 0;

    // When
    const result = await handleStartFarming(
      state,
      { game: selectedGame },
      {
        onRefreshDropsData: async () => {},
        onSaveState: async () => {
          saveCalls += 1;
        },
      },
    );

    // Then
    expect(result).toEqual({ success: true });
    expect(state.appState.queue).toEqual([selectedGame]);
    expect(state.appState.selectedGame).toEqual(selectedGame);
    expect(state.appState.isRunning).toBe(true);
    expect(saveCalls).toBe(1);
  });

  test('preserves queue advancement callbacks and persistence count', async () => {
    // Given
    const completedGame = game('completed');
    const nextGame = game('next');
    const nextDrop = drop(nextGame);
    const state = createServiceWorkerState();
    state.appState.isRunning = true;
    state.appState.selectedGame = completedGame;
    state.appState.availableGames = [completedGame, nextGame];
    state.appState.queue = [completedGame, nextGame];
    state.appState.allDrops = [drop(completedGame, true)];
    state.appState.pendingDrops = [];
    state.appState.currentDrop = null;
    let openCalls = 0;
    let saveCalls = 0;

    // When
    const running = await advanceQueueIfCompleted(state, {
      onSaveTimingState: async () => {},
      onRefreshDropsData: async () => {
        state.appState.allDrops = [nextDrop];
        state.appState.pendingDrops = [nextDrop];
        state.appState.currentDrop = nextDrop;
      },
      onOpenStreamer: async () => {
        openCalls += 1;
        return true;
      },
      onSaveState: async () => {
        saveCalls += 1;
      },
    });

    // Then
    expect(running).toBe(true);
    expect(state.appState.queue).toEqual([nextGame]);
    expect(state.appState.selectedGame).toEqual(nextGame);
    expect(openCalls).toBe(1);
    expect(saveCalls).toBe(1);
  });

  test('preserves stop callback order and persistence count', async () => {
    // Given
    const state = createServiceWorkerState();
    state.appState.isRunning = true;
    state.appState.isPaused = true;
    state.appState.tabId = 42;
    const events: string[] = [];

    // When
    await stopFarmingSession(state, {
      notification: { title: 'Stopped', message: 'Stopped by test.' },
      stopReason: 'test-stop',
      onStopMonitoring: () => events.push('monitor'),
      onCloseManagedTab: async () => events.push('tab'),
      onApplyStopState: () => events.push('stop-state'),
      onNotify: async () => events.push('notification'),
      onSaveState: async () => events.push('state'),
      onSaveTimingState: async () => events.push('timing'),
    });

    // Then
    expect(events).toEqual(['monitor', 'tab', 'stop-state', 'notification', 'state', 'timing']);
    expect(state.appState.isRunning).toBe(false);
    expect(state.appState.isPaused).toBe(false);
    expect(state.appState.tabId).toBeNull();
  });
});
