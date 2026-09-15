import { expect, test } from 'bun:test';
import { createActivationSyncCoordinator } from '../src/background/activation-sync-coordinator.ts';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerActivationSync } from '../src/background/service-worker-activation-sync.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import { createDrop, createFarmingSessionAdapters, createGame } from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

test('guarded update start preserves automatic queue provenance and acquisition order through actual session handlers', async () => {
  const chrome = setupChromeMocks();
  const state = createServiceWorkerState();
  const first = createGame({ campaignId: 'already-tried', endsAt: '2099-01-01T00:00:00Z' });
  const selected = createGame({ campaignId: 'next', endsAt: '2099-01-01T00:00:00Z' });
  const drop = createDrop({
    campaignId: selected.campaignId,
    requiredMinutes: 60,
    remainingMinutes: 40,
    currentMinutes: 20,
    progress: 33,
  });
  const round = { attemptedCampaignKeys: [gameKey(first)], nextRoundAt: Date.now() + 60_000 };
  Object.assign(state.appState, {
    queue: [first, selected],
    availableGames: [first, selected],
    selectedGame: selected,
    queueAcquisitionRound: round,
    farmingSessionOrigin: 'automatic',
    manualQueueAuthorized: false,
    monitorAutoOpen: false,
    pendingDrops: [drop],
    allDrops: [drop],
    currentDrop: drop,
    queueEntryMetadataByKey: {
      [gameKey(selected)]: { source: 'favorite', reason: 'favorite-auto-start', addedAt: 1 },
    },
  });
  state.cachedDropsSnapshot = [drop];
  const snapshot = { games: [first, selected], drops: [drop], updatedAt: Date.now() };
  const farming = createFarmingSession(
    state,
    createFarmingSessionAdapters({
      fetchDropsSnapshotFromApi: async () => snapshot,
      fetchInventorySnapshotFromApi: async () => snapshot,
    }),
  );
  try {
    const started = await farming.handleStartFarming({ game: selected }, () => true, true);
    expect(started.success).toBe(true);
    expect(state.appState.manualQueueAuthorized).toBe(false);
    expect(state.appState.farmingSessionOrigin).toBe('automatic');
    expect(state.appState.queueEntryMetadataByKey[gameKey(selected)]?.source).toBe('favorite');
    expect(state.appState.queue.map(gameKey)).toEqual([gameKey(first), gameKey(selected)]);
    expect(state.appState.selectedGame?.campaignId).toBe(selected.campaignId);
    expect(state.appState.queueAcquisitionRound).toEqual(round);
    expect(state.appState.allDrops[0]?.progress).toBe(33);
  } finally {
    farming.stopMonitoring();
    chrome.teardown();
  }
});

test('automatic update resume with missing reward data retains authorized queue and schedules validation retry', async () => {
  const chrome = setupChromeMocks();
  const state = createServiceWorkerState();
  const game = createGame({ campaignId: 'missing-rewards', endsAt: '2099-01-01T00:00:00Z' });
  Object.assign(state.appState, {
    selectedGame: game,
    queue: [game],
    availableGames: [game],
    wasRunning: true,
    manualQueueAuthorized: true,
    farmingSessionOrigin: 'manual',
    monitorAutoOpen: false,
  });
  state.hasCurrentGenerationCampaignValidation = true;
  const snapshot = { games: [game], drops: [], updatedAt: Date.now() };
  const farming = createFarmingSession(
    state,
    createFarmingSessionAdapters({
      fetchDropsSnapshotFromApi: async () => snapshot,
      fetchInventorySnapshotFromApi: async () => snapshot,
    }),
  );
  const activation = createServiceWorkerActivationSync({
    state,
    farmingSession: farming,
    automation: {
      request: async () => ({ kind: 'unchanged', reason: 'disabled' }),
      snooze: async () => 'snoozed',
      suppressCampaignUntilRefresh: async () => 'suppressed',
    },
    refreshGamesCache: async () => ({ kind: 'refreshed', games: [game], inventoryVerified: true }),
    dropsPageRefresher: {
      openDropsPageAndRefresh: async () => ({
        success: true,
        opened: false,
        refreshed: true,
        gamesCount: 1,
        inventoryVerified: true,
      }),
    },
  });
  let now = Date.now();
  const deadlines: number[] = [];
  const coordinator = createActivationSyncCoordinator({
    now: () => now,
    getCampaignSyncState: () => state.appState.campaignSyncState,
    setCampaignSyncState: (sync) => {
      state.appState.campaignSyncState = sync;
    },
    scheduleRetry: (deadline) => {
      deadlines.push(deadline);
    },
    performSync: activation,
  });
  try {
    const result = await coordinator.request('extension-update');
    expect(result.kind).toBe('retry-scheduled');
    expect(state.appState.campaignSyncState.status).toBe('retry-scheduled');
    expect(deadlines.at(-1)).toBeGreaterThan(now);
    expect(state.appState.queue.map(gameKey)).toEqual([gameKey(game)]);
    expect(state.appState.manualQueueAuthorized).toBe(true);
    expect(state.appState.wasRunning).toBe(true);
    expect(state.appState.isRunning).toBe(false);
    now = deadlines.at(-1) ?? now;
    await coordinator.request('wake');
    expect(deadlines.at(-1)).toBeGreaterThan(now);
    expect(state.appState.queue.map(gameKey)).toEqual([gameKey(game)]);
  } finally {
    farming.stopMonitoring();
    chrome.teardown();
  }
});
