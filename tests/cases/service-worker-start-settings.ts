import { expect, test } from 'bun:test';
import { farmingMessages } from '../../src/shared/farming-messages.ts';
import type { TwitchGame } from '../../src/types/index.ts';
import { demoGame } from '../fixtures/service-worker-games.ts';
import {
  enqueueDirectoryResult,
  enqueueDropsSnapshot,
  setStableDropsSnapshot,
} from '../helpers/service-worker-fetch.ts';
import {
  chromeMocks,
  dispatchMessage,
  getAppStateFromStorage,
  syncTestSession,
  triggerMonitorAlarm,
  waitForAppState,
} from '../helpers/service-worker-harness.ts';

function captureNotifications() {
  const notifications: unknown[] = [];
  chromeMocks.chrome.notifications.create = async (options) => {
    notifications.push(options);
    return 'notification-id';
  };
  return notifications;
}

export function registerStartAndSettingsCases() {
  test('START_FARMING returns an error when no game is provided', async () => {
    const response = await dispatchMessage({ type: 'START_FARMING', payload: {} });

    expect(response).toEqual({ success: false, error: 'No game selected.' });
    expect(getAppStateFromStorage().isRunning).toBe(false);
  });

  test('CHANNEL_POINTS_BONUS_CLAIMED increments and persists channel point stats', async () => {
    const baseline = getAppStateFromStorage().totalChannelPointsClaimed;
    const notifications = captureNotifications();
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

  test('START_FARMING retains authorization while Twitch reward data is temporarily unavailable', async () => {
    await dispatchMessage({ type: 'UPDATE_GAMES', payload: [demoGame] });
    const response = await dispatchMessage({
      type: 'START_FARMING',
      payload: { game: demoGame },
    });

    expect(response).toEqual({ success: true });
    await triggerMonitorAlarm();
    const state = getAppStateFromStorage();
    expect(state.isRunning).toBe(true);
    expect(state.isPaused).toBe(false);
    expect(state.selectedGame?.campaignId).toBe(demoGame.campaignId);
    expect(state.manualQueueAuthorized).toBe(true);
    expect(state.recoveryReason).toBe('twitch-network');
  });

  test('START_FARMING accepts intent while the main flow revalidates stale completion evidence', async () => {
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

    expect(response).toEqual({ success: true });
    await triggerMonitorAlarm();
    const state = getAppStateFromStorage();
    expect(state.isRunning).toBe(true);
    expect(state.activeStreamer).toBeNull();
    expect(state.queue.map((game) => game.campaignId)).toEqual([farmingCompleteGame.campaignId]);
  });

  test('PAUSE_FARMING sets isPaused via chrome.runtime.onMessage.trigger', async () => {
    await dispatchMessage({ type: 'START_FARMING', payload: { game: demoGame } });
    chromeMocks.runtime.onMessage.trigger({ type: 'PAUSE_FARMING' });

    const state = await waitForAppState((next) => next.isPaused === true, 'pause state did not persist');
    expect(state.isPaused).toBe(true);
  });

  test('RESUME_FARMING clears isPaused after pause', async () => {
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'resume-drop', currentMinutes: 10 }]);
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'resume-drop', currentMinutes: 10 }]);
    enqueueDirectoryResult('streamer-current');
    enqueueDirectoryResult('streamer-current');
    await dispatchMessage({ type: 'SET_WATCH_TRANSPORT_MODE', payload: { mode: 'managed-tab' } });
    await dispatchMessage({ type: 'UPDATE_GAMES', payload: [demoGame] });
    await syncTestSession();
    expect(await dispatchMessage({ type: 'START_FARMING', payload: { game: demoGame } })).toEqual({
      success: true,
    });
    await triggerMonitorAlarm();
    await waitForAppState(
      (next) => next.isRunning && next.activeStreamer !== null,
      'running watch did not persist',
    );
    chromeMocks.runtime.onMessage.trigger({ type: 'PAUSE_FARMING' });
    await waitForAppState((next) => next.isPaused === true, 'pause state did not persist');

    chromeMocks.runtime.onMessage.trigger({ type: 'RESUME_FARMING' });
    const resumed = await waitForAppState((next) => next.isPaused === false, 'resume state did not persist');
    expect(resumed.isPaused).toBe(false);
  });

  test('SET_NOTIFICATIONS_ENABLED persists the notification preference and suppresses alerts', async () => {
    const notifications = captureNotifications();

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
    const notifications = captureNotifications();

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
    await dispatchMessage({ type: 'START_FARMING', payload: { game: demoGame } });
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
  test('the main alarm publishes local playback guidance without an external notification', async () => {
    const notifications: unknown[] = [];
    const originalCreate = chromeMocks.chrome.notifications.create;
    const originalSend = chromeMocks.chrome.tabs.sendMessage;
    chromeMocks.chrome.notifications.create = async (...args: unknown[]) => {
      notifications.push(
        args.find((value) => typeof value === 'object' && value !== null && 'title' in value),
      );
      return 'attention-notification';
    };
    chromeMocks.chrome.tabs.sendMessage = async (tabId, message) => {
      if (message.type === 'PREPARE_STREAM_PLAYBACK')
        return { success: true, isPlaybackReady: false, userInteractionRequired: true };
      const result = await originalSend(tabId, message);
      if (
        message.type === 'GET_STREAM_CONTEXT' &&
        result &&
        typeof result === 'object' &&
        'context' in result &&
        result.context &&
        typeof result.context === 'object'
      ) {
        return { ...result, context: { ...result.context, isPlaybackReady: false } };
      }
      return result;
    };
    try {
      setStableDropsSnapshot([{ game: demoGame, dropId: 'gesture-drop', currentMinutes: 10 }]);
      enqueueDirectoryResult('streamer-current');
      chromeMocks.permissions.setContainsResult(true);
      await dispatchMessage({ type: 'SET_NOTIFICATIONS_ENABLED', payload: { enabled: true } });
      await dispatchMessage({ type: 'SET_WATCH_TRANSPORT_MODE', payload: { mode: 'managed-tab' } });
      await dispatchMessage({ type: 'UPDATE_GAMES', payload: [demoGame] });
      await syncTestSession();
      expect(await dispatchMessage({ type: 'START_FARMING', payload: { game: demoGame } })).toEqual({
        success: true,
      });
      expect(notifications).toEqual([]);
      await triggerMonitorAlarm();
      expect(getAppStateFromStorage().watchHealth?.reason).toBe('user-interaction-required');
      expect(farmingMessages(getAppStateFromStorage()).some((message) => message.kind === 'info')).toBe(true);
      expect(notifications).toEqual([]);
    } finally {
      chromeMocks.chrome.notifications.create = originalCreate;
      chromeMocks.chrome.tabs.sendMessage = originalSend;
    }
  });
}
