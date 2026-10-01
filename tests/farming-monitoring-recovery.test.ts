import { verifyExpectedDiagnostics } from './support/expected-diagnostics.ts';

// These recovery/failure scenarios must emit only their declared diagnostic text.
verifyExpectedDiagnostics([
  ['[DropHunter] No eligible streamer found for current Drops; scheduling one retry', 2],
  ['[DropHunter] No streamer found for selected game', 2],
]);

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { createFarmingSessionContext } from '../src/background/farming-session-context.ts';
import { createFarmingSessionMonitoring } from '../src/background/farming-session-monitoring.ts';
import { createWatchHealth } from '../src/background/watch-health.ts';
import {
  createDrop,
  createFarmingSessionAdapters,
  createGame,
  createMinimalState,
} from './fixtures/queue-management.ts';
import { type ChromeMocks, setupChromeMocks } from './mocks/chrome.ts';

function runningState() {
  const state = createMinimalState();
  const game = createGame({ campaignId: 'campaign' });
  const drop = createDrop({ campaignId: game.campaignId, requiredMinutes: 120, currentMinutes: 92 });
  state.appState.isRunning = true;
  state.appState.selectedGame = game;
  state.appState.queue = [game];
  state.appState.allDrops = [drop];
  state.appState.pendingDrops = [drop];
  state.appState.currentDrop = drop;
  state.cachedDropsSnapshot = [drop];
  state.lastInventoryRefreshAt = Date.now();
  return state;
}

