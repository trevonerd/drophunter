import { expect, spyOn, test } from 'bun:test';
import { projectDropsSnapshot } from '../../src/background/drops-projection.ts';
import { createFarmingSession } from '../../src/background/farming-session.ts';
import { createDrop, createFarmingSessionAdapters, createStreamer } from '../fixtures/queue-management.ts';
import { fixture, NOW } from '../support/farming-cycle-contract.ts';

test('a tabless service failure cannot restore attempts cleared by concurrent progress', async () => {
  const { state, game, key } = fixture();
  const drop = createDrop({
    campaignId: game.campaignId,
    gameId: game.id,
    requiredMinutes: 60,
    currentMinutes: 5,
    progress: 8,
  });
  const snapshot = {
    games: [game],
    drops: [drop],
    updatedAt: NOW,
    campaignsVerified: true,
    inventoryVerified: true,
  };
  state.cachedDropsSnapshot = [drop];
  Object.assign(state.appState, {
    allDrops: [drop],
    pendingDrops: [drop],
    currentDrop: drop,
    watchTransportPreference: 'tabless',
  });
  state.appState.queueEntryMetadataByKey[key] = {
    source: 'manual',
    reason: 'user-added',
    addedAt: NOW,
    attemptedStreamerNames: ['locally-failed'],
  };
  const farming = createFarmingSession(
    state,
    createFarmingSessionAdapters({
      fetchDropsSnapshotFromApi: async () => snapshot,
      fetchInventorySnapshotFromApi: async () => snapshot,
      fetchDirectoryStreamersFromApi: async () =>
        Object.assign([createStreamer({ name: 'available' })], { languageFilterApplied: true }),
      resolveCategorySlug: async () => 'test-game',
      watchTransport: {
        prepare: async () => {
          expect(state.appState.queueEntryMetadataByKey[key]?.attemptedStreamerNames).toEqual([
            'locally-failed',
            'available',
          ]);
          projectDropsSnapshot(
            state,
            { ...snapshot, drops: [{ ...drop, currentMinutes: 10, progress: 16 }] },
            'campaign-authoritative',
          );
          return {
            kind: 'failed',
            reason: 'candidate-unavailable',
            health: {
              mode: 'tabless',
              status: 'failed',
              isHealthy: false,
              reason: 'error',
              checkedAt: NOW,
              progress: null,
              consecutiveFailures: 1,
              consecutiveStalls: 0,
              shouldFallback: false,
            },
          };
        },
        stop: async () => {},
        setPreference: async () => {},
        start: async () => ({ kind: 'cancelled' }),
        tick: async () => ({
          mode: 'tabless',
          status: 'not-started',
          isHealthy: false,
          reason: 'not-started',
          checkedAt: NOW,
          progress: null,
          consecutiveFailures: 0,
          consecutiveStalls: 0,
          shouldFallback: false,
        }),
      },
    }),
  );
  try {
    await farming.acquireStreamerForSelectedGame();
    expect(state.cachedDropsSnapshot[0]?.currentMinutes).toBe(10);
    expect(state.appState.queueEntryMetadataByKey[key]?.attemptedStreamerNames).toBeUndefined();
    expect(state.appState.queueEntryMetadataByKey[key]?.watchAttempt).toBeUndefined();
  } finally {
    farming.stopMonitoring();
  }
});

test.each(['healthy', 'degraded'] as const)(
  'tabless service outage freezes observation until a %s response without rotating a viable channel',
  async (recoveredStatus) => {
    const { state, game, key } = fixture();
    const drop = createDrop({ campaignId: game.campaignId, requiredMinutes: 60, currentMinutes: 0 });
    state.cachedDropsSnapshot = [drop];
    Object.assign(state.appState, {
      allDrops: [drop],
      pendingDrops: [drop],
      currentDrop: drop,
      activeStreamer: createStreamer({ name: 'current' }),
      watchTransportPreference: 'tabless',
    });
    state.appState.queueEntryMetadataByKey[key] = {
      source: 'manual',
      reason: 'user-added',
      addedAt: NOW,
      attemptedStreamerNames: ['current'],
      watchAttempt: { channelName: 'current', observedAt: NOW - 60_000 },
    };
    let failed = true;
    let acquisitions = 0;
    const health = () => ({
      mode: 'tabless' as const,
      status: failed ? ('failed' as const) : recoveredStatus,
      isHealthy: !failed && recoveredStatus === 'healthy',
      reason: failed
        ? ('error' as const)
        : recoveredStatus === 'healthy'
          ? ('heartbeat' as const)
          : ('drops-inactive' as const),
      checkedAt: Date.now(),
      progress: 0,
      consecutiveFailures: failed ? 10 : 0,
      consecutiveStalls: 0,
      shouldFallback: failed,
    });
    const farming = createFarmingSession(
      state,
      createFarmingSessionAdapters({
        fetchDropsSnapshotFromApi: async () => ({
          games: [game],
          drops: [drop],
          updatedAt: Date.now(),
          campaignsVerified: true,
          inventoryVerified: true,
        }),
        fetchInventorySnapshotFromApi: async () => ({
          games: [game],
          drops: [drop],
          updatedAt: Date.now(),
          inventoryVerified: true,
        }),
        fetchDirectoryStreamersFromApi: async () => {
          acquisitions++;
          return Object.assign([createStreamer({ name: 'other' })], { languageFilterApplied: true });
        },
        watchTransport: {
          tick: async () => health(),
          start: async () => ({ kind: 'started', health: health() }),
          stop: async () => {},
          setPreference: async () => {},
        },
      }),
    );
    await farming.checkDropProgress();
    expect(state.appState.queueEntryMetadataByKey[key]?.watchAttempt?.suspendedAt).toBe(NOW);
    spyOn(Date, 'now').mockReturnValue(NOW + 20 * 60_000);
    await farming.checkDropProgress();
    expect(acquisitions).toBe(0);
    expect(state.appState.activeStreamer?.name).toBe('current');
    expect(state.appState.queueEntryMetadataByKey[key]?.attemptedStreamerNames).toEqual(['current']);
    failed = false;
    await farming.checkDropProgress();
    expect(state.appState.queueEntryMetadataByKey[key]?.watchAttempt).toEqual({
      channelName: 'current',
      observedAt: NOW + 19 * 60_000,
    });
    expect(acquisitions).toBe(0);
    expect(state.appState.campaignFailureEpisodesByKey).toEqual({});
    farming.stopMonitoring();
  },
);
