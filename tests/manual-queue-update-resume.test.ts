import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerActivationSync } from '../src/background/service-worker-activation-sync.ts';
import { createServiceWorkerStateLifecycle } from '../src/background/service-worker-state-lifecycle.ts';
import { stopFarmingSession } from '../src/background/session-lifecycle-stop.ts';
import {
  clearPendingTimingStateSaveForTests,
  setTimingSaveDebounceMsForTests,
} from '../src/background/state-persistence.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import { createFarmingSessionAdapters, createGame } from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { createDeferred } from './support/farming-automation-fixtures.ts';

let chrome: ReturnType<typeof setupChromeMocks>;
beforeEach(() => {
  chrome = setupChromeMocks();
  setTimingSaveDebounceMsForTests(0);
});
afterEach(() => {
  clearPendingTimingStateSaveForTests();
  setTimingSaveDebounceMsForTests(null);
  chrome.teardown();
});

for (const legacyToggle of [false, true]) {
  for (const path of ['direct', 'browser'] as const) {
    test.each([
      'running',
      'paused',
      'stopped',
    ] as const)(`extension update respects %s queue, favorites off, legacy ${legacyToggle}, ${path} validation`, async (status) => {
      // Given: a real update lifecycle will stop its transport before restoring previously authorized intent.
      const state = createServiceWorkerState();
      const game = createGame({ campaignId: 'manual-update', endsAt: '2099-01-01T00:00:00Z' });
      Object.assign(state.appState, {
        isRunning: status !== 'stopped',
        isPaused: status === 'paused',
        wasRunning: true,
        lastStopReason: status === 'stopped' ? 'user-stop' : null,
        autoResumeOnStartup: legacyToggle,
        autoStartFavoriteGames: false,
        manualQueueAuthorized: status !== 'stopped',
        farmingSessionOrigin: status !== 'stopped' ? 'manual' : null,
        queue: [game],
        selectedGame: game,
        availableGames: [game],
        queueAcquisitionRound: { attemptedCampaignKeys: ['campaign:earlier'], nextRoundAt: null },
        queueEntryMetadataByKey: { [gameKey(game)]: { source: 'manual', reason: 'user-added', addedAt: 1 } },
      });
      const starts: string[] = [];
      const farming = {
        stop: async () => stopFarmingSession(state, { onSaveTimingState: async () => {} }),
        stopMonitoring: () => {},
        startMonitoring: () => {},
        acquireStreamerForSelectedGame: async () => false,
        advanceQueueIfCompleted: async () => true,
        handleStartFarming: async () => {
          starts.push(state.appState.selectedGame?.campaignId ?? 'missing');
          state.appState.isRunning = true;
          return { success: true };
        },
      };
      const lifecycle = createServiceWorkerStateLifecycle(state, { getFarmingSession: () => farming });
      // When: update reset completes and activation validates the campaign through either supported route.
      await lifecycle.handleExtensionUpdate();
      const activation = createServiceWorkerActivationSync({
        state,
        farmingSession: farming,
        automation: {
          request: async () => ({ kind: 'unchanged', reason: 'disabled' }),
          snooze: async () => 'snoozed',
          suppressCampaignUntilRefresh: async () => 'suppressed',
        },
        refreshGamesCache: async () =>
          path === 'direct'
            ? { kind: 'refreshed', games: [game], inventoryVerified: true }
            : { kind: 'cached', games: [] },
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
      await activation('extension-update', { signal: new AbortController().signal, isCurrent: () => true });
      // Then: only the queue that was actually running is resumed, independent of both settings.
      expect(starts).toEqual(status === 'running' ? [game.campaignId ?? 'missing'] : []);
      expect(state.appState.isPaused).toBe(status === 'paused');
      expect(state.appState.manualQueueAuthorized).toBe(status !== 'stopped');
      expect(state.appState.queue.map(gameKey)).toEqual([gameKey(game)]);
      expect(state.appState.wasRunning).toBe(false);
      if (status !== 'stopped')
        expect(state.appState.queueAcquisitionRound?.attemptedCampaignKeys).toEqual(['campaign:earlier']);
      if (status === 'stopped') expect(state.appState.lastStopReason).toBe('user-stop');
    });
  }
}

test('public Stop supersedes update cleanup and remains durable when its older save finishes last', async () => {
  const state = createServiceWorkerState();
  const game = createGame();
  Object.assign(state.appState, {
    isRunning: true,
    wasRunning: true,
    manualQueueAuthorized: true,
    farmingSessionOrigin: 'manual',
    selectedGame: game,
    queue: [game],
  });
  const entered = createDeferred<void>();
  const release = createDeferred<void>();
  let saves = 0;
  const farming = createFarmingSession(
    state,
    createFarmingSessionAdapters({
      saveState: async (current) => {
        const saved = structuredClone(current.appState);
        if (++saves === 1) {
          entered.resolve();
          await release.promise;
        }
        await chrome.storage.local.set({ appState: saved });
      },
    }),
  );
  const lifecycle = createServiceWorkerStateLifecycle(state, { getFarmingSession: () => farming });
  const updating = lifecycle.handleExtensionUpdate();
  await entered.promise;
  await farming.handleStopFarming();
  release.resolve();
  await updating;
  expect(state.appState.lastStopReason).toBe('user-stop');
  expect(state.appState.wasRunning).toBe(false);
  expect(state.appState.manualQueueAuthorized).toBe(false);
  expect(chrome.storage.local._store.get('appState')).toMatchObject({
    lastStopReason: 'user-stop',
    wasRunning: false,
    manualQueueAuthorized: false,
  });
  farming.stopMonitoring();
});

test('a paused queue stays paused across update and the public Resume restores running intent', async () => {
  const state = createServiceWorkerState();
  const game = createGame();
  Object.assign(state.appState, {
    isRunning: true,
    isPaused: true,
    manualQueueAuthorized: true,
    farmingSessionOrigin: 'manual',
    selectedGame: game,
    queue: [game],
  });
  const farming = createFarmingSession(state, createFarmingSessionAdapters());
  const lifecycle = createServiceWorkerStateLifecycle(state, { getFarmingSession: () => farming });
  await lifecycle.handleExtensionUpdate();
  expect(state.appState.isPaused).toBe(true);
  await farming.handleResumeFarming();
  expect(state.appState.isRunning).toBe(true);
  expect(state.appState.isPaused).toBe(false);
  expect(state.appState.manualQueueAuthorized).toBe(true);
  farming.stopMonitoring();
});
