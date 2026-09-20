import { describe, expect, test } from 'bun:test';
import { refreshGamesCacheFromHiddenFetch } from '../src/background/games-cache-orchestration.ts';
import { applyProgressiveCampaignSnapshot } from '../src/background/games-cache-progressive.ts';
import { removeTerminalSummary } from '../src/background/games-cache-refresh-state.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import type { DropsSnapshot, TwitchGame } from '../src/types/index.ts';
import {
  freshFarmableReward,
  makeGamesCacheDeps,
  selectedCampaign,
} from './fixtures/games-cache-orchestration.ts';

const acquired: TwitchGame = {
  ...selectedCampaign,
  allDropsCompleted: true,
  rewardSummary: { completion: 'all-acquired', remainderReasons: [] },
};
const weaker: DropsSnapshot = {
  games: [selectedCampaign],
  drops: [freshFarmableReward],
  campaignsVerified: true,
  authoritativeCampaignIds: ['terminal-campaign'],
  updatedAt: 2,
};

function stateWithAcquisition() {
  const state = createServiceWorkerState();
  state.appState.availableGames = [acquired];
  state.appState.selectedGame = acquired;
  state.appState.isRunning = true;
  return state;
}

describe('games cache acquired campaign evidence', () => {
  test('hidden authoritative refresh cannot reopen an acquired campaign from weaker progress', async () => {
    const state = stateWithAcquisition();

    const result = await refreshGamesCacheFromHiddenFetch(
      state,
      {},
      makeGamesCacheDeps(weaker, { count: 0 }),
    );

    expect(state.appState.availableGames[0]?.rewardSummary?.completion).toBe('all-acquired');
    expect(state.appState.availableGames[0]?.allDropsCompleted).toBe(true);
    expect(state.appState.acquiredCampaignIds).toContain('terminal-campaign');
    expect(result.games[0]?.rewardSummary?.completion).toBe('all-acquired');
  });

  test('progressive publication preserves acquisition before automation observes the batch', async () => {
    const state = stateWithAcquisition();

    await applyProgressiveCampaignSnapshot(
      state,
      weaker,
      makeGamesCacheDeps(weaker, { count: 0 }),
      () => true,
    );

    expect(state.appState.availableGames[0]?.rewardSummary?.completion).toBe('all-acquired');
    expect(state.appState.acquiredCampaignIds).toContain('terminal-campaign');
  });

  test('progressive publication does not accumulate duplicate campaign rows', async () => {
    const state = createServiceWorkerState();
    const deps = makeGamesCacheDeps(weaker, { count: 0 });

    await applyProgressiveCampaignSnapshot(state, weaker, deps, () => true);
    await applyProgressiveCampaignSnapshot(state, weaker, deps, () => true);
    await applyProgressiveCampaignSnapshot(state, weaker, deps, () => true);

    expect(state.appState.availableGames.map((game) => game.campaignId)).toEqual(['terminal-campaign']);
  });

  test('preserves ledger evidence when acquired campaign returns after an empty directory', async () => {
    const state = stateWithAcquisition();
    const empty: DropsSnapshot = {
      games: [],
      drops: [],
      campaignsVerified: true,
      authoritativeCampaignIds: [],
      updatedAt: 1,
    };
    await refreshGamesCacheFromHiddenFetch(state, {}, makeGamesCacheDeps(empty, { count: 0 }));

    await refreshGamesCacheFromHiddenFetch(state, {}, makeGamesCacheDeps(weaker, { count: 0 }));

    expect(state.appState.availableGames[0]?.rewardSummary?.completion).toBe('all-acquired');
    expect(state.appState.acquiredCampaignIds).toContain('terminal-campaign');
  });

  test('new acquired annotation is remembered before a later weaker refresh', async () => {
    const state = createServiceWorkerState();
    const completed: DropsSnapshot = {
      ...weaker,
      games: [{ ...selectedCampaign, dropCount: 1 }],
      drops: [{ ...freshFarmableReward, claimed: true, progress: 100 }],
      inventoryVerified: true,
    };
    await refreshGamesCacheFromHiddenFetch(state, {}, makeGamesCacheDeps(completed, { count: 0 }));

    expect(state.appState.acquiredCampaignIds).toContain('terminal-campaign');
    await refreshGamesCacheFromHiddenFetch(state, {}, makeGamesCacheDeps(weaker, { count: 0 }));
    expect(state.appState.availableGames[0]?.rewardSummary?.completion).toBe('all-acquired');
  });

  test('summary relaxation keeps acquired truth and only removes farming-complete evidence', () => {
    expect(removeTerminalSummary(acquired)).toEqual(acquired);
    const farmingComplete: TwitchGame = {
      ...selectedCampaign,
      rewardSummary: { completion: 'farming-complete', remainderReasons: ['subscription-required'] },
    };
    expect(removeTerminalSummary(farmingComplete).rewardSummary).toBeUndefined();
  });
});
