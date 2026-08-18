import { expect, test } from 'bun:test';
import { demoGame } from '../fixtures/service-worker-games.ts';
import { enqueueDropsSnapshot } from '../helpers/service-worker-fetch.ts';
import {
  dispatchMessage,
  getAppStateFromStorage,
  syncTestSession,
} from '../helpers/service-worker-harness.ts';

export function registerCacheSessionCases() {
  test('SYNC_TWITCH_SESSION from a Twitch tab refreshes empty campaign state', async () => {
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-session-sync', currentMinutes: 0 }]);

    const response = await dispatchMessage(
      {
        type: 'SYNC_TWITCH_SESSION',
        payload: {
          session: {
            oauthToken: 'oauth-token-with-valid-length-1234567890',
            userId: '123456',
            deviceId: 'device-12345678',
            uuid: 'uuid-1',
          },
        },
      },
      { tab: { id: 42, url: 'https://www.twitch.tv/drops/campaigns' } },
    );

    expect(response).toEqual({ success: true });
    expect(getAppStateFromStorage().availableGames).toHaveLength(1);
  });

  test('ENSURE_GAMES_CACHE clears an idle selected campaign with only completed drops', async () => {
    const completedGame: TwitchGame = {
      ...demoGame,
      id: 'completed-idle-game',
      name: 'Completed Idle Game',
      campaignId: 'completed-idle-campaign',
      categorySlug: 'completed-idle-game',
    };
    const completedSnapshot = [
      {
        game: completedGame,
        dropId: 'drop-completed-idle',
        currentMinutes: 60,
        requiredMinutes: 60,
      },
    ];

    enqueueDropsSnapshot(completedSnapshot);
    await syncTestSession();
    enqueueDropsSnapshot(completedSnapshot);
    await dispatchMessage({ type: 'UPDATE_GAMES', payload: [completedGame] });
    await dispatchMessage({ type: 'SET_SELECTED_GAME', payload: { game: completedGame } });

    const before = getAppStateFromStorage();
    expect(before.isRunning).toBe(false);
    expect(before.queue).toEqual([]);
    expect(before.selectedGame?.campaignId).toBe(completedGame.campaignId);
    expect(before.pendingDrops).toEqual([]);
    expect(before.completedDrops).toHaveLength(1);
    expect(before.allDrops).toHaveLength(1);

    enqueueDropsSnapshot(completedSnapshot);
    const response = (await dispatchMessage({
      type: 'ENSURE_GAMES_CACHE',
      payload: { force: true },
    })) as { success?: boolean; gamesCount?: number };

    expect(response.success).toBe(true);
    expect(response.gamesCount).toBe(1);

    const after = getAppStateFromStorage();
    expect(after.availableGames).toHaveLength(1);
    expect(after.selectedGame).toBeNull();
    expect(after.currentDrop).toBeNull();
    expect(after.pendingDrops).toEqual([]);
    expect(after.completedDrops).toEqual([]);
    expect(after.allDrops).toEqual([]);
  });

  test('rejects sensitive content-script sync from non-Twitch senders', async () => {
    const before = getAppStateFromStorage().totalChannelPointsClaimed;

    const sessionResponse = await dispatchMessage(
      {
        type: 'SYNC_TWITCH_SESSION',
        payload: {
          session: {
            oauthToken: 'oauth-token-with-valid-length-1234567890',
            userId: '123456',
            deviceId: 'device-12345678',
            uuid: 'uuid-1',
          },
        },
      },
      { tab: { id: 666, url: 'https://example.com/not-twitch' } },
    );
    const integrityResponse = await dispatchMessage(
      { type: 'SYNC_TWITCH_INTEGRITY', payload: { token: 'integrity-token', expiration: 0 } },
      { tab: { id: 666, url: 'https://example.com/not-twitch' } },
    );
    const channelPointsResponse = await dispatchMessage(
      { type: 'CHANNEL_POINTS_BONUS_CLAIMED', payload: { channelName: 'bad-sender' } },
      { tab: { id: 666, url: 'https://example.com/not-twitch' } },
    );

    expect(sessionResponse).toEqual({ success: false, error: 'Untrusted message sender' });
    expect(integrityResponse).toEqual({ success: false, error: 'Untrusted message sender' });
    expect(channelPointsResponse).toEqual({ success: false, error: 'Untrusted message sender' });
    expect(getAppStateFromStorage().totalChannelPointsClaimed).toBe(before);
  });
}
