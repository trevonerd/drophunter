import { expect, test } from 'bun:test';
import { createActivationSyncCoordinator } from '../src/background/activation-sync-coordinator.ts';
import { createDropsPageRefresher } from '../src/background/drops-page-refresh.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerActivationSync } from '../src/background/service-worker-activation-sync.ts';
import { createGame } from './fixtures/queue-management.ts';

test.each([
  'integrity',
  'network',
  'rate-limit',
  'invalid-response',
] as const)('progressive catalog followed by final %s failure cannot validate silent recovery', async (failureKind) => {
  const state = createServiceWorkerState();
  const game = createGame();
  let evaluated = false;
  const dropsPageRefresher = createDropsPageRefresher(state, {
    tabsApi: { query: async () => [{ id: 33 }], create: async () => null, update: async () => undefined },
    trackActivity: () => {},
    ensureStateHydratedForCache: () => {},
    waitForTabComplete: () => {},
    persistSessionFromDropsPage: async () => ({ sessionDetected: true }),
    refreshGamesCacheFromHiddenFetch: async (options) => {
      state.appState.availableGames = [game];
      await options.onProgressiveSnapshotApplied?.();
      return {
        kind: 'unavailable',
        games: [game],
        failure: {
          kind: failureKind,
          message: 'Final inventory verification rejected.',
          retryAfterMs: 120_000,
        },
      };
    },
    saveState: () => {},
    broadcastStateUpdate: () => {},
    campaignRefreshAttempts: 1,
  });
  const performSync = createServiceWorkerActivationSync({
    state,
    dropsPageRefresher,
    refreshGamesCache: async () => ({
      kind: 'unavailable',
      games: [game],
      failure: { kind: 'integrity', message: 'Integrity failed.' },
    }),
    automation: {
      request: async () => {
        evaluated = true;
        return { kind: 'unchanged', reason: 'no-eligible-campaign' };
      },
    },
    farmingSession: {
      acquireStreamerForSelectedGame: async () => false,
      advanceQueueIfCompleted: async () => {},
      handleStartFarming: async () => ({ success: true }),
    },
  });
  const coordinator = createActivationSyncCoordinator({
    getCampaignSyncState: () => state.appState.campaignSyncState,
    setCampaignSyncState: async (next) => {
      state.appState.campaignSyncState = next;
    },
    scheduleRetry: async () => {},
    clearRetry: async () => {},
    performSync,
  });
  expect((await coordinator.request('worker-start')).kind).toBe(
    failureKind === 'integrity' ? 'needs-session' : 'retry-scheduled',
  );
  expect(state.appState.campaignSyncState).toMatchObject({
    status: failureKind === 'integrity' ? 'needs-session' : 'retry-scheduled',
    lastErrorKind: failureKind,
    lastSuccessAt: null,
  });
  expect(evaluated).toBe(false);
  expect(state.appState.availableGames).toHaveLength(1);
});
