import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createFarmingSession, type FarmingSessionAdapters } from '../src/background/farming-session.ts';
import { currentFarmingSessionEpoch } from '../src/background/farming-session-revision.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createDrop, createGame, createStreamer } from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

let chrome: ReturnType<typeof setupChromeMocks>;

beforeEach(() => {
  chrome = setupChromeMocks();
});

afterEach(() => {
  chrome.teardown();
});

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
      'advanceQueueIfCompleted',
      'checkDropProgress',
      'handleAddToQueue',
      'handleAuthoritativeCampaignUnavailable',
      'handleClearQueue',
      'handlePauseFarming',
      'handleRemoveFromQueue',
      'handleReorderQueue',
      'handleResumeFarming',
      'handleSetSelectedGame',
      'handleStartFarming',
      'handleStopFarming',
      'reconcileQueueAvailability',
      'recoverTwitchSession',
      'refreshDropsData',
      'resumeAfterAuthRecovery',
      'startMonitoring',
      'stop',
      'stopMonitoring',
    ]);
  });

  test('keeps tick and progress refresh outside the mutation epoch', async () => {
    // Given
    const state = createServiceWorkerState();
    const session = createFarmingSession(state, createAdapters());
    const capturedEpoch = currentFarmingSessionEpoch(state);

    // When
    await session.checkDropProgress();
    await session.refreshDropsData();

    // Then
    expect(currentFarmingSessionEpoch(state)).toBe(capturedEpoch);
  });

  test('starts only when the requested campaign has a farmable reward', async () => {
    const state = createServiceWorkerState();
    const requested = createGame({ id: 'shared-game', campaignId: 'campaign-requested' });
    const sibling = createGame({ id: 'shared-game', campaignId: 'campaign-sibling' });
    const requestedDrop = createDrop({
      gameId: requested.id,
      campaignId: requested.campaignId,
      requiredMinutes: 60,
      remainingMinutes: 60,
    });
    state.appState.availableGames = [requested, sibling];
    state.appState.pendingDrops = [requestedDrop];
    state.appState.allDrops = [requestedDrop];
    state.appState.currentDrop = requestedDrop;
    state.appState.activeStreamer = createStreamer();

    const result = await createFarmingSession(state, createAdapters()).handleStartFarming({
      game: requested,
    });

    expect(result).toEqual({ success: true });
    expect(state.appState.selectedGame?.campaignId).toBe(requested.campaignId);
  });

  test('rejects a requested campaign when only a sibling campaign has a farmable reward', async () => {
    const state = createServiceWorkerState();
    const requested = createGame({ id: 'shared-game', campaignId: 'campaign-requested' });
    const sibling = createGame({ id: 'shared-game', campaignId: 'campaign-sibling' });
    const siblingDrop = createDrop({
      gameId: sibling.id,
      campaignId: sibling.campaignId,
      requiredMinutes: 60,
      remainingMinutes: 60,
    });
    state.appState.availableGames = [requested, sibling];
    state.appState.queue = [sibling];
    state.appState.pendingDrops = [siblingDrop];
    state.appState.allDrops = [siblingDrop];
    state.appState.currentDrop = siblingDrop;

    const result = await createFarmingSession(state, createAdapters()).handleStartFarming({
      game: requested,
    });

    expect(result).toEqual({ success: false, error: 'No farmable drops for this game.' });
    expect(state.appState.isRunning).toBe(false);
    expect(state.appState.selectedGame).toBeNull();
    expect(state.appState.queue.map((entry) => entry.campaignId)).toEqual([sibling.campaignId]);
  });
});
