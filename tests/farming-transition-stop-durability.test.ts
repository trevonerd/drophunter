import { describe, expect, spyOn, test } from 'bun:test';
import { FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY } from '../src/background/farming-automation-contracts.ts';
import {
  createInMemoryFarmingAutomationPersistence,
  createInMemoryFarmingAutomationStorage,
} from '../src/background/farming-automation-persistence.ts';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { currentFarmingSessionEpoch } from '../src/background/farming-session-revision.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { transitionAutomaticFarmingSession } from '../src/background/session-lifecycle-transition.ts';
import { createWatchTransportTransition } from '../src/background/watch-transport-transition.ts';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';
import { createFarmingSessionAdapters } from './fixtures/queue-management.ts';
import { candidate, snapshot, streamer } from './helpers/farming-session-transition-tabless.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { createExecutionBarrier } from './support/farming-automation-fixtures.ts';

describe('Stop during an automatic transition commit', () => {
  test.each([
    'storage-pending',
    'commit-return-pending',
  ] as const)('keeps Stop durable and disposes the candidate when %s', async (phase) => {
    // Given: a real persistence adapter and public farming controller share durable storage.
    const mocks = setupChromeMocks();
    const state = createServiceWorkerState();
    const storage = createInMemoryFarmingAutomationStorage();
    const persistence = createInMemoryFarmingAutomationPersistence({
      state,
      storage,
      getSessionRevision: () => String(currentFarmingSessionEpoch(state)),
      broadcast: () => {},
    });
    const session = createFarmingSession(
      state,
      createFarmingSessionAdapters({
        saveState: async (current) => storage.local.set({ appState: structuredClone(current.appState) }),
      }),
    );
    const barrier = createExecutionBarrier<void>();
    const originalSet = storage.local.set.bind(storage.local);
    const writeSpy = spyOn(storage.local, 'set').mockImplementation(async (values) => {
      if (phase === 'storage-pending' && FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY in values) {
        barrier.markStarted();
        await barrier.promise;
      }
      await originalSet(values);
    });
    let disposed = 0;
    const watch = createWatchTransportTransition({
      currentOwnership: null,
      prepareTabless: async () => null,
      prepareManaged: async () => ({
        target: { gameId: 'game-b', campaignId: 'campaign-b', channelName: 'channel-b' },
        ownership: {
          kind: 'managed-tab',
          tabId: 22,
          ownershipToken: 'owned-b',
          expectedChannel: 'channel-b',
        },
        health: {
          mode: 'managed-tab',
          isHealthy: true,
          status: 'healthy',
          reason: 'heartbeat',
          consecutiveFailures: 0,
          consecutiveStalls: 0,
          progress: 0,
          shouldFallback: false,
          checkedAt: 1,
        },
        dispose: async () => {
          disposed += 1;
        },
      }),
      release: async () => ({ kind: 'not-required' }),
    });
    try {
      const transition = transitionAutomaticFarmingSession(
        state,
        {
          attemptId: 'stop-durability',
          transition: 'start',
          fromCampaignKey: null,
          candidate,
          snapshot: snapshot(),
          watchMode: 'managed-tab',
          expectedFingerprint: 'stable',
        },
        {
          acquireStreamer: async () => streamer,
          currentFingerprint: () => 'stable',
          loadReceipt: persistence.loadReceipt,
          commitTransition: async (commit) => {
            const result = await persistence.commitTransition(commit);
            if (phase === 'commit-return-pending') {
              barrier.markStarted();
              await barrier.promise;
            }
            return result;
          },
          watch,
        },
      );
      await barrier.started;
      // When: public Stop completes without waiting for the old automatic commit.
      await session.handleStopFarming();
      expect(state.appState.isRunning).toBe(false);
      expect(normalizeStoredAppState(storage.getLocal('appState')).isRunning).toBe(false);
      barrier.release(undefined);
      const result = await transition;
      storage.restartBrowser();
      // Then: neither the late write nor late adoption can restart farming after browser restore.
      expect(result).toEqual({ kind: 'unchanged', reason: 'superseded-by-state-change' });
      expect(state.appState.isRunning).toBe(false);
      expect(state.appState.activeStreamer).toBeNull();
      expect(normalizeStoredAppState(storage.getLocal('appState')).isRunning).toBe(false);
      expect(normalizeStoredAppState(storage.getLocal('appState')).lastStopReason).toBe('user-stop');
      expect(watch.currentOwnership()).toBeNull();
      expect(disposed).toBe(1);
      if (phase === 'storage-pending')
        expect(storage.getLocal(FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY)).toBeUndefined();
    } finally {
      writeSpy.mockRestore();
      mocks.teardown();
    }
  });
});
