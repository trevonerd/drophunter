import { afterEach, expect, test } from 'bun:test';
import { createActivationSyncCoordinator } from '../src/background/activation-sync-coordinator.ts';
import { fetchDirectoryStreamersFromApiWrapper } from '../src/background/api-secondary-wrappers.ts';
import { registerExtensionLifecycleListeners } from '../src/background/extension-lifecycle.ts';
import { saveState } from '../src/background/state-persistence.ts';
import { migrateExtensionStorage } from '../src/background/storage-migrations.ts';
import {
  acquireStreamerForSelectedGame,
  openBestStreamerForSelectedGame,
} from '../src/background/streamer-acquisition.ts';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import { createInitialState } from '../src/shared/utils.ts';
import { createSession } from './api-operations-fixtures.ts';
import { createGame, createMinimalState, createStreamer } from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { createLifecycleApi, inactiveAutomation } from './support/extension-lifecycle-fixture.ts';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('successful directory lookup followed by failed playback never becomes a Twitch API outage', async () => {
  const mocks = setupChromeMocks();
  try {
    const state = createMinimalState();
    state.appState.selectedGame = createGame();
    state.appState.isRunning = true;
    let requests = 0;
    globalThis.fetch = async () => {
      requests += 1;
      return Response.json({
        data: {
          game: {
            streams: {
              edges: [
                { node: { broadcaster: { login: 'eligible', displayName: 'Eligible' }, viewersCount: 1 } },
              ],
            },
          },
        },
      });
    };
    await acquireStreamerForSelectedGame(state, {
      onOpenStreamer: () =>
        openBestStreamerForSelectedGame(
          state,
          {
            onFetchDirectoryStreamersFromApi: (game, force, language) =>
              fetchDirectoryStreamersFromApiWrapper(
                state,
                game,
                force ?? false,
                language ?? '',
                {
                  onEnsureTwitchSession: async () => createSession(),
                  onIsLikelyAuthError: () => false,
                  onClearTwitchSessionCache: () => {},
                },
                { logWarn: () => {} },
              ),
            onOpenWatchTransport: async () => false,
            onOpenForegroundChannel: async () => {},
          },
          {
            dropMatchesSelectedGame: () => true,
            isRewardAcquired: () => false,
            getGameDisplayLabel: (game) => game.name,
            resolveCategorySlug: async () => 'test-game',
            pickStreamerForPreferences: (streamers) => ({
              streamer: streamers[0] ?? null,
              activePoolSize: streamers.length,
              preferredLanguageApplied: false,
              preferredLanguageMatches: 0,
            }),
            normalizePreferredStreamerLanguage: () => null,
          },
        ),
    });
    expect(requests).toBe(1);
    expect(state.apiConsecutiveFailures).toBe(0);
    expect(state.apiBackoffUntil).toBe(0);
    expect(state.appState.recoveryReason).not.toBe('twitch-network');
  } finally {
    mocks.teardown();
  }
});

test('due monitoring alarm runs while campaign synchronization is pending', async () => {
  const api = createLifecycleApi();
  const sync = Promise.withResolvers<void>();
  let ticks = 0;
  registerExtensionLifecycleListeners({
    api,
    alarmName: 'dropCheck',
    farmingAutomation: inactiveAutomation,
    getInitPromise: () => null,
    onExtensionUpdate: async () => {},
    onActivationSync: () => sync.promise,
    onAlarm: async () => {
      ticks += 1;
    },
    onManagedTabRemoved: async () => {},
    onManagedTabNavigatedAway: async () => {},
    onMonitorWindowRemoved: async () => {},
    logWarn: () => {},
  });
  api.alarms.onAlarm.trigger({ name: 'dropCheck', scheduledTime: 1, persistAcrossSessions: false });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(ticks).toBe(1);
  sync.resolve();
});

