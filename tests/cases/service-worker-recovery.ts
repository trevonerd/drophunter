import { expect, test } from 'bun:test';
import { gameKey } from '../../src/shared/game-selection.ts';
import { demoGame, nextGame, thirdGame } from '../fixtures/service-worker-games.ts';
import {
  enqueueDirectoryResult,
  enqueueDropsSnapshot,
  setStableDropsSnapshot,
} from '../helpers/service-worker-fetch.ts';
import {
  addGameToQueue,
  chromeMocks,
  dispatchMessage,
  sleepTick,
  syncTestSession,
  syncTestSessionWithoutCampaignRefresh,
  triggerInventoryRefreshAlarm,
  triggerMonitorAlarm,
  waitForAppState,
} from '../helpers/service-worker-harness.ts';

async function useManagedWatch() {
  await dispatchMessage({
    type: 'SET_WATCH_TRANSPORT_MODE',
    payload: { mode: 'managed-tab' },
  });
}

async function startCurrentCampaign() {
  const startResponse = await dispatchMessage({
    type: 'START_FARMING',
    payload: { game: demoGame },
  });
  expect(startResponse).toEqual({ success: true });
  await triggerMonitorAlarm();
  await waitForAppState(
    (state) =>
      state.isRunning &&
      state.selectedGame?.campaignId === demoGame.campaignId &&
      state.activeStreamer !== null,
    'start farming did not stabilize on the current game',
  );
}

export function registerRecoveryCases() {
  test('advances queued game when the current campaign becomes terminal mid-farming', async () => {
    await useManagedWatch();
    setStableDropsSnapshot([
      { game: demoGame, dropId: 'drop-current', currentMinutes: 10 },
      { game: nextGame, dropId: 'drop-next', currentMinutes: 5 },
    ]);
    enqueueDirectoryResult('streamer-current');

    await dispatchMessage({ type: 'UPDATE_GAMES', payload: [demoGame, nextGame] });
    await syncTestSessionWithoutCampaignRefresh();
    await addGameToQueue(nextGame);

    await startCurrentCampaign();

    setStableDropsSnapshot([
      {
        game: demoGame,
        dropId: 'drop-current',
        currentMinutes: 10,
        endsAt: new Date(Date.now() - 60_000).toISOString(),
      },
      { game: nextGame, dropId: 'drop-next', currentMinutes: 5 },
    ]);
    enqueueDirectoryResult('streamer-next');
    await dispatchMessage({
      type: 'UPDATE_GAMES',
      payload: [{ ...demoGame, endsAt: new Date(Date.now() - 60_000).toISOString() }, nextGame],
    });
    await triggerInventoryRefreshAlarm();

    const advanced = await waitForAppState(
      (state) => state.selectedGame?.campaignId === nextGame.campaignId,
      'queue did not advance after a verified campaign expiry',
    );

    expect(advanced.queue.map((game) => game.name)).toEqual([nextGame.name]);
  });

  test('advances queued game when the current campaign completes mid-farming', async () => {
    await useManagedWatch();
    setStableDropsSnapshot([
      { game: demoGame, dropId: 'drop-current', currentMinutes: 10 },
      { game: nextGame, dropId: 'drop-next', currentMinutes: 5 },
    ]);
    enqueueDirectoryResult('streamer-current');

    await dispatchMessage({ type: 'UPDATE_GAMES', payload: [demoGame, nextGame] });
    await syncTestSession();
    await addGameToQueue(nextGame);

    await startCurrentCampaign();
    setStableDropsSnapshot([
      { game: demoGame, dropId: 'drop-current', currentMinutes: 60, requiredMinutes: 60, claimed: true },
      { game: nextGame, dropId: 'drop-next', currentMinutes: 5 },
    ]);
    enqueueDirectoryResult('streamer-next');
    await triggerInventoryRefreshAlarm();

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

    await startCurrentCampaign();

    await triggerInventoryRefreshAlarm();

    const state = await waitForAppState(
      (next) => next.selectedGame?.campaignId === demoGame.campaignId,
      'selected game changed unexpectedly during normal farming',
    );

    expect(state.queue.map((game) => game.name)).toEqual([demoGame.name, nextGame.name]);
  });

  test('suspends completed playback while unavailable successors remain authorized', async () => {
    await useManagedWatch();
    setStableDropsSnapshot([
      { game: demoGame, dropId: 'drop-current', currentMinutes: 10 },
      { game: nextGame, dropId: 'drop-next', currentMinutes: 5 },
      { game: thirdGame, dropId: 'drop-third', currentMinutes: 5 },
    ]);
    enqueueDirectoryResult('streamer-current');

    await dispatchMessage({ type: 'UPDATE_GAMES', payload: [demoGame, nextGame, thirdGame] });
    await syncTestSession();
    await addGameToQueue(nextGame);
    await addGameToQueue(thirdGame);

    await startCurrentCampaign();
    setStableDropsSnapshot([
      { game: demoGame, dropId: 'drop-current', currentMinutes: 60, requiredMinutes: 60, claimed: true },
      { game: nextGame, dropId: 'drop-next', currentMinutes: 5 },
      { game: thirdGame, dropId: 'drop-third', currentMinutes: 5 },
    ]);
    enqueueDirectoryResult(null);
    await triggerInventoryRefreshAlarm();

    const state = await waitForAppState(
      (next) => next.queueEntryMetadataByKey[gameKey(nextGame)]?.streamerRetryReason !== undefined,
      'successor verification did not schedule recovery',
    );

    expect(state.isRunning).toBe(true);
    expect(state.activeStreamer).toBeNull();
    expect(state.queue.map((game) => game.name)).toEqual([nextGame.name, thirdGame.name]);
  });

  test('retains the authorized queue when every campaign is temporarily without streamers', async () => {
    await useManagedWatch();
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
      const completeCatalog = [
        { game: demoGame, dropId: 'drop-current', currentMinutes: 0 },
        { game: nextGame, dropId: 'drop-next', currentMinutes: 0 },
      ];
      // Zero-result attempts refresh again, so every staged response must preserve the full catalog.
      for (let read = 0; read < 8; read += 1) enqueueDropsSnapshot(completeCatalog);
      enqueueDirectoryResult(null);
      enqueueDirectoryResult(null);
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
      await triggerMonitorAlarm();
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
          state.queueEntryMetadataByKey[gameKey(nextGame)]?.streamerRetryReason === 'no-streamers' &&
          state.recoveryReason === 'no-streamers',
        'queue did not verify and park the second campaign',
      );
      for (let i = 0; i < 5; i += 1) {
        await sleepTick();
      }

      now += 31_000;
      await triggerMonitorAlarm();
      const finalState = await waitForAppState(
        (state) =>
          state.isRunning &&
          state.queueAcquisitionRound?.nextRoundAt !== null &&
          state.recoveryReason === 'no-streamers',
        'queue did not park both campaigns for later retry',
      );

      expect(finalState.isPaused).toBe(false);
      expect(finalState.activeStreamer).toBeNull();
      expect(finalState.queue.map((game) => game.campaignId).sort()).toEqual(
        [demoGame.campaignId, nextGame.campaignId].sort(),
      );
      expect(finalState.manualQueueAuthorized).toBe(true);
      expect(finalState.recoveryBackoffUntil).toBeGreaterThan(now);
      expect(finalState.recoveryBackoffUntil).toBeLessThanOrEqual(now + 600_000);
      expect(notifications.some((notification) => notification.title === 'Queue completed')).toBe(false);
    } finally {
      Date.now = realDateNow;
      chrome.notifications.create = originalCreateNotification;
    }
  });
}
