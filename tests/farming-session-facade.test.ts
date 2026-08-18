import { describe, expect, test } from 'bun:test';
import { createFarmingSession, type FarmingSessionAdapters } from '../src/background/farming-session.ts';
import { currentFarmingSessionEpoch } from '../src/background/farming-session-revision.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';

function createAdapters(): FarmingSessionAdapters {
  return {
    getInitPromise: () => null,
    trackActivity: async () => undefined,
    ensureTwitchSession: async () => null,
    fetchDropsSnapshotFromApi: async () => null,
    fetchInventorySnapshotFromApi: async () => null,
    fetchDirectoryStreamersFromApi: async () => Object.assign([], { languageFilterApplied: true }),
    fetchStreamContext: async () => null,
    resolveCategorySlug: async () => '',
    openForegroundChannel: async () => undefined,
    enforcePlaybackPolicyOnStreamTab: async () => undefined,
    attemptPlaybackSelfHeal: async () => undefined,
    attemptAutoClaimChannelPointsBonus: async () => false,
    closeManagedTabIfSafe: async () => true,
    clearManagedTabOwnership: () => undefined,
    openMonitorDashboardWindow: async () => undefined,
    sendAlert: async () => undefined,
    notify: async () => undefined,
    saveState: async () => undefined,
    saveTimingState: async () => undefined,
    broadcastStateUpdate: () => undefined,
    monitorAutoOpenDelayMs: 0,
  };
}

describe('farming session facade', () => {
  test('preserves the public session surface', () => {
    // Given
    const session = createFarmingSession(createServiceWorkerState(), createAdapters());

    // When
    const methods = Object.keys(session).sort();

    // Then
    expect(methods).toEqual([
      'acquireStreamerForSelectedGame',
      'checkDropProgress',
      'handleAddToQueue',
      'handleClearQueue',
      'handlePauseFarming',
      'handleRefreshDrops',
      'handleRemoveFromQueue',
      'handleReorderQueue',
      'handleResumeFarming',
      'handleSetSelectedGame',
      'handleStartFarming',
      'handleStopFarming',
      'recoverTwitchSession',
      'refreshDropsData',
      'resumeAfterAuthRecovery',
      'startMonitoring',
      'stop',
      'stopMonitoring',
    ]);
  });

  test('keeps tick and refresh outside the mutation epoch', async () => {
    // Given
    const state = createServiceWorkerState();
    const session = createFarmingSession(state, createAdapters());
    const capturedEpoch = currentFarmingSessionEpoch(state);

    // When
    await session.checkDropProgress();
    await session.refreshDropsData();
    await session.handleRefreshDrops();

    // Then
    expect(currentFarmingSessionEpoch(state)).toBe(capturedEpoch);
  });
});
