import { expect, test } from 'bun:test';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import { createSession } from './api-operations-fixtures.ts';
import { createFarmingSessionAdapters, createGame } from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

test('preserves authorized queue round through sign-in stop, storage restore and auth resume', async () => {
  // Given: a manually started queue already tried its first campaign before global authentication failed.
  const chrome = setupChromeMocks();
  const first = createGame({ campaignId: 'attempted', categorySlug: 'test-game' });
  const second = createGame({ campaignId: 'selected', categorySlug: 'test-game' });
  const state = createServiceWorkerState();
  state.appState.isRunning = true;
  state.appState.manualQueueAuthorized = true;
  state.appState.farmingSessionOrigin = 'manual';
  state.appState.queue = [first, second];
  state.appState.availableGames = [first, second];
  state.appState.selectedGame = second;
  state.appState.queueAcquisitionRound = { attemptedCampaignKeys: [gameKey(first)], nextRoundAt: null };
  let stored = structuredClone(state.appState);
  const adapters = createFarmingSessionAdapters({
    saveState: async (current) => {
      stored = structuredClone(current.appState);
    },
    ensureTwitchSession: async () => createSession(),
  });
  try {
    // When: sign-in recovery blocks, the service worker restarts, and Twitch authentication returns.
    await createFarmingSession(state, adapters).stop({ stopReason: 'sign-in-required' });
    const restored = createServiceWorkerState();
    restored.appState = normalizeStoredAppState(stored);
    expect(restored.appState.manualQueueAuthorized).toBe(true);
    expect(restored.appState.farmingSessionOrigin).toBe('manual');
    expect(restored.appState.queueAcquisitionRound?.attemptedCampaignKeys).toEqual([gameKey(first)]);
    const resumed = createFarmingSession(restored, adapters);
    await resumed.resumeAfterAuthRecovery();
    // Then: the selected campaign and queue round survive another durable write after resuming.
    const durable = normalizeStoredAppState(stored);
    expect(durable.manualQueueAuthorized).toBe(true);
    expect(durable.farmingSessionOrigin).toBe('manual');
    expect(durable.selectedGame?.campaignId).toBe(second.campaignId);
    expect(durable.queueAcquisitionRound?.attemptedCampaignKeys).toEqual([gameKey(first)]);
    expect(durable.queue.map(gameKey)).toEqual([gameKey(first), gameKey(second)]);
    resumed.stopMonitoring();
  } finally {
    chrome.teardown();
  }
});
