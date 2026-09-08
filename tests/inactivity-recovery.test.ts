import { describe, expect, test } from 'bun:test';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { resetStateForInactivity } from '../src/background/state-persistence.ts';
import { createInitialState } from '../src/shared/utils.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

describe('recovery after prolonged browser inactivity', () => {
  test.each([3, 21])('preserves saved queue and stall evidence after %i idle days', async (idleDays) => {
    const mocks = setupChromeMocks();
    try {
      const state = createServiceWorkerState();
      const campaign = { id: 'game', campaignId: 'saved-campaign', name: 'Saved game', imageUrl: '' };
      const metadata = { source: 'manual' as const, addedAt: 1, reason: 'user-added' as const };
      const block = {
        blockedAt: 2,
        rotationAttempts: 3,
        eligibleStreamerNames: ['old-channel'],
        rewardProgressByKey: { 'reward::saved-campaign': { progress: 20, currentMinutes: 12 } },
      };
      state.appState.queue = [campaign];
      state.appState.selectedGame = campaign;
      state.appState.availableGames = [campaign];
      state.appState.queueEntryMetadataByKey = { 'campaign:saved-campaign': metadata };
      state.appState.stalledCampaignBlocksByKey = { 'campaign:saved-campaign': block };
      state.appState.manualQueueAuthorized = true;
      state.appState.farmingSessionOrigin = 'manual';
      state.appState.autoResumeOnStartup = true;
      state.appState.autoStartFavoriteGames = false;
      state.appState.isRunning = true;
      state.appState.tabId = 9;
      state.appState.lastSuccessfulRefreshAt = 10;
      const sync = {
        status: 'retry-scheduled' as const,
        lastAttemptAt: 10,
        lastSuccessAt: 5,
        campaignCount: 1,
        nextRetryAt: 60_010,
        retryAttemptCount: 3,
        lastErrorKind: 'network' as const,
        attemptDeadlineAt: null,
      };
      state.appState.campaignSyncState = sync;

      const reset = await resetStateForInactivity(
        state,
        'loadState',
        idleDays * 86_400_000,
        {
          onStopMonitoring: () => undefined,
          onClearRotationMetadata: (appState) => appState,
          onResetStreamTrackingState: () => undefined,
          onSaveTimingState: async () => undefined,
          onBroadcastStateUpdate: () => undefined,
        },
        {
          createInitialState,
          DROPS_SNAPSHOT_CACHE_KEY: 'snapshot',
          LAST_ACTIVITY_AT_KEY: 'activity',
          TIMING_STATE_KEY: 'timing',
        },
      );

      expect(state.appState).toMatchObject({
        queue: [campaign],
        selectedGame: campaign,
        availableGames: [campaign],
        queueEntryMetadataByKey: { 'campaign:saved-campaign': metadata },
        stalledCampaignBlocksByKey: { 'campaign:saved-campaign': block },
        manualQueueAuthorized: true,
        autoResumeOnStartup: true,
        autoStartFavoriteGames: false,
        lastSuccessfulRefreshAt: 10,
        campaignSyncState: sync,
        isRunning: false,
        tabId: null,
      });
      expect(mocks.storage.local._store.get('appState')).toMatchObject({
        queue: [campaign],
        stalledCampaignBlocksByKey: { 'campaign:saved-campaign': block },
      });
      expect(reset).toBe(true);
    } finally {
      mocks.teardown();
    }
  });

  test('retains the live queue and retry state when persistence rejects the reset', async () => {
    const mocks = setupChromeMocks();
    try {
      const state = createServiceWorkerState();
      const campaign = { id: 'game', campaignId: 'saved-campaign', name: 'Saved game', imageUrl: '' };
      state.appState.queue = [campaign];
      state.appState.selectedGame = campaign;
      state.appState.campaignSyncState = {
        status: 'retry-scheduled',
        lastAttemptAt: 10,
        lastSuccessAt: 5,
        campaignCount: 1,
        nextRetryAt: 60_010,
        retryAttemptCount: 3,
        lastErrorKind: 'network',
        attemptDeadlineAt: null,
      };
      await mocks.storage.local.set({ appState: state.appState, timing: { retryAttemptCount: 3 } });
      mocks.storage.local.set = async () => {
        throw new Error('storage unavailable');
      };
      let broadcasts = 0;

      const reset = await resetStateForInactivity(
        state,
        'loadState',
        21 * 86_400_000,
        {
          onStopMonitoring: () => {
            throw new Error('monitoring must remain active when persistence fails');
          },
          onClearRotationMetadata: (appState) => appState,
          onResetStreamTrackingState: () => undefined,
          onSaveTimingState: async () => undefined,
          onBroadcastStateUpdate: () => {
            broadcasts += 1;
          },
        },
        {
          createInitialState,
          DROPS_SNAPSHOT_CACHE_KEY: 'snapshot',
          LAST_ACTIVITY_AT_KEY: 'activity',
          TIMING_STATE_KEY: 'timing',
        },
      );

      expect(reset).toBe(false);
      expect(state.appState.queue).toEqual([campaign]);
      expect(state.appState.campaignSyncState.retryAttemptCount).toBe(3);
      expect(mocks.storage.local._store.get('appState')).toEqual(state.appState);
      expect(mocks.storage.local._store.get('timing')).toEqual({ retryAttemptCount: 3 });
      expect(broadcasts).toBe(0);
    } finally {
      mocks.teardown();
    }
  });
});
