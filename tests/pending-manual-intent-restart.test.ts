import { afterEach, beforeEach, expect, test } from 'bun:test';
import { ALARM_NAME } from '../src/background/constants.ts';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerStateLifecycle } from '../src/background/service-worker-state-lifecycle.ts';
import { setTimingSaveDebounceMsForTests } from '../src/background/state-persistence.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import { createFarmingSessionAdapters, createGame } from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

let mocks: ReturnType<typeof setupChromeMocks>;
beforeEach(() => {
  mocks = setupChromeMocks();
  setTimingSaveDebounceMsForTests(0);
});
afterEach(() => {
  setTimingSaveDebounceMsForTests(null);
  mocks.teardown();
});

test.each(['pause', 'stop'] as const)(
  'live update preserves manual %s without scheduling farming',
  async (action) => {
    const state = createServiceWorkerState();
    const game = createGame({ campaignId: 'paused-or-stopped' });
    Object.assign(state.appState, {
      isRunning: action === 'pause',
      isPaused: action === 'pause',
      wasRunning: true,
      lastStopReason: action === 'stop' ? 'user-stop' : null,
      manualQueueAuthorized: action === 'pause',
      farmingSessionOrigin: 'manual',
      selectedGame: game,
      queue: [game],
    });
    const farming = createFarmingSession(state, createFarmingSessionAdapters());
    const lifecycle = createServiceWorkerStateLifecycle(state, { getFarmingSession: () => farming });
    await lifecycle.handleExtensionUpdate();
    expect(state.appState.isRunning).toBe(action === 'pause');
    expect(state.appState.isPaused).toBe(action === 'pause');
    expect(state.appState.lastStopReason).toBe(action === 'stop' ? 'user-stop' : null);
    expect(mocks.alarms._created.some((alarm) => alarm.name === ALARM_NAME)).toBe(false);
  },
);

for (const phase of ['pending', 'recovery'] as const) {
  test.each(['worker', 'browser', 'version-update', 'live-update'] as const)(
    `${phase} manual intent resumes monitoring after %s without campaign sync`,
    async (restart) => {
      const state = createServiceWorkerState();
      const game = createGame({ campaignId: 'requested' });
      Object.assign(state.appState, {
        isRunning: true,
        manualQueueAuthorized: true,
        farmingSessionOrigin: 'manual',
        selectedGame: game,
        queue: [game],
        availableGames: [game],
        forcedCampaignKey: gameKey(game),
        activeStreamer: null,
        tabId: null,
        watchHealth: null,
        recoveryReason: phase === 'recovery' ? 'open-failed' : null,
        recoveryAttempts: phase === 'recovery' ? 4 : null,
        recoveryBackoffUntil: phase === 'recovery' ? Date.now() + 30_000 : null,
        queueEntryMetadataByKey: {
          [gameKey(game)]: {
            source: 'manual',
            reason: 'user-added',
            addedAt: Date.now(),
            ...(phase === 'recovery' ? { streamerRetryAttempts: 4, attemptedStreamerNames: ['failed'] } : {}),
          },
        },
      });
      await mocks.storage.local.set({
        appState: state.appState,
        storageSchemaVersion: 4,
        lastInitializedExtensionVersion:
          restart === 'version-update' ? '4.0.0-beta.1' : mocks.runtime.getManifest().version,
        lastActivityAt: Date.now(),
      });
      if (restart !== 'browser') await mocks.storage.session.set({ farmingBrowserSessionSeen: true });
      const farming = createFarmingSession(state, createFarmingSessionAdapters());
      const lifecycle = createServiceWorkerStateLifecycle(state, { getFarmingSession: () => farming });
      if (restart === 'live-update') await lifecycle.handleExtensionUpdate();
      else await lifecycle.beginInitialization(async () => {});
      expect(state.appState).toMatchObject({
        isRunning: true,
        isPaused: false,
        manualQueueAuthorized: true,
        selectedGame: game,
        forcedCampaignKey: gameKey(game),
        activeStreamer: null,
      });
      expect(mocks.alarms._created.some((alarm) => alarm.name === ALARM_NAME)).toBe(true);
      if (restart === 'version-update' || restart === 'live-update') {
        expect(state.appState.queueEntryMetadataByKey[gameKey(game)]?.attemptedStreamerNames).toBeUndefined();
      }
    },
  );
}
