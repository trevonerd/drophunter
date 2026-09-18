import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { fetchInventorySnapshotFromApi, getLastTwitchApiFailure } from '../src/background/api-operations.ts';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { acquireStreamerForSelectedGame } from '../src/background/streamer-acquisition.ts';
import { createWatchHealth } from '../src/background/watch-health.ts';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';
import { formatRecoveryReason } from '../src/shared/runtime-status.ts';
import { createSession, type FetchMock, installFetchMock, restoreFetch } from './api-operations-fixtures.ts';
import {
  createDrop,
  createFarmingSessionAdapters,
  createGame,
  createMinimalState,
} from './fixtures/queue-management.ts';
import { type ChromeMocks, setupChromeMocks } from './mocks/chrome.ts';

describe('API failure recovery classification', () => {
  let chrome: ChromeMocks;
  let originalFetch: FetchMock | undefined;
  beforeEach(() => {
    chrome = setupChromeMocks();
  });
  afterEach(() => {
    restoreFetch(originalFetch);
    chrome.teardown();
  });

  test('keeps an inventory service error operational while preserving the authenticated session', async () => {
    // Given: Twitch returns a service error for inventory, with a valid cached session.
    const state = createMinimalState();
    const session = createSession();
    state.twitchSessionCache = session;
    state.appState.isRunning = true;
    state.appState.selectedGame = createGame();
    originalFetch = installFetchMock([async () => ({ errors: [{ message: 'service error' }] })]);

    // When: the inventory request fails at the actual GraphQL boundary.
    const result = await fetchInventorySnapshotFromApi(state, session, [createDrop()]);

    // Then: the error schedules an API retry without declaring the session invalid.
    expect(result).toBeNull();
    expect(getLastTwitchApiFailure(state)?.kind).toBe('invalid-response');
    expect(state.twitchSessionCache).toBe(session);
    expect(state.appState.lastStopReason).not.toBe('sign-in-required');
    expect(state.apiBackoffUntil).toBeGreaterThan(Date.now());
  });

  test('preserves generic data recovery through stored state normalization', () => {
    const state = createMinimalState();
    state.appState.recoveryReason = 'twitch-data-unavailable';
    state.appState.recoveryBackoffUntil = Date.now() + 60_000;
    expect(normalizeStoredAppState(state.appState).recoveryReason).toBe('twitch-data-unavailable');
    expect(normalizeStoredAppState(state.appState).recoveryBackoffUntil).toBe(
      state.appState.recoveryBackoffUntil,
    );
  });

  test('does not turn an inventory service error into a streamer outage on the next tick', async () => {
    // Given: authenticated inventory refresh fails, while no watcher is currently available.
    const state = createMinimalState();
    state.appState.isRunning = true;
    state.appState.selectedGame = createGame();
    state.appState.queue = [state.appState.selectedGame];
    originalFetch = installFetchMock([async () => ({ errors: [{ message: 'service error' }] })]);
    await fetchInventorySnapshotFromApi(state, createSession(), [createDrop()]);
    const health = createWatchHealth('tabless', 'not-started', 'not-started', Date.now);
    const farming = createFarmingSession(
      state,
      createFarmingSessionAdapters({
        watchTransport: {
          start: async () => health,
          tick: async () => health,
          stop: async () => {},
          setPreference: async () => {},
        },
      }),
    );

    // When: the monitoring heartbeat observes the API cooldown.
    await farming.checkDropProgress();

    // Then: the visible reason reports unavailable data, with the campaign retained for retry.
    expect(state.appState.recoveryReason).toBe('twitch-data-unavailable');
    expect(state.appState.queue).toHaveLength(1);
    expect(state.appState.isRunning).toBe(true);
  });

  test('labels unavailable Twitch data without claiming a streamer search failed', () => {
    expect(formatRecoveryReason('twitch-data-unavailable')).toBe('Refreshing Twitch campaign data');
  });

  for (const waiting of [false, true]) {
    test(`retries missing playback only after the data recovery deadline (waiting: ${waiting})`, async () => {
      // Given: missing playback was held while Twitch data requests backed off.
      const state = createMinimalState();
      state.appState.selectedGame = createGame();
      state.appState.recoveryReason = 'twitch-data-unavailable';
      state.recoveryBackoffUntil = waiting ? Date.now() + 60_000 : 0;
      let opened = 0;

      // When: acquisition is evaluated.
      await acquireStreamerForSelectedGame(state, {
        onOpenStreamer: async () => {
          opened += 1;
          return true;
        },
      });

      // Then: playback resumes after the deadline and clears its temporary status.
      expect(opened).toBe(waiting ? 0 : 1);
      expect(state.appState.recoveryReason).toBe(waiting ? 'twitch-data-unavailable' : null);
    });
  }
});
