import { describe, expect, test } from 'bun:test';
import { refreshGamesCacheFromHiddenFetch } from '../src/background/games-cache-orchestration.ts';
import { normalizeQueueSelection } from '../src/background/queue-operations.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import type { TwitchDrop, TwitchGame } from '../src/types/index.ts';
import {
  freshFarmableReward,
  makeGamesCacheDeps as makeDeps,
  selectedCampaign,
  subscriptionReward,
} from './fixtures/games-cache-orchestration.ts';

describe('refreshGamesCacheFromHiddenFetch running state', () => {
  test('removes a running target after the first complete refresh proves it absent', async () => {
    const state = createServiceWorkerState();
    const activeCampaign: TwitchGame = {
      ...selectedCampaign,
      rewardSummary: { completion: 'farmable', remainderReasons: [] },
    };
    const nextCampaign: TwitchGame = {
      ...selectedCampaign,
      id: 'next-game',
      name: 'Next Game',
      campaignId: 'next-campaign',
      rewardSummary: { completion: 'farmable', remainderReasons: [] },
    };
    state.appState.isRunning = true;
    state.appState.selectedGame = activeCampaign;
    state.appState.availableGames = [activeCampaign, nextCampaign];
    state.appState.queue = [activeCampaign, nextCampaign];
    state.appState.currentDrop = freshFarmableReward;
    state.appState.pendingDrops = [freshFarmableReward];
    state.appState.allDrops = [freshFarmableReward];
    state.cachedDropsSnapshot = [freshFarmableReward];
    const snapshot = { games: [nextCampaign], drops: [], updatedAt: 1 };
    const deps = makeDeps(snapshot, { count: 0 });
    deps.normalizeQueueSelection = normalizeQueueSelection;
    const unavailableCampaigns: TwitchGame[] = [];
    deps.onAuthoritativeCampaignUnavailable = async (game) => {
      unavailableCampaigns.push(game);
      state.appState.queue = state.appState.queue.filter(
        (queuedGame) => queuedGame.campaignId !== game.campaignId,
      );
      state.appState.selectedGame = state.appState.queue[0] ?? null;
    };

    await refreshGamesCacheFromHiddenFetch(state, {}, deps);

    expect(state.appState.isRunning).toBe(true);
    expect(state.appState.queue.map((game) => game.campaignId)).toEqual(['next-campaign']);
    expect(state.appState.selectedGame?.campaignId).toBe('next-campaign');
    expect(unavailableCampaigns.map((game) => game.campaignId)).toEqual(['terminal-campaign']);
  });

  test('marks a present running campaign unavailable when no obtainable watch-time reward remains', async () => {
    const state = createServiceWorkerState();
    const activeCampaign: TwitchGame = {
      ...selectedCampaign,
      rewardSummary: { completion: 'farmable', remainderReasons: [] },
    };
    state.appState.isRunning = true;
    state.appState.selectedGame = activeCampaign;
    state.appState.availableGames = [activeCampaign];
    state.appState.queue = [activeCampaign];
    state.appState.currentDrop = freshFarmableReward;
    state.appState.pendingDrops = [freshFarmableReward];
    state.appState.allDrops = [freshFarmableReward];
    state.cachedDropsSnapshot = [freshFarmableReward];
    const deps = makeDeps(
      { games: [activeCampaign], drops: [subscriptionReward], updatedAt: 1 },
      { count: 0 },
    );
    const unavailableCampaigns: TwitchGame[] = [];
    deps.onAuthoritativeCampaignUnavailable = async (game) => {
      unavailableCampaigns.push(game);
    };

    await refreshGamesCacheFromHiddenFetch(state, {}, deps);

    expect(unavailableCampaigns.map((game) => game.campaignId)).toEqual(['terminal-campaign']);
  });

  test('accepts the first complete empty refresh as authoritative', async () => {
    const state = createServiceWorkerState();
    state.appState.isRunning = true;
    state.appState.selectedGame = selectedCampaign;
    state.appState.availableGames = [selectedCampaign];
    state.appState.queue = [selectedCampaign];
    const deps = makeDeps({ games: [], drops: [], updatedAt: 1 }, { count: 0 });
    const unavailableCampaigns: TwitchGame[] = [];
    deps.onAuthoritativeCampaignUnavailable = async (game) => {
      unavailableCampaigns.push(game);
    };

    const result = await refreshGamesCacheFromHiddenFetch(state, {}, deps);

    expect(result).toEqual({ kind: 'refreshed', games: [], authoritativeEmpty: true });
    expect(unavailableCampaigns.map((game) => game.campaignId)).toEqual(['terminal-campaign']);
    expect(state.appState.availableGames).toEqual([]);
  });

  test('projects a verified favorite batch and requests automation without disrupting the manual queue', async () => {
    const state = createServiceWorkerState();
    const favoriteCampaign: TwitchGame = {
      id: 'favorite-game',
      name: 'Favorite Game',
      imageUrl: '',
      campaignId: 'favorite-campaign',
      dropCount: 1,
    };
    const favoriteDrop: TwitchDrop = {
      ...freshFarmableReward,
      id: 'favorite-drop',
      gameId: favoriteCampaign.id,
      gameName: favoriteCampaign.name,
      campaignId: favoriteCampaign.campaignId,
    };
    state.appState.favoriteGames = [{ gameId: 'favorite-game', lastKnownName: 'Favorite Game', addedAt: 1 }];
    state.appState.queue = [selectedCampaign];
    const clearCalls = { count: 0 };
    const deps = makeDeps(
      {
        games: [selectedCampaign, favoriteCampaign],
        drops: [subscriptionReward, favoriteDrop],
        updatedAt: 2,
      },
      clearCalls,
    );
    let callbackCount = 0;
    let observedQueue: readonly string[] = [];
    deps.fetchDropsSnapshotProgressively = async (options) => {
      expect(options.priorityGameIds).toContain('favorite-game');
      await options.onProgress({ games: [favoriteCampaign], drops: [favoriteDrop], updatedAt: 1 });
      observedQueue = state.appState.queue.map((game) => game.campaignId ?? '');
      return {
        games: [selectedCampaign, favoriteCampaign],
        drops: [subscriptionReward, favoriteDrop],
        updatedAt: 2,
      };
    };
    deps.onProgressiveSnapshotApplied = () => {
      callbackCount += 1;
    };

    await refreshGamesCacheFromHiddenFetch(state, {}, deps);

    expect(observedQueue).toEqual(['terminal-campaign']);
    expect(callbackCount).toBe(1);
    expect(state.appState.campaignDropsByKey['campaign:favorite-campaign']).toHaveLength(1);
  });
});