test('farming recovery has its own deadline alarm and does not wait for campaign sync', async () => {
  const mocks = setupChromeMocks();
  try {
    const state = createMinimalState();
    state.appState.isRunning = true;
    state.appState.recoveryReason = 'open-failed';
    state.appState.recoveryBackoffUntil = Date.now() + 30_000;
    await saveState(state);
    expect(mocks.alarms._created.some((alarm) => alarm.name === 'farmingRecoveryRetry')).toBe(true);

    const api = createLifecycleApi();
    const sync = Promise.withResolvers<void>();
    let ticks = 0;
    registerExtensionLifecycleListeners({
      api,
      alarmName: 'dropCheck',
      farmingRecoveryRetryAlarmName: 'farmingRecoveryRetry',
      farmingAutomation: inactiveAutomation,
      getInitPromise: () => null,
      onExtensionUpdate: async () => {},
      onActivationSync: () => sync.promise,
      onAlarm: async () => {
        ticks += 1;
      },
      onManagedTabRemoved: async () => {},
      onManagedTabNavigatedAway: async () => {},
      onMonitorWindowRemoved: async () => {},
      logWarn: () => {},
    });
    api.alarms.onAlarm.trigger({
      name: 'farmingRecoveryRetry',
      scheduledTime: 1,
      persistAcrossSessions: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ticks).toBe(1);
  } finally {
    mocks.teardown();
  }
});

test('failed playback tries another eligible streamer without entering Twitch backoff', async () => {
  const state = createMinimalState();
  state.appState.selectedGame = createGame();
  const tried: string[] = [];
  const started = await acquireStreamerForSelectedGame(state, {
    onOpenStreamer: () =>
      openBestStreamerForSelectedGame(
        state,
        {
          onFetchDirectoryStreamersFromApi: async () =>
            Object.assign([createStreamer({ name: 'first' }), createStreamer({ name: 'second' })], {
              languageFilterApplied: false,
            }),
          onOpenWatchTransport: async (streamer) => {
            tried.push(streamer.name);
            return streamer.name === 'second';
          },
          onOpenForegroundChannel: async () => {},
        },
        {
          dropMatchesSelectedGame: () => true,
          isRewardAcquired: () => false,
          getGameDisplayLabel: (game) => game.name,
          resolveCategorySlug: async () => 'test-game',
          pickStreamerForPreferences: (streamers) => ({
            streamer: streamers[0] ?? null,
            activePoolSize: streamers.length,
            preferredLanguageApplied: false,
            preferredLanguageMatches: 0,
          }),
          normalizePreferredStreamerLanguage: () => null,
        },
      ),
  });
  expect(started).toBe(true);
  expect(tried).toEqual(['first', 'second']);
  expect(state.appState.activeStreamer?.name).toBe('second');
  expect(state.apiConsecutiveFailures).toBe(0);
});

test('three failed playback cycles park the campaign without losing queue authorization', async () => {
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    const state = createMinimalState();
    const game = createGame();
    state.appState.selectedGame = game;
    state.appState.queue = [game];
    state.appState.manualQueueAuthorized = true;
    let skips = 0;
    for (let cycle = 1; cycle <= 3; cycle += 1) {
      await acquireStreamerForSelectedGame(state, {
        onOpenStreamer: async () => {
          throw new (
            await import('../src/background/streamer-selection-flow.ts')
          ).WatchPlaybackUnavailableError(null);
        },
        onSkipCurrentGame: async (reason) => {
          expect(reason).toBe('open-failed');
          skips += 1;
        },
      });
      if (cycle < 3) {
        expect(state.appState.recoveryReason).toBe('open-failed');
        now += 30_000;
      }
    }
    expect(skips).toBe(1);
    expect(state.appState.queue).toEqual([game]);
    expect(state.appState.manualQueueAuthorized).toBe(true);
    expect(state.apiConsecutiveFailures).toBe(0);
  } finally {
    Date.now = originalNow;
  }
});

