import { describe, expect, test } from 'bun:test';
import type { FarmingAutomation } from '../src/background/farming-automation-contracts.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerActivationSync } from '../src/background/service-worker-activation-sync.ts';
import { createCampaignFixture, createDeferred } from './support/farming-automation-fixtures.ts';

describe('service-worker activation sync', () => {
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
        }),
      },
      farmingSession: {
        acquireStreamerForSelectedGame: async () => false,
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
