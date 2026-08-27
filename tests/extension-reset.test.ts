import { describe, expect, test } from 'bun:test';
import {
  applyExtensionDataClearStateTransition,
  applyExtensionUpdateStateTransition,
  createExtensionUpdateAppState,
} from '../src/background/extension-reset.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createInitialState } from '../src/shared/utils.ts';

describe('extension update reset', () => {
  test('preserves lifetime stats, preferences, queue and resume intent while clearing volatile state', () => {
    const reset = createExtensionUpdateAppState({
      ...createInitialState(),
      totalDropsClaimed: 42,
      notificationsEnabled: true,
      watchTransportPreference: 'tabless',
      favoriteGames: [
        { gameId: 'favorite-1', lastKnownName: 'Favorite', addedAt: 1, identityKeys: ['id:favorite-1'] },
      ],
      availableGames: [{ id: 'game-1', name: 'Stale Game', imageUrl: '' }],
      queue: [{ id: 'game-1', name: 'Stale Game', imageUrl: '' }],
      selectedGame: { id: 'game-1', name: 'Stale Game', imageUrl: '' },
      isRunning: true,
      watchTransportMode: 'managed-tab',
      watchFallbackReason: 'legacy fallback',
      tabId: 91,
    });

    expect(reset).toMatchObject({
      totalDropsClaimed: 42,
      notificationsEnabled: true,
      watchTransportPreference: 'tabless',
      availableGames: [],
      queue: [{ id: 'game-1', name: 'Stale Game', imageUrl: '' }],
      selectedGame: { id: 'game-1', name: 'Stale Game', imageUrl: '' },
      isRunning: false,
      wasRunning: true,
      watchFallbackReason: null,
      tabId: null,
    });
    expect(reset.favoriteGames).toHaveLength(1);
  });

  test('wipes in-memory caches, retries, and recovery metadata', () => {
    const state = createServiceWorkerState();
    const appStateReference = state.appState;
    state.cachedDropsSnapshot = [
      {
        id: 'drop-1',
        name: 'Drop',
        gameId: 'game-1',
        gameName: 'Game',
        imageUrl: '',
        progress: 50,
        currentMinutes: 5,
        requiredMinutes: 10,
        claimed: false,
      },
    ];
    state.apiBackoffUntil = 9_999;
    state.dropClaimRetryAtById.set('claim-1', 9_999);
    state.appState.isRunning = true;

    applyExtensionUpdateStateTransition(state);

    expect(state.cachedDropsSnapshot).toEqual([]);
    expect(state.apiBackoffUntil).toBe(0);
    expect(state.dropClaimRetryAtById.size).toBe(0);
    expect(state.appState.isRunning).toBe(false);
    expect(state.appState.wasRunning).toBe(true);
    expect(state.appState).toBe(appStateReference);
  });

  test('removes unknown legacy app-state fields while preserving the live object reference', () => {
    const state = createServiceWorkerState();
    const appStateReference = state.appState;
    const legacyState = state.appState as typeof state.appState & { legacyFallbackTab?: number };
    legacyState.legacyFallbackTab = 91;

    applyExtensionUpdateStateTransition(state);

    expect(state.appState).toBe(appStateReference);
    expect('legacyFallbackTab' in state.appState).toBe(false);

    (state.appState as typeof state.appState & { legacyCampaignCache?: string }).legacyCampaignCache =
      'stale';
    applyExtensionDataClearStateTransition(state);

    expect(state.appState).toBe(appStateReference);
    expect('legacyCampaignCache' in state.appState).toBe(false);
  });
});
