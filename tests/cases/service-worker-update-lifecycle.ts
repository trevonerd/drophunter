import { expect, test } from 'bun:test';
import { clearRotationMetadata, createServiceWorkerState } from '../../src/background/runtime-state.ts';
import { loadState as loadPersistedState } from '../../src/background/state-persistence.ts';
import { createInitialState } from '../../src/shared/utils.ts';
import { demoGame } from '../fixtures/service-worker-games.ts';
import {
  chromeMocks,
  dispatchMessage,
  getAppStateFromStorage,
  serviceWorkerModule,
  sleepTick,
} from '../helpers/service-worker-harness.ts';

export function registerUpdateLifecycleCase() {
  test('extension update discards an old volatile reward snapshot before current state reload', async () => {
    // Given
    const onInstalled = chromeMocks.chrome.runtime.onInstalled;

    await dispatchMessage({ type: 'SET_MONITOR_AUTO_OPEN', payload: { enabled: true } });
    await dispatchMessage({ type: 'SET_MUTE_FARMING_TAB', payload: { enabled: true } });
    await dispatchMessage({ type: 'UPDATE_GAMES', payload: [demoGame] });
    await dispatchMessage({ type: 'ADD_TO_QUEUE', payload: { game: demoGame } });
    await dispatchMessage({ type: 'SET_SELECTED_GAME', payload: { game: demoGame } });

    const beforeUpdate = getAppStateFromStorage();
    expect(beforeUpdate.queue).toHaveLength(1);
    expect(beforeUpdate.selectedGame?.id).toBe('game-1');
    expect(beforeUpdate.monitorAutoOpen).toBe(true);
    expect(beforeUpdate.muteFarmingTab).toBe(true);

    const oldRewardSemanticField = ['drop', 'Type'].join('');
    const oldRewardSnapshot = {
      id: 'old-reward',
      name: 'Old Reward',
      gameId: 'game-1',
      gameName: 'Demo Game',
      imageUrl: '',
      progress: 45,
      currentMinutes: 27,
      claimed: false,
      [oldRewardSemanticField]: ['time', 'based'].join('-'),
    };
    await chromeMocks.storage.local.set({
      appState: {
        ...beforeUpdate,
        currentDrop: oldRewardSnapshot,
        allDrops: [oldRewardSnapshot],
        pendingDrops: [oldRewardSnapshot],
      },
      [serviceWorkerModule.DROPS_SNAPSHOT_CACHE_KEY]: [oldRewardSnapshot],
      [serviceWorkerModule.TIMING_STATE_KEY]: { lastTrackedDropKey: 'old-reward::campaign-1' },
      farmingAutomationFactsV1: { version: 1 },
      farmingSessionTransitionReceiptV1: {
        version: 1,
        toWatch: { kind: 'managed-tab', tabId: 42 },
      },
    });

    // When
    onInstalled.trigger({ reason: 'update' });
    await sleepTick();
    await sleepTick();

    const reloadedState = createServiceWorkerState();
    await loadPersistedState(
      reloadedState,
      {
        onLoadTimingState: async () => {},
        onEnforceInactivityReset: async () => false,
      },
      {
        sanitizeTwitchSession: () => null,
        sessionDebugSummary: () => ({}),
        createInitialState,
        clearRotationMetadata,
        TWITCH_SESSION_STORAGE_KEY: serviceWorkerModule.TWITCH_SESSION_STORAGE_KEY,
        DROPS_SNAPSHOT_CACHE_KEY: serviceWorkerModule.DROPS_SNAPSHOT_CACHE_KEY,
        LAST_ACTIVITY_AT_KEY: serviceWorkerModule.LAST_ACTIVITY_AT_KEY,
        TIMING_STATE_KEY: serviceWorkerModule.TIMING_STATE_KEY,
        STREAM_VALIDATION_GRACE_MS: 0,
      },
    );

    // Then
    expect(reloadedState.cachedDropsSnapshot).toEqual([]);
    expect(reloadedState.appState.currentDrop).toBeNull();
    expect(reloadedState.appState.allDrops).toEqual([]);
    expect(reloadedState.appState.pendingDrops).toEqual([]);
    expect(reloadedState.appState.completedDrops).toEqual([]);
    expect(reloadedState.appState.queue).toEqual(beforeUpdate.queue);
    expect(reloadedState.appState.selectedGame).toEqual(beforeUpdate.selectedGame);
    expect(reloadedState.appState.wasRunning).toBe(beforeUpdate.isRunning);
    expect(reloadedState.appState.isRunning).toBe(false);
    expect(reloadedState.appState.monitorAutoOpen).toBe(true);
    expect(reloadedState.appState.muteFarmingTab).toBe(true);
    expect(reloadedState.appState.totalDropsClaimed).toBe(beforeUpdate.totalDropsClaimed);
    const resetTimingState = chromeMocks.storage.local._store.get(serviceWorkerModule.TIMING_STATE_KEY) as {
      apiBackoffUntil?: number;
      lastLifecycleCheckAt?: number;
      lastTrackedDropKey?: string | null;
    };
    expect(resetTimingState.lastTrackedDropKey).toBeNull();
    expect(resetTimingState.apiBackoffUntil).toBe(0);
    expect(resetTimingState.lastLifecycleCheckAt).toBeGreaterThan(0);
    expect(chromeMocks.storage.local._store.has('farmingAutomationFactsV1')).toBe(false);
    expect(chromeMocks.storage.local._store.has('farmingSessionTransitionReceiptV1')).toBe(false);
  });

  test('clearing extension storage resets the live worker instead of restoring stale state', async () => {
    await dispatchMessage({ type: 'UPDATE_GAMES', payload: [demoGame] });
    await dispatchMessage({ type: 'ADD_TO_QUEUE', payload: { game: demoGame } });
    await dispatchMessage({ type: 'SET_SELECTED_GAME', payload: { game: demoGame } });
    const staleState = getAppStateFromStorage();
    expect(staleState.queue).toHaveLength(1);

    chromeMocks.storage.local._store.clear();
    chromeMocks.storage.session._store.clear();
    chromeMocks.storage.onChanged.trigger({ appState: { oldValue: staleState } }, 'local');
    await sleepTick();
    await sleepTick();

    const resetState = getAppStateFromStorage();
    expect(resetState.queue).toEqual([]);
    expect(resetState.selectedGame).toBeNull();
    expect(resetState.availableGames).toEqual([]);
    expect(resetState.isRunning).toBe(false);
    expect(resetState.dropsPageRefreshInProgress).toBe(false);
    expect(chromeMocks.storage.local._store.get('lastInitializedExtensionVersion')).toBe('4.0.0');
  });
}
