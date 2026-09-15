import { describe, expect, test } from 'bun:test';
import type { FarmingAutomation } from '../src/background/farming-automation-contracts.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerActivationSync } from '../src/background/service-worker-activation-sync.ts';
import { createCampaignFixture, createDeferred } from './support/farming-automation-fixtures.ts';

describe('service-worker activation sync', () => {
  test('clears a stale queue-complete alert after fresh validation finds active queued work', async () => {
    // Given active queue work restored from cache and a fresh verified inventory snapshot.
    const state = createServiceWorkerState();
    const game = createCampaignFixture();
    state.appState.isRunning = true;
    state.appState.queue = [game];
    const cleared: string[] = [];
    let queueAdvanceCalls = 0;
    const automation: FarmingAutomation = {
      request: async () => ({ kind: 'unchanged', reason: 'disabled' }),
      snooze: async () => 'snoozed',
      suppressCampaignUntilRefresh: async () => 'suppressed',
    };
    const performSync = createServiceWorkerActivationSync({
      automation,
      clearQueueCompleteNotification: async () => {
        cleared.push('queue-complete');
      },
      dropsPageRefresher: {
        openDropsPageAndRefresh: async () => ({
          success: true,
          opened: false,
          refreshed: true,
          gamesCount: 1,
        }),
      },
      farmingSession: {
        acquireStreamerForSelectedGame: async () => false,
        advanceQueueIfCompleted: async () => {
          queueAdvanceCalls += 1;
          return true;
        },
        handleStartFarming: async () => ({ success: true }),
      },
      refreshGamesCache: async () => ({ kind: 'refreshed', games: [game], inventoryVerified: true }),
      state,
    });

    // When the current activation synchronizes its fresh campaign catalog.
    const result = await performSync('wake', {
      signal: new AbortController().signal,
      isCurrent: () => true,
    });

    // Then the old terminal browser alert is removed without changing automation delivery.
    expect(result).toEqual({ kind: 'synced', campaignCount: 0 });
    expect(cleared).toEqual(['queue-complete']);
    expect(queueAdvanceCalls).toBe(1);
  });

  test('retains a valid queue-complete alert when fresh validation confirms exhaustion', async () => {
    // Given a terminal queue state and a current authoritative empty inventory result.
    const state = createServiceWorkerState();
    const cleared: string[] = [];
    let queueAdvanceCalls = 0;
    const automation: FarmingAutomation = {
      request: async () => ({ kind: 'unchanged', reason: 'disabled' }),
      snooze: async () => 'snoozed',
      suppressCampaignUntilRefresh: async () => 'suppressed',
    };
    const performSync = createServiceWorkerActivationSync({
      automation,
      clearQueueCompleteNotification: async () => {
        cleared.push('queue-complete');
      },
      dropsPageRefresher: {
        openDropsPageAndRefresh: async () => ({
          success: true,
          opened: false,
          refreshed: true,
          gamesCount: 0,
        }),
      },
      farmingSession: {
        acquireStreamerForSelectedGame: async () => false,
        advanceQueueIfCompleted: async () => {
          queueAdvanceCalls += 1;
          return false;
        },
        handleStartFarming: async () => ({ success: true }),
      },
      refreshGamesCache: async () => ({
        kind: 'refreshed',
        games: [],
        authoritativeEmpty: true,
        inventoryVerified: true,
      }),
      state,
    });

    // When the fresh validation confirms there are no queued campaigns left.
    const result = await performSync('wake', {
      signal: new AbortController().signal,
      isCurrent: () => true,
    });

    // Then no prior valid queue-complete alert is retracted, and finalization runs once.
    expect(result).toEqual({ kind: 'synced', campaignCount: 0 });
    expect(cleared).toEqual([]);
    expect(queueAdvanceCalls).toBe(1);
  });

  test('does not clear the update resume marker when farming start completes after cancellation', async () => {
    const state = createServiceWorkerState();
    const game = createCampaignFixture();
    state.appState.selectedGame = game;
    state.appState.wasRunning = true;
    state.appState.autoResumeOnStartup = true;
    const startEntered = createDeferred<void>();
    const startResult = createDeferred<{ readonly success: true }>();
    const automation: FarmingAutomation = {
      request: async () => ({ kind: 'unchanged', reason: 'disabled' }),
      snooze: async () => 'snoozed',
      suppressCampaignUntilRefresh: async () => 'suppressed',
    };
    const performSync = createServiceWorkerActivationSync({
      automation,
      dropsPageRefresher: {
        openDropsPageAndRefresh: async () => ({
          success: true,
          opened: false,
          refreshed: true,
          gamesCount: 1,
          inventoryVerified: true,
        }),
      },
      farmingSession: {
        acquireStreamerForSelectedGame: async () => false,
        advanceQueueIfCompleted: async () => true,
        handleStartFarming: async () => {
          startEntered.resolve(undefined);
          return startResult.promise;
        },
      },
      refreshGamesCache: async () => ({ kind: 'cached', games: [] }),
      state,
    });
    const controller = new AbortController();
    let current = true;

    const pending = performSync('extension-update', {
      signal: controller.signal,
      isCurrent: () => current && !controller.signal.aborted,
    });
    await startEntered.promise;
    current = false;
    controller.abort();
    startResult.resolve({ success: true });

    await expect(pending).resolves.toEqual({
      kind: 'transient-error',
      error: 'Campaign sync was superseded.',
      errorKind: 'network',
    });
    expect(state.appState.wasRunning).toBe(true);
  });
});
