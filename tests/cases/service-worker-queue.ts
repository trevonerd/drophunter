import { expect, test } from 'bun:test';
import type { TwitchGame } from '../../src/types/index.ts';
import { demoGame, nextGame, thirdGame } from '../fixtures/service-worker-games.ts';
import {
  addGameToQueue,
  dispatchMessage,
  getAppStateFromStorage,
} from '../helpers/service-worker-harness.ts';

export function registerQueueCases() {
  test('normalizeGameSelection clears selectedGame when exact campaign no longer exists', async () => {
    const gameWithCampaignA: TwitchGame = {
      id: 'game-a',
      name: 'Game With Campaign A',
      imageUrl: 'https://example.com/game-a.png',
      campaignId: 'campaign-a',
      categorySlug: 'game-a',
    };

    const gameWithCampaignB: TwitchGame = {
      id: 'game-b',
      name: 'Game With Campaign B',
      imageUrl: 'https://example.com/game-b.png',
      campaignId: 'campaign-b',
      categorySlug: 'game-b',
    };

    await dispatchMessage({
      type: 'UPDATE_GAMES',
      payload: [gameWithCampaignA],
    });

    await dispatchMessage({
      type: 'SET_SELECTED_GAME',
      payload: { game: gameWithCampaignA },
    });

    let state = getAppStateFromStorage();
    expect(state.selectedGame?.campaignId).toBe('campaign-a');

    await dispatchMessage({
      type: 'UPDATE_GAMES',
      payload: [gameWithCampaignB],
    });

    state = getAppStateFromStorage();
    expect(state.selectedGame).toBeNull();
  });

  test('normalizeQueueSelection removes queue entries when their campaign vanishes', async () => {
    const gameWithCampaignB: TwitchGame = {
      id: 'game-b',
      name: 'Queued Game B',
      imageUrl: 'https://example.com/game-b.png',
      campaignId: 'campaign-b',
      categorySlug: 'game-b',
    };

    const gameWithCampaignC: TwitchGame = {
      id: 'game-c',
      name: 'Game With Campaign C',
      imageUrl: 'https://example.com/game-c.png',
      campaignId: 'campaign-c',
      categorySlug: 'game-c',
    };

    await dispatchMessage({
      type: 'UPDATE_GAMES',
      payload: [gameWithCampaignB],
    });

    await addGameToQueue(gameWithCampaignB);

    let state = getAppStateFromStorage();
    expect(state.queue).toHaveLength(1);
    expect(state.queue[0].campaignId).toBe('campaign-b');

    // A single snapshot missing the campaign is not enough to prune — guards against a
    // partial/stale post-resume payload wiping the queue on one bad tick.
    await dispatchMessage({
      type: 'UPDATE_GAMES',
      payload: [gameWithCampaignC],
    });

    state = getAppStateFromStorage();
    expect(state.queue).toHaveLength(1);

    // Confirmed missing on a second consecutive snapshot — now it's pruned.
    await dispatchMessage({
      type: 'UPDATE_GAMES',
      payload: [gameWithCampaignC],
    });

    state = getAppStateFromStorage();
    expect(state.queue).toHaveLength(0);
  });

  test('REORDER_QUEUE reorders persisted queue entries when farming is stopped', async () => {
    await dispatchMessage({
      type: 'SET_CAMPAIGN_PRIORITY_MODE',
      payload: { mode: 'priority-list-only' },
    });
    await dispatchMessage({
      type: 'UPDATE_GAMES',
      payload: [demoGame, nextGame, thirdGame],
    });
    await addGameToQueue(demoGame);
    await addGameToQueue(nextGame);
    await addGameToQueue(thirdGame);

    const response = await dispatchMessage({
      type: 'REORDER_QUEUE',
      payload: { fromIndex: 2, toIndex: 0 },
    });

    expect(response).toEqual({ success: true, reordered: true, queueLength: 3 });

    const state = getAppStateFromStorage();
    expect(state.queue.map((game) => game.campaignId)).toEqual([
      'queue-third-campaign',
      'campaign-1',
      'queue-next-campaign',
    ]);
  });

  test('CLEAR_QUEUE removes the idle selection so it cannot reappear before a newly added campaign', async () => {
    // Given
    await dispatchMessage({ type: 'UPDATE_GAMES', payload: [demoGame, nextGame] });
    await dispatchMessage({ type: 'SET_SELECTED_GAME', payload: { game: demoGame } });
    await addGameToQueue(demoGame);

    // When
    await dispatchMessage({ type: 'CLEAR_QUEUE' });
    await addGameToQueue(nextGame);

    // Then
    const state = getAppStateFromStorage();
    expect(state.selectedGame).toBeNull();
    expect(state.queue.map((game) => game.campaignId)).toEqual(['queue-next-campaign']);
  });

  test('normalizeGameSelection does not fuzzy-match when campaign ID is explicit but different', async () => {
    const gameNamedDropsWithCampaignC: TwitchGame = {
      id: 'game-drops-c',
      name: 'Drops Game',
      imageUrl: 'https://example.com/drops-c.png',
      campaignId: 'campaign-c',
      categorySlug: 'drops-game',
    };

    const gameNamedDropsWithCampaignC2: TwitchGame = {
      id: 'game-drops-c2',
      name: 'Drops Game',
      imageUrl: 'https://example.com/drops-c2.png',
      campaignId: 'campaign-c2',
      categorySlug: 'drops-game',
    };

    await dispatchMessage({
      type: 'UPDATE_GAMES',
      payload: [gameNamedDropsWithCampaignC],
    });

    await dispatchMessage({
      type: 'SET_SELECTED_GAME',
      payload: { game: gameNamedDropsWithCampaignC },
    });

    let state = getAppStateFromStorage();
    expect(state.selectedGame?.campaignId).toBe('campaign-c');

    await dispatchMessage({
      type: 'UPDATE_GAMES',
      payload: [gameNamedDropsWithCampaignC2],
    });

    state = getAppStateFromStorage();
    expect(state.selectedGame).toBeNull();
  });
}
