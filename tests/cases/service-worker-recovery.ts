import { expect, test } from 'bun:test';
import { demoGame, nextGame, thirdGame } from '../fixtures/service-worker-games.ts';
import { enqueueDirectoryResult, enqueueDropsSnapshot } from '../helpers/service-worker-fetch.ts';
import {
  addGameToQueue,
  chromeMocks,
  dispatchMessage,
  sleepTick,
  syncTestSession,
  triggerMonitorAlarm,
  waitForAppState,
} from '../helpers/service-worker-harness.ts';

export function registerRecoveryCases() {
  test('advances queued game when the current campaign vanished mid-farming', async () => {
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-current', currentMinutes: 10 }]);
    enqueueDirectoryResult('streamer-current');
    enqueueDropsSnapshot([
      {
        game: demoGame,
        dropId: 'drop-current',
        currentMinutes: 10,
        endsAt: new Date(Date.now() - 60_000).toISOString(),
      },
    ]);
    enqueueDropsSnapshot([{ game: nextGame, dropId: 'drop-next', currentMinutes: 5 }]);
    enqueueDirectoryResult('streamer-next');

    await dispatchMessage({ type: 'UPDATE_GAMES', payload: [demoGame, nextGame] });
    await syncTestSession();
    await addGameToQueue(nextGame);

    const startResponse = await dispatchMessage({
      type: 'START_FARMING',
      payload: { game: demoGame },
    });

    expect(startResponse).toEqual({ success: true });
    await waitForAppState(
      (state) => state.isRunning && state.selectedGame?.campaignId === demoGame.campaignId,
      'start farming did not stabilize on the current game',
    );

    await triggerMonitorAlarm();

    const advanced = await waitForAppState(
      (state) => state.selectedGame?.campaignId === nextGame.campaignId,
      'queue did not advance to the next game after campaign vanished',
    );

    expect(advanced.queue.map((game) => game.name)).toEqual([nextGame.name]);
  });

  test('advances queued game when the current campaign completes mid-farming', async () => {
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-current', currentMinutes: 10 }]);
    enqueueDirectoryResult('streamer-current');
    enqueueDropsSnapshot([
      {
        game: demoGame,
        dropId: 'drop-current',
        currentMinutes: 60,
        requiredMinutes: 60,
      },
    ]);
    enqueueDropsSnapshot([{ game: nextGame, dropId: 'drop-next', currentMinutes: 5 }]);
    enqueueDirectoryResult('streamer-next');

    await dispatchMessage({ type: 'UPDATE_GAMES', payload: [demoGame, nextGame] });
    await syncTestSession();
    await addGameToQueue(nextGame);

    const startResponse = await dispatchMessage({
      type: 'START_FARMING',
      payload: { game: demoGame },
    });

    expect(startResponse).toEqual({ success: true });
    await waitForAppState(
      (state) => state.isRunning && state.selectedGame?.campaignId === demoGame.campaignId,
      'start farming did not stabilize on the current game',
    );

    await triggerMonitorAlarm();

    const advanced = await waitForAppState(
      (state) =>
        state.isRunning &&
        state.selectedGame?.campaignId === nextGame.campaignId &&
        state.activeStreamer?.name === 'streamer-next',
      'queue did not advance to the next game after current campaign completed',
    );

    expect(advanced.queue.map((game) => game.campaignId)).toEqual([nextGame.campaignId]);
    expect(advanced.completedDrops).toEqual([]);
    expect(advanced.pendingDrops[0]?.campaignId).toBe(nextGame.campaignId);
  });

  test('does not advance queue during normal farming when active drops still exist', async () => {
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-current', currentMinutes: 10 }]);
    enqueueDirectoryResult('streamer-current');
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-current', currentMinutes: 10 }]);
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-current', currentMinutes: 20 }]);

    await dispatchMessage({ type: 'UPDATE_GAMES', payload: [demoGame, nextGame] });
    await syncTestSession();
    await addGameToQueue(nextGame);

    const startResponse = await dispatchMessage({
      type: 'START_FARMING',
      payload: { game: demoGame },
    });

    expect(startResponse).toEqual({ success: true });
    await waitForAppState(
      (state) => state.isRunning && state.selectedGame?.campaignId === demoGame.campaignId,
      'start farming did not stabilize on the current game',
    );

    await triggerMonitorAlarm();

    const state = await waitForAppState(
      (next) => next.selectedGame?.campaignId === demoGame.campaignId,
      'selected game changed unexpectedly during normal farming',
    );

    expect(state.queue.map((game) => game.name)).toEqual([demoGame.name, nextGame.name]);
  });

  test('does not skip the next queued game on its first empty load after advancing', async () => {
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-current', currentMinutes: 10 }]);
    enqueueDirectoryResult('streamer-current');
    enqueueDropsSnapshot([
      {
        game: demoGame,
        dropId: 'drop-current',
        currentMinutes: 10,
        endsAt: new Date(Date.now() - 60_000).toISOString(),
      },
    ]);
    enqueueDropsSnapshot([
      {
        game: nextGame,
        dropId: 'drop-next',
        currentMinutes: 5,
        endsAt: new Date(Date.now() - 60_000).toISOString(),
      },
    ]);
    enqueueDirectoryResult(null);

    await dispatchMessage({ type: 'UPDATE_GAMES', payload: [demoGame, nextGame, thirdGame] });
    await syncTestSession();
    await addGameToQueue(nextGame);
    await addGameToQueue(thirdGame);

    const startResponse = await dispatchMessage({
      type: 'START_FARMING',
      payload: { game: demoGame },
    });

    expect(startResponse).toEqual({ success: true });
    await waitForAppState(
      (state) => state.isRunning && state.selectedGame?.campaignId === demoGame.campaignId,
      'start farming did not stabilize on the current game',
    );

    await triggerMonitorAlarm();

    const state = await waitForAppState(
      (next) => next.selectedGame?.campaignId !== demoGame.campaignId,
      'queue did not leave the vanished current campaign',
    );

    expect(state.selectedGame?.campaignId).toBe(nextGame.campaignId);
    expect(state.queue.map((game) => game.name)).toEqual([nextGame.name, thirdGame.name]);
  });

  test('completes the queue when the last queued game has no live streamers after retry', async () => {
    const realDateNow = Date.now;
    let now = realDateNow();
    Date.now = () => now;

    const notifications: Array<{ title: string; message: string }> = [];
    const chrome = chromeMocks.chrome;
    const originalCreateNotification = chrome.notifications.create;
    chrome.notifications.create = async ({ title, message }) => {
      notifications.push({ title, message });
      return 'notification-id';
    };

    try {
      enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-current', currentMinutes: 0 }]);
      enqueueDirectoryResult(null);
      enqueueDirectoryResult(null);
      enqueueDropsSnapshot([{ game: nextGame, dropId: 'drop-next', currentMinutes: 0 }]);
      enqueueDirectoryResult(null);
      enqueueDirectoryResult(null);

      await dispatchMessage({ type: 'UPDATE_GAMES', payload: [demoGame, nextGame] });
      await syncTestSession();
      chromeMocks.permissions.setContainsResult(true);
      await dispatchMessage({
        type: 'SET_NOTIFICATIONS_ENABLED',
        payload: { enabled: true },
      });
      await addGameToQueue(nextGame);

      const startResponse = await dispatchMessage({
        type: 'START_FARMING',
        payload: { game: demoGame },
      });

      expect(startResponse).toEqual({ success: true });
      await waitForAppState(
        (state) =>
          state.isRunning &&
          state.selectedGame?.campaignId === demoGame.campaignId &&
          state.recoveryReason === 'no-streamers',
        'first no-streamers retry was not scheduled',
      );

      now += 61_000;
      await triggerMonitorAlarm();
      await waitForAppState(
        (state) =>
          state.isRunning &&
          state.selectedGame?.campaignId === nextGame.campaignId &&
          state.recoveryReason === 'no-streamers',
        'queue did not advance to the second game and schedule its no-streamers retry',
      );
      for (let i = 0; i < 5; i += 1) {
        await sleepTick();
      }

      now += 61_000;
      await triggerMonitorAlarm();
      const finalState = await waitForAppState(
        (state) => !state.isRunning && state.lastStopReason === 'queue-complete',
        'queue did not complete after the last no-streamers retry failed',
      );

      expect(finalState.isPaused).toBe(false);
      expect(finalState.selectedGame).toBeNull();
      expect(finalState.activeStreamer).toBeNull();
      expect(finalState.tabId).toBeNull();
      expect(finalState.queue).toEqual([]);
      expect(finalState.recoveryReason).toBeNull();
      expect(finalState.recoveryBackoffUntil).toBeNull();
      expect(finalState.recoveryAttempts).toBeNull();
      expect(finalState.lastStopMessage).toContain('Queue completed');
      expect(finalState.lastStopMessage).toContain('No live streamers found');
      expect(notifications.some((notification) => notification.title === 'Queue completed')).toBe(true);
    } finally {
      Date.now = realDateNow;
      chrome.notifications.create = originalCreateNotification;
    }
  });
}
