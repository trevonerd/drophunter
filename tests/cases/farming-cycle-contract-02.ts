import { expect, test } from 'bun:test';
import { createFarmingSession } from '../../src/background/farming-session.ts';
import { createDrop, createFarmingSessionAdapters, createStreamer } from '../fixtures/queue-management.ts';
import { fixture, NOW } from '../support/farming-cycle-contract.ts';
import { preparedWatch } from '../support/prepared-watch.ts';

test.each(['managed-tab', 'tabless'] as const)(
  '%s selection resumes the interrupted fourth channel before a new higher-viewer channel',
  async (mode) => {
    const { state, game, key } = fixture();
    const drop = createDrop({ campaignId: game.campaignId });
    state.cachedDropsSnapshot = [drop];
    state.appState.allDrops = [drop];
    state.appState.currentDrop = drop;
    state.appState.pendingDrops = [drop];
    state.appState.watchTransportPreference = mode;
    state.appState.queueEntryMetadataByKey[key] = {
      source: 'manual',
      reason: 'user-added',
      addedAt: NOW,
      attemptedStreamerNames: ['first', 'second', 'third', 'fourth'],
      watchAttempt: { channelName: 'fourth', observedAt: NOW - 10_000, suspendedAt: NOW - 1_000 },
    };
    const opened: string[] = [];
    state.appState.streamerSelectionMode = 'top-viewers';
    const farming = createFarmingSession(
      state,
      createFarmingSessionAdapters({
        fetchDropsSnapshotFromApi: async () => ({
          games: [game],
          drops: [drop],
          updatedAt: NOW,
          campaignsVerified: true,
          inventoryVerified: true,
        }),
        fetchInventorySnapshotFromApi: async () => ({
          games: [game],
          drops: [drop],
          updatedAt: NOW,
          inventoryVerified: true,
        }),
        fetchDirectoryStreamersFromApi: async () =>
          Object.assign(
            [
              createStreamer({ name: 'fourth', viewerCount: 10 }),
              createStreamer({ name: 'fifth', viewerCount: 1000 }),
            ],
            { languageFilterApplied: true },
          ),
        resolveCategorySlug: async () => 'test-game',
        watchTransport: {
          prepare: async (target) => {
            opened.push(target.channelName);
            return preparedWatch(target, {
              mode,
              isHealthy: true,
              status: 'healthy',
              reason: 'started',
              checkedAt: NOW,
              progress: null,
              consecutiveFailures: 0,
              consecutiveStalls: 0,
              shouldFallback: false,
            });
          },
          stop: async () => {},
          setPreference: async () => {},
          start: async () => ({ kind: 'cancelled' }),
          tick: async () => ({
            mode,
            isHealthy: true,
            status: 'healthy',
            reason: 'heartbeat',
            checkedAt: NOW,
            progress: null,
            consecutiveFailures: 0,
            consecutiveStalls: 0,
            shouldFallback: false,
          }),
        },
      }),
    );
    await farming.checkDropProgress();
    expect(opened).toEqual(['fourth']);
    expect(state.appState.activeStreamer?.name).toBe('fourth');
    expect(state.appState.queueEntryMetadataByKey[key]?.attemptedStreamerNames).toHaveLength(4);
    farming.stopMonitoring();
  },
);

test.each(['error', 'heartbeat-failed'] as const)(
  'tabless %s service failure preserves the streamer budget and unresolved target',
  async (reason) => {
    const { state, game, key } = fixture();
    const drop = createDrop({ campaignId: game.campaignId });
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
        fetchDropsSnapshotFromApi: async () => ({
          games: [game],
          drops: [drop],
          updatedAt: NOW,
          campaignsVerified: true,
          inventoryVerified: true,
        }),
        fetchInventorySnapshotFromApi: async () => ({
          games: [game],
          drops: [drop],
          updatedAt: NOW,
          inventoryVerified: true,
        }),
        fetchDirectoryStreamersFromApi: async () =>
          Object.assign([createStreamer({ name: 'available' })], { languageFilterApplied: true }),
        resolveCategorySlug: async () => 'test-game',
        watchTransport: {
          prepare: async () => ({
            kind: 'failed',
            reason: 'candidate-unavailable',
            health: {
              mode: 'tabless',
              status: 'failed',
              isHealthy: false,
              reason,
              checkedAt: NOW,
              progress: null,
              consecutiveFailures: 1,
              consecutiveStalls: 0,
              shouldFallback: false,
            },
          }),
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
    for (let retry = 0; retry < 5; retry++) {
      state.recoveryBackoffUntil = 0;
      state.appState.recoveryBackoffUntil = 0;
      await farming.acquireStreamerForSelectedGame();
      expect(state.appState.queueEntryMetadataByKey[key]?.attemptedStreamerNames).toEqual(['locally-failed']);
      expect(state.appState.campaignFailureEpisodesByKey).toEqual({});
      expect(state.appState.selectedGame?.campaignId).toBe(game.campaignId);
      expect(state.appState.isRunning).toBe(true);
      expect(state.appState.recoveryReason).toBe('directory-unavailable');
    }
    farming.stopMonitoring();
  },
);