describe('farming monitoring recovery', () => {
  let chrome: ChromeMocks;
  beforeEach(() => {
    chrome = setupChromeMocks();
  });
  afterEach(() => {
    chrome.teardown();
  });

  for (const status of ['paused', 'stopped', 'busy'] as const) {
    test(`does not tick transport while ${status} during API backoff`, async () => {
      const state = runningState();
      state.apiBackoffUntil = Date.now() + 60_000;
      state.appState.isPaused = status === 'paused';
      state.appState.isRunning = status !== 'stopped';
      state.monitorTickInFlight = status === 'busy';
      state.monitorTickDeadlineAt = Date.now() + 60_000;
      let ticks = 0;
      const health = createWatchHealth('tabless', 'healthy', 'started', Date.now);
      const session = createFarmingSession(
        state,
        createFarmingSessionAdapters({
          watchTransport: {
            start: async () => health,
            tick: async () => {
              ticks += 1;
              return health;
            },
            stop: async () => {},
            setPreference: async () => {},
          },
        }),
      );
      await session.checkDropProgress();
      expect(ticks).toBe(0);
    });
  }

  test('does not resume transport after Stop while manual viewing is being checked', async () => {
    const state = runningState();
    const detection = Promise.withResolvers<void>();
    let ticks = 0;
    const health = createWatchHealth('tabless', 'healthy', 'started', Date.now);
    const session = createFarmingSession(
      state,
      createFarmingSessionAdapters({
        manualWatchController: {
          evaluate: async () => ({ kind: 'inactive' }),
          reconcileTransport: async () => {
            await detection.promise;
            return { kind: 'unchanged' };
          },
        },
        watchTransport: {
          start: async () => health,
          tick: async () => {
            ticks += 1;
            return health;
          },
          stop: async () => {},
          setPreference: async () => {},
        },
      }),
    );
    const tick = session.checkDropProgress();
    state.appState.isRunning = false;
    state.tickGeneration += 1;
    detection.resolve();
    await tick;
    expect(ticks).toBe(0);
  });

  test('reacquires a failed managed transport without skipping the unfinished campaign', async () => {
    const state = runningState();
    const health = createWatchHealth('managed-tab', 'failed', 'managed-tab-unavailable', Date.now, {
      shouldFallback: true,
    });
    let acquisitions = 0;
    let rotations = 0;
    const monitoring = createFarmingSessionMonitoring(
      createFarmingSessionContext(
        state,
        createFarmingSessionAdapters({
          watchTransport: {
            start: async () => health,
            tick: async () => health,
            stop: async () => {},
            setPreference: async () => {},
          },
        }),
      ),
      {
        onRotateStreamerIfInvalid: async () => {},
        onRotateStreamerForTransportFailure: async () => {
          rotations += 1;
        },
        onAcquireStreamerForSelectedGame: async () => {
          acquisitions += 1;
          return true;
        },
        onAdvanceQueueIfCompleted: async () => true,
        onRecoverStalledProgress: async () => ({ kind: 'selection-changed' }),
      },
    );
    await monitoring.checkDropProgress();
    expect(rotations).toBe(1);
    expect(acquisitions).toBe(0);
    expect(state.appState.selectedGame?.campaignId).toBe('campaign');
    expect(state.appState.queue).toHaveLength(1);
  });

  test('replaces rather than reopens the failed managed streamer', async () => {
    const state = runningState();
    const currentStreamer = {
      id: 'streamer-a',
      name: 'streamer-a',
      displayName: 'Streamer A',
      isLive: true,
      viewerCount: 1,
    };
    const replacementStreamer = {
      id: 'streamer-b',
      name: 'streamer-b',
      displayName: 'Streamer B',
      isLive: true,
      viewerCount: 100,
    };
    state.appState.activeStreamer = currentStreamer;
    state.appState.watchTransportMode = 'managed-tab';
    state.appState.tabId = 123;
    chrome.tabs.setTabsGetResult({ id: 123, url: 'https://twitch.tv/streamer-a' });
    const failedHealth = createWatchHealth('managed-tab', 'failed', 'playback-inactive', Date.now, {
      consecutiveFailures: 3,
      shouldFallback: true,
    });
    const healthyHealth = createWatchHealth('managed-tab', 'healthy', 'started', Date.now);
    const starts: string[] = [];
    const session = createFarmingSession(
      state,
      createFarmingSessionAdapters({
        fetchDirectoryStreamersFromApi: async () =>
          Object.assign([currentStreamer, replacementStreamer], { languageFilterApplied: true }),
        fetchStreamContext: async () => ({
          channelName: state.appState.activeStreamer?.name ?? '',
          categorySlug: state.appState.selectedGame?.categorySlug ?? '',
          categoryLabel: state.appState.selectedGame?.name ?? '',
          streamTitle: 'Drops',
          titleContainsDrops: true,
          hasDropsSignal: true,
          isLive: true,
          isPlaybackReady: true,
          pageUrl: `https://twitch.tv/${state.appState.activeStreamer?.name ?? ''}`,
        }),
        watchTransport: {
          start: async (streamer) => {
            starts.push(streamer.name);
            return healthyHealth;
          },
          tick: async () => failedHealth,
          stop: async () => {},
          setPreference: async () => {},
        },
      }),
    );

    await session.checkDropProgress();

    expect(starts).toEqual(['streamer-b']);
    expect(state.appState.activeStreamer?.name).toBe('streamer-b');
    expect(state.appState.lastRotationReason).toBe('open-failed');
  });

  for (const reason of [
    'stream-offline',
    'wrong-channel',
    'wrong-game',
    'drops-inactive',
    'playback-inactive',
    'heartbeat-failed',
    'error',
  ] as const) {
    test(`replaces the Hidden streamer after a confirmed ${reason} heartbeat`, async () => {
      const state = runningState();
      const currentStreamer = {
        id: 'streamer-a',
        name: 'streamer-a',
        displayName: 'Streamer A',
        isLive: true,
      };
      const replacementStreamer = {
        id: 'streamer-b',
        name: 'streamer-b',
        displayName: 'Streamer B',
        isLive: true,
      };
      state.appState.activeStreamer = currentStreamer;
      state.appState.watchTransportMode = 'tabless';
      const failedHealth = createWatchHealth('tabless', 'failed', reason, Date.now, {
        consecutiveFailures: 10,
        shouldFallback: true,
      });
      const healthyHealth = createWatchHealth('tabless', 'healthy', 'started', Date.now);
      const starts: string[] = [];
      const session = createFarmingSession(
        state,
        createFarmingSessionAdapters({
          fetchDirectoryStreamersFromApi: async () =>
            Object.assign([currentStreamer, replacementStreamer], { languageFilterApplied: true }),
          watchTransport: {
            start: async (streamer) => {
              starts.push(streamer.name);
              return healthyHealth;
            },
            tick: async () => failedHealth,
            stop: async () => {},
            setPreference: async () => {},
          },
        }),
      );

      await session.checkDropProgress();

      expect(starts).toEqual(['streamer-b']);
      expect(state.appState.activeStreamer?.name).toBe('streamer-b');
      expect(state.appState.lastRotationReason).toBe(
        reason === 'stream-offline'
          ? 'offline'
          : ['playback-inactive', 'heartbeat-failed', 'error'].includes(reason)
            ? 'open-failed'
            : reason,
      );
    });
  }

  test('reacquires when a restored Hidden session has neither a watcher nor a streamer', async () => {
    const state = runningState();
    state.appState.watchTransportMode = 'tabless';
    state.appState.watchHealth = createWatchHealth('tabless', 'not-started', 'not-started', Date.now);
    let acquisitions = 0;
    const session = createFarmingSession(
      state,
      createFarmingSessionAdapters({
        fetchDirectoryStreamersFromApi: async () => {
          acquisitions += 1;
          return Object.assign([], { languageFilterApplied: true });
        },
      }),
    );
    await session.checkDropProgress();
    expect(acquisitions).toBe(1);
    expect(state.appState.recoveryReason).toBe('no-streamers');
    expect(state.appState.queue).toHaveLength(1);
  });

  for (const backoff of [false, true]) {
    test(`a not-started watcher enters recovery instead of phantom Running (API backoff: ${backoff})`, async () => {
      const state = runningState();
      state.appState.resumedFromCrash = Date.now();
      state.apiBackoffUntil = backoff ? Date.now() + 60_000 : 0;
      const health = createWatchHealth('managed-tab', 'not-started', 'not-started', Date.now);
      let acquisitions = 0;
      let saved = 0;
      const session = createFarmingSession(
        state,
        createFarmingSessionAdapters({
          fetchDirectoryStreamersFromApi: async () => {
            acquisitions += 1;
            return Object.assign([], { languageFilterApplied: true });
          },
          saveState: async () => {
            saved += 1;
          },
          watchTransport: {
            start: async () => health,
            tick: async () => health,
            stop: async () => {},
            setPreference: async () => {},
          },
        }),
      );
      await session.checkDropProgress();
      expect(acquisitions).toBe(backoff ? 0 : 1);
      expect(state.appState.recoveryReason).toBe(backoff ? 'twitch-data-unavailable' : 'no-streamers');
      expect(state.appState.queue).toHaveLength(1);
      expect(state.appState.currentDrop?.currentMinutes).toBe(92);
      expect(saved).toBeGreaterThan(0);
    });
  }
});