test.each(['retry-scheduled', 'retry-failed'] as const)(
  'update discards a stale %s campaign block and runs validation',
  async (status) => {
    const mocks = setupChromeMocks();
    try {
      const app = createInitialState();
      app.campaignSyncState = {
        ...app.campaignSyncState,
        status,
        lastErrorKind: 'network',
        retryAttemptCount: 2,
        nextRetryAt: status === 'retry-scheduled' ? Date.now() + 365 * 86_400_000 : null,
        attemptDeadlineAt: null,
        error: 'Old failure',
      } as typeof app.campaignSyncState;
      await mocks.storage.local.set({
        storageSchemaVersion: 3,
        lastInitializedExtensionVersion: '3.99.0.38',
        appState: app,
      });
      await migrateExtensionStorage('3.99.0.43');
      let sync = (mocks.storage.local._store.get('appState') as typeof app).campaignSyncState;
      let attempts = 0;
      const coordinator = createActivationSyncCoordinator({
        getCampaignSyncState: () => sync,
        setCampaignSyncState: (next) => {
          sync = next;
        },
        performSync: async () => {
          attempts += 1;
          return { kind: 'synced', campaignCount: 2 };
        },
        scheduleRetry: async () => {},
      });
      expect((await coordinator.request('extension-update')).kind).toBe('synced');
      expect(attempts).toBe(1);
    } finally {
      mocks.teardown();
    }
  },
);

test('schema migration repairs a stale retry even when the extension version is unchanged', async () => {
  const mocks = setupChromeMocks();
  try {
    const app = createInitialState();
    app.manualQueueAuthorized = true;
    app.queue = [createGame()];
    app.campaignSyncState = {
      ...app.campaignSyncState,
      status: 'retry-failed',
      retryAttemptCount: 4,
      lastErrorKind: 'network',
      nextRetryAt: null,
      attemptDeadlineAt: null,
      error: 'old',
    };
    await mocks.storage.local.set({
      storageSchemaVersion: 3,
      lastInitializedExtensionVersion: '3.99.0.43',
      appState: app,
    });
    await migrateExtensionStorage('3.99.0.43');
    const stored = mocks.storage.local._store.get('appState') as typeof app;
    expect(stored.campaignSyncState.status).toBe('idle');
    expect(stored.manualQueueAuthorized).toBe(true);
    expect(stored.queue).toEqual([createGame()]);
  } finally {
    mocks.teardown();
  }
});

test('same-version load repairs corrupt queue entries and an impossible local retry deadline', () => {
  const game = createGame();
  const state = normalizeStoredAppState({
    isRunning: true,
    queue: [null, { id: '', name: '', imageUrl: '' }, game],
    selectedGame: { id: '', name: '', imageUrl: '' },
    availableGames: [null, game],
    queueEntryMetadataByKey: {
      [gameKey(game)]: {
        source: 'manual',
        reason: 'user-added',
        addedAt: 1,
        streamerRetryAt: Date.now() + 365 * 86_400_000,
        streamerRetryReason: 'open-failed',
        streamerRetryAttempts: 999,
      },
    },
    recoveryReason: 'open-failed',
    recoveryBackoffUntil: Date.now() + 365 * 86_400_000,
    campaignSyncState: {
      status: 'retry-scheduled',
      nextRetryAt: Date.now() + 365 * 86_400_000,
      lastErrorKind: 'network',
      retryAttemptCount: 4,
      error: 'old',
    },
  });
  expect(state.queue).toEqual([game]);
  expect(state.selectedGame).toEqual(game);
  expect(state.availableGames).toEqual([game]);
  expect(state.recoveryBackoffUntil).toBeLessThanOrEqual(Date.now() + 600_000);
  expect(state.campaignSyncState.nextRetryAt).toBeLessThanOrEqual(Date.now() + 600_000);
  expect(state.queueEntryMetadataByKey[gameKey(game)]?.streamerRetryAt).toBeLessThanOrEqual(
    Date.now() + 600_000,
  );
  expect(state.queueEntryMetadataByKey[gameKey(game)]?.streamerRetryAttempts).toBeUndefined();
});
