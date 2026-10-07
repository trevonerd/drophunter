import { expect, test } from 'bun:test';
import { createFarmingSession } from '../../src/background/farming-session.ts';
import {
  beginStreamerWatchAttempt,
  suspendWatchObservation,
} from '../../src/background/streamer-watch-attempt.ts';
import { gameKey } from '../../src/shared/game-selection.ts';
import {
  createDrop,
  createFarmingSessionAdapters,
  createGame,
  createStreamer,
} from '../fixtures/queue-management.ts';
import { fixture, NOW } from '../support/farming-cycle-contract.ts';
import { preparedWatch } from '../support/prepared-watch.ts';

test.each(['managed-tab', 'tabless'] as const)(
  '%s missing rewards park the unresolved active campaign and continue the queue',
  async (mode) => {
    const { state, game, key } = fixture();
    const next = createGame({ campaignId: 'next', categorySlug: 'test-game', dropCount: 1 });
    const drop = createDrop({ campaignId: next.campaignId });
    const snapshot = {
      games: [game, next],
      drops: [drop],
      updatedAt: NOW,
      campaignsVerified: true,
      authoritativeCampaignIds: next.campaignId ? [next.campaignId] : [],
      inventoryVerified: true,
    };
    state.appState.queue = [game, next];
    state.appState.availableGames = [game, next];
    state.appState.activeStreamer = createStreamer({ name: 'previous' });
    state.appState.watchTransportPreference = mode;
    state.appState.queueEntryMetadataByKey[key] = {
      source: 'manual',
      addedAt: 1,
      reason: 'user-added',
      attemptedStreamerNames: ['previous'],
      watchAttempt: { channelName: 'previous', observedAt: NOW - 300_000 },
    };
    state.lastProgressAdvanceAt = 0;
    let starts = 0;
    const farming = createFarmingSession(
      state,
      createFarmingSessionAdapters({
        ensureTwitchSession: async () => ({
          oauthToken: 'fixture',
          userId: 'viewer',
          deviceId: 'device',
          uuid: 'uuid',
        }),
        fetchDropsSnapshotFromApi: async () => snapshot,
        fetchInventorySnapshotFromApi: async () => snapshot,
        fetchDirectoryStreamersFromApi: async () =>
          Object.assign([createStreamer({ name: 'next' })], { languageFilterApplied: true }),
        resolveCategorySlug: async () => 'test-game',
        watchTransport: {
          prepare: async (target) => {
            starts++;
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
          start: async () => {
            starts++;
            return {
              kind: 'started',
              health: {
                mode,
                isHealthy: true,
                status: 'healthy',
                reason: 'heartbeat',
                checkedAt: NOW,
                progress: null,
                consecutiveFailures: 0,
                consecutiveStalls: 0,
                shouldFallback: false,
              },
            };
          },
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
          stop: async () => {},
          setPreference: async () => {},
        },
      }),
    );
    await farming.checkDropProgress();
    expect(state.appState.selectedGame?.campaignId).toBe('next');
    expect(starts).toBe(1);
    expect(state.appState.farmingSessionTargets[key]?.acquired).toBe(false);
    expect(state.appState.queue.map(gameKey)).toContain(key);
    farming.stopMonitoring();
  },
);

test.each(['managed-tab', 'tabless'] as const)(
  '%s interrupted viable channel resumes without reopening failed channels or exceeding four',
  (mode) => {
    const { state, game, key } = fixture();
    state.appState.watchTransportPreference = mode;
    state.appState.activeStreamer = createStreamer({ name: 'fourth' });
    state.appState.queueEntryMetadataByKey[key] = {
      source: 'manual',
      reason: 'user-added',
      addedAt: NOW,
      attemptedStreamerNames: ['first', 'second', 'third', 'fourth'],
      watchAttempt: { channelName: 'fourth', observedAt: NOW - 10_000 },
    };
    suspendWatchObservation(state, NOW);
    expect(beginStreamerWatchAttempt(state, game, 'fourth', NOW + 120_000)).toBe(true);
    expect(state.appState.queueEntryMetadataByKey[key]?.attemptedStreamerNames).toEqual([
      'first',
      'second',
      'third',
      'fourth',
    ]);
    expect(state.appState.queueEntryMetadataByKey[key]?.watchAttempt?.observedAt).toBe(NOW + 110_000);
    expect(beginStreamerWatchAttempt(state, game, 'first')).toBe(false);
    expect(beginStreamerWatchAttempt(state, game, 'fifth')).toBe(false);
    expect(beginStreamerWatchAttempt(state, game, 'fourth')).toBe(false);
  },
);
