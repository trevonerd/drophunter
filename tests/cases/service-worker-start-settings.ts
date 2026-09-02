import { expect, test } from 'bun:test';
import type { TwitchGame } from '../../src/types/index.ts';
import { demoGame } from '../fixtures/service-worker-games.ts';
import {
  chromeMocks,
  dispatchMessage,
  getAppStateFromStorage,
  waitForAppState,
} from '../helpers/service-worker-harness.ts';

export function registerStartAndSettingsCases() {
  test('START_FARMING returns an error when no game is provided', async () => {
    const response = await dispatchMessage({ type: 'START_FARMING' });

    expect(response).toEqual({ success: false, error: 'No game selected.' });
    expect(getAppStateFromStorage().isRunning).toBe(false);
  });

  test('CHANNEL_POINTS_BONUS_CLAIMED increments and persists channel point stats', async () => {
    const baseline = getAppStateFromStorage().totalChannelPointsClaimed;
    const chrome = chromeMocks.chrome;
    const notifications: unknown[] = [];
    chrome.notifications.create = async (options) => {
      notifications.push(options);
      return 'notification-id';
    };
    chromeMocks.permissions.setContainsResult(true);
    await dispatchMessage({
      type: 'SET_NOTIFICATIONS_ENABLED',
      payload: { enabled: true },
    });

    const response = await dispatchMessage(
      { type: 'CHANNEL_POINTS_BONUS_CLAIMED', payload: { channelName: 'trevonerd' } },
      { tab: { id: 123, url: 'https://www.twitch.tv/trevonerd' } },
    );

    expect(response).toEqual({ success: true });
    expect(getAppStateFromStorage().totalChannelPointsClaimed).toBe(baseline + 1);
    expect(notifications).toContainEqual(
      expect.objectContaining({
        title: 'Channel points claimed',
        message: 'Claimed from trevonerd.',
      }),
    );
  });

  test('START_FARMING exits cleanly when no farmable drops are available', async () => {
    await dispatchMessage({ type: 'UPDATE_GAMES', payload: [demoGame] });
    const response = await dispatchMessage({
      type: 'START_FARMING',
      payload: { game: demoGame },
    });

    expect(response).toEqual({ success: false, error: 'No farmable drops for this game.' });

    const state = getAppStateFromStorage();
    expect(state.isRunning).toBe(false);
    expect(state.isPaused).toBe(false);
    expect(state.selectedGame).toBeNull();
  });

  test('START_FARMING rejects a farming-complete campaign without mutating the queue', async () => {
    const farmingCompleteGame: TwitchGame = {
      ...demoGame,
      id: 'farming-complete-game',
      name: 'Farming Complete Game',
      campaignId: 'farming-complete-campaign',
      dropCount: 1,
      rewardSummary: {
        completion: 'farming-complete',
        remainderReasons: ['unverifiable-twitch'],
      },
    };
    await dispatchMessage({ type: 'UPDATE_GAMES', payload: [farmingCompleteGame] });

    const response = await dispatchMessage({
      type: 'START_FARMING',
      payload: { game: farmingCompleteGame },
    });

    expect(response).toEqual({
      success: false,
      error: 'Farming finished · Twitch reward acquisition could not be verified',
    });
    const state = getAppStateFromStorage();
    expect(state.isRunning).toBe(false);
    expect(state.queue).toEqual([]);
  });

  test('PAUSE_FARMING sets isPaused via chrome.runtime.onMessage.trigger', async () => {
    chromeMocks.runtime.onMessage.trigger({ type: 'PAUSE_FARMING' });

    const state = await waitForAppState((next) => next.isPaused === true, 'pause state did not persist');
    expect(state.isPaused).toBe(true);
  });

  test('RESUME_FARMING clears isPaused after pause', async () => {
    chromeMocks.runtime.onMessage.trigger({ type: 'PAUSE_FARMING' });
    await waitForAppState((next) => next.isPaused === true, 'pause state did not persist');

    chromeMocks.runtime.onMessage.trigger({ type: 'RESUME_FARMING' });
    const resumed = await waitForAppState((next) => next.isPaused === false, 'resume state did not persist');
    expect(resumed.isPaused).toBe(false);
  });

  test('SET_AUTO_RESUME_ON_STARTUP persists the startup resume preference', async () => {
    const enabled = await dispatchMessage({
      type: 'SET_AUTO_RESUME_ON_STARTUP',
      payload: { enabled: true },
    });

    expect(enabled).toEqual({ success: true, autoResumeOnStartup: true });
    expect(getAppStateFromStorage().autoResumeOnStartup).toBe(true);

    const disabled = await dispatchMessage({
      type: 'SET_AUTO_RESUME_ON_STARTUP',
      payload: { enabled: false },
    });

    expect(disabled).toEqual({ success: true, autoResumeOnStartup: false });
    expect(getAppStateFromStorage().autoResumeOnStartup).toBe(false);
  });

  test('SET_NOTIFICATIONS_ENABLED persists the notification preference and suppresses alerts', async () => {
    const chrome = chromeMocks.chrome;
    const notifications: unknown[] = [];
    chrome.notifications.create = async (options) => {
      notifications.push(options);
      return 'notification-id';
    };

    const disabled = await dispatchMessage({
      type: 'SET_NOTIFICATIONS_ENABLED',
      payload: { enabled: false },
    });

    expect(disabled).toEqual({ success: true, notificationsEnabled: false });
    expect(getAppStateFromStorage().notificationsEnabled).toBe(false);

    const response = await dispatchMessage(
      { type: 'CHANNEL_POINTS_BONUS_CLAIMED', payload: { channelName: 'quiet-channel' } },
      { tab: { id: 123, url: 'https://www.twitch.tv/quiet-channel' } },
    );

    expect(response).toEqual({ success: true });
    expect(notifications).toEqual([]);

    const enabled = await dispatchMessage({
      type: 'SET_NOTIFICATIONS_ENABLED',
      payload: { enabled: true },
    });

    expect(enabled).toEqual({
      success: false,
      notificationsEnabled: false,
      error: 'Notification permission was not granted',
    });
    expect(getAppStateFromStorage().notificationsEnabled).toBe(false);
  });

  test('SET_NOTIFICATIONS_ENABLED requires optional notification permission before enabling', async () => {
    chromeMocks.permissions.setContainsResult(true);

    const enabled = await dispatchMessage({
      type: 'SET_NOTIFICATIONS_ENABLED',
      payload: { enabled: true },
    });

    expect(chromeMocks.permissions._requests).toEqual([]);
    expect(enabled).toEqual({ success: true, notificationsEnabled: true });
    expect(getAppStateFromStorage().notificationsEnabled).toBe(true);
  });

  test('SET_AUTO_START_FAVORITES enables and persists notifications after permission is granted', async () => {
    chromeMocks.permissions.setContainsResult(true);

    try {
      const enabled = await dispatchMessage({
        type: 'SET_AUTO_START_FAVORITES',
        payload: { enabled: true },
      });

      expect(enabled).toEqual({
        success: true,
        autoStartFavoriteGames: true,
        error: undefined,
      });
      const state = getAppStateFromStorage();
      expect(state.notificationsEnabled).toBe(true);
      expect(state.autoStartFavoriteGames).toBe(true);
    } finally {
      await dispatchMessage({ type: 'SET_AUTO_START_FAVORITES', payload: { enabled: false } });
      await dispatchMessage({ type: 'SET_NOTIFICATIONS_ENABLED', payload: { enabled: false } });
    }
  });

  test('notification alerts are skipped when optional permission is missing', async () => {
    const chrome = chromeMocks.chrome;
    const notifications: unknown[] = [];
    chrome.notifications.create = async (options) => {
      notifications.push(options);
      return 'notification-id';
    };

    chromeMocks.permissions.setContainsResult(true);
    await dispatchMessage({
      type: 'SET_NOTIFICATIONS_ENABLED',
      payload: { enabled: true },
    });

    chromeMocks.permissions.setContainsResult(false);
    const response = await dispatchMessage(
      { type: 'CHANNEL_POINTS_BONUS_CLAIMED', payload: { channelName: 'missing-permission' } },
      { tab: { id: 123, url: 'https://www.twitch.tv/missing-permission' } },
    );

    expect(response).toEqual({ success: true });
    expect(notifications).toEqual([]);
    expect(getAppStateFromStorage().notificationsEnabled).toBe(false);
  });

  test('STOP_FARMING clears running flags and stores terminal stop metadata', async () => {
    chromeMocks.runtime.onMessage.trigger({ type: 'PAUSE_FARMING' });
    await waitForAppState((next) => next.isPaused === true, 'pause state did not persist');

    chromeMocks.runtime.onMessage.trigger({ type: 'STOP_FARMING' });
    const stopped = await waitForAppState(
      (next) => next.isRunning === false && next.isPaused === false,
      'stop state did not persist',
    );

    expect(stopped.lastStopReason).toBe('user-stop');
    expect(stopped.lastStopMessage).toBe('Stopped by user.');
  });
}
