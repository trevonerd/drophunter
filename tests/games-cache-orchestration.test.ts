import { describe, expect, test } from 'bun:test';
import {
  handleEnsureGamesCache,
  refreshGamesCacheFromHiddenFetch,
} from '../src/background/games-cache-orchestration.ts';
import { normalizeQueueSelection } from '../src/background/queue-operations.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import type { TwitchGame } from '../src/types/index.ts';
import {
  farmingCompleteSnapshot,
  freshFarmableReward,
  incompleteTerminalSnapshot,
  makeGamesCacheDeps as makeDeps,
  selectedCampaign,
  subscriptionReward,
  unverifiableReward,
} from './fixtures/games-cache-orchestration.ts';

test.each([null, 'user-stop'] as const)(
  'refresh removes an acquired campaign from an idle unselected queue (stop=%s)',
  async (lastStopReason) => {
    const state = createServiceWorkerState();
    const game = { ...selectedCampaign, dropCount: 1 };
    state.appState.queue = [game];
    state.appState.lastStopReason = lastStopReason;
    state.appState.queueEntryMetadataByKey[gameKey(game)] = {
      source: 'manual',
      addedAt: 1,
      reason: 'user-added',
    };
    const snapshot = {
      games: [game],
      drops: [
        { ...freshFarmableReward, claimed: true, progress: 100, verificationState: 'verified' as const },
      ],
      campaignsVerified: true,
      inventoryVerified: true,
      authoritativeCampaignIds: [game.campaignId ?? ''],
      updatedAt: Date.now(),
    };
    await refreshGamesCacheFromHiddenFetch(
      state,
      { requireFreshSnapshot: true },
      {
        ...makeDeps(snapshot, { count: 0 }),
        normalizeQueueSelection,
      },
    );
    expect(state.appState.queue).toEqual([]);
    expect(state.appState.queueEntryMetadataByKey).toEqual({});
    expect(state.appState.selectedGame).toBeNull();
    expect(state.appState.lastStopReason).toBe(lastStopReason);
    expect(state.appState.isRunning).toBe(false);
  },
);

describe('refreshGamesCacheFromHiddenFetch terminal inspection', () => {
  test('preserves a still-present farming-complete campaign and projected remainder context while idle', async () => {
    // Given: an idle terminal selection with the canonical stop copy and a Twitch-native marker.
    const state = createServiceWorkerState();
    state.appState.selectedGame = selectedCampaign;
    state.appState.availableGames = [selectedCampaign];
    state.appState.lastStopReason = 'farming-complete';
    state.appState.lastStopMessage =
      'All farmable rewards claimed · Subscription required for remaining rewards\nFarming finished · Twitch reward acquisition could not be verified';
    state.unverifiableRewardsByKey['["terminal-campaign","unverifiable-reward"]'] = {
      progress: 99,
      currentMinutes: 59,
      markedAt: 1,
    };
    const clearCalls = { count: 0 };

    // When: the successful hidden campaign refresh reprojects the selected campaign while farming is idle.
    await refreshGamesCacheFromHiddenFetch(state, {}, makeDeps(farmingCompleteSnapshot(), clearCalls));

    // Then: the selected campaign and reason-bearing inspection state survive the refresh.
    expect(state.appState.selectedGame?.campaignId).toBe('terminal-campaign');
    expect(state.appState.selectedGame?.rewardSummary).toEqual({
      completion: 'farming-complete',
      remainderReasons: ['subscription-required', 'unverifiable-twitch'],
    });
    expect(
      state.cachedDropsSnapshot.find((drop) => drop.id === 'unverifiable-reward')?.verificationState,
    ).toBe('unverifiable');
    expect(state.appState.lastStopMessage).toBe(
      'All farmable rewards claimed · Subscription required for remaining rewards\nFarming finished · Twitch reward acquisition could not be verified',
    );
    expect(clearCalls.count).toBe(0);
  });

  test('retains the prior terminal summary, projections, and marker for an incomplete same-campaign refresh', async () => {
    // Given: the selected campaign was terminal on its last complete inspection and its projections are retained.
    const state = createServiceWorkerState();
    const terminalGame = {
      ...selectedCampaign,
      rewardSummary: {
        completion: 'farming-complete' as const,
        remainderReasons: ['subscription-required', 'unverifiable-twitch'] as const,
      },
    };
    state.appState.selectedGame = terminalGame;
    state.appState.availableGames = [terminalGame];
    state.appState.allDrops = [subscriptionReward, unverifiableReward];
    state.appState.pendingDrops = [subscriptionReward, unverifiableReward];
    state.cachedDropsSnapshot = [subscriptionReward, unverifiableReward];
    state.unverifiableRewardsByKey['["terminal-campaign","unverifiable-reward"]'] = {
      progress: 99,
      currentMinutes: 59,
      markedAt: 1,
    };
    const clearCalls = { count: 0 };

    // When: the authoritative refresh still has the campaign but returns only an incomplete reward set.
    await refreshGamesCacheFromHiddenFetch(state, {}, makeDeps(incompleteTerminalSnapshot(), clearCalls));

    // Then: terminal inspection remains visible until a complete or farmable observation supersedes it.
    expect(state.appState.selectedGame?.rewardSummary).toEqual(terminalGame.rewardSummary);
    expect(state.appState.allDrops.map((drop) => drop.id).sort()).toEqual(
      ['subscription-reward', 'unverifiable-reward'].sort(),
    );
    expect(state.appState.pendingDrops.map((drop) => drop.id).sort()).toEqual(
      ['subscription-reward', 'unverifiable-reward'].sort(),
    );
    expect(
      state.cachedDropsSnapshot.find((drop) => drop.id === 'unverifiable-reward')?.verificationState,
    ).toBe('unverifiable');
    expect(state.unverifiableRewardsByKey['["terminal-campaign","unverifiable-reward"]']).toBeDefined();
    expect(clearCalls.count).toBe(0);
  });

  test('lets fresh farmable evidence outrank a stale terminal summary on an incomplete refresh', async () => {
    // Given: the selected campaign has stale farming-complete inspection state.
    const state = createServiceWorkerState();
    const terminalGame = {
      ...selectedCampaign,
      rewardSummary: {
        completion: 'farming-complete' as const,
        remainderReasons: ['subscription-required', 'unverifiable-twitch'] as const,
      },
    };
    state.appState.selectedGame = terminalGame;
    state.appState.availableGames = [terminalGame];
    state.appState.allDrops = [subscriptionReward, unverifiableReward];
    state.appState.pendingDrops = [subscriptionReward, unverifiableReward];
    state.cachedDropsSnapshot = [subscriptionReward, unverifiableReward];
    const clearCalls = { count: 0 };

    // When: the same campaign returns a fresh farmable reward but not its complete reward set.
    await refreshGamesCacheFromHiddenFetch(
      state,
      {},
      makeDeps({ games: [selectedCampaign], drops: [freshFarmableReward], updatedAt: 2 }, clearCalls),
    );

    // Then: the farmable reward is active and no stale terminal summary is retained.
    expect(state.appState.selectedGame?.campaignId).toBe('terminal-campaign');
    expect(state.appState.currentDrop?.id).toBe('fresh-farmable-reward');
    expect(state.appState.selectedGame?.rewardSummary?.completion).not.toBe('farming-complete');
  });

  test('still clears an all-acquired selected campaign after an idle refresh', async () => {
    // Given: an idle selected campaign whose authoritative reward is acquired.
    const state = createServiceWorkerState();
    const acquiredGame = { ...selectedCampaign, dropCount: 1 };
    const acquiredReward = {
      ...subscriptionReward,
      id: 'acquired-reward',
      progress: 100,
      currentMinutes: 60,
      claimed: true,
      acquisitionMethod: 'watch-time' as const,
    };
    state.appState.selectedGame = acquiredGame;
    state.appState.availableGames = [acquiredGame];
    const clearCalls = { count: 0 };

    // When: the successful refresh marks the selected campaign all-acquired.
    await refreshGamesCacheFromHiddenFetch(
      state,
      {},
      makeDeps({ games: [acquiredGame], drops: [acquiredReward], updatedAt: 1 }, clearCalls),
    );

    // Then: ordinary all-acquired clearing remains intact.
    expect(state.appState.selectedGame).toBeNull();
    expect(clearCalls.count).toBe(1);
  });

  test('retains a missing selected campaign during an authoritative refresh', async () => {
    // Given: an idle selected campaign that is absent from the refreshed campaign list.
    const state = createServiceWorkerState();
    state.appState.selectedGame = selectedCampaign;
    state.appState.availableGames = [selectedCampaign];
    const clearCalls = { count: 0 };
    const otherCampaign: TwitchGame = {
      ...selectedCampaign,
      id: 'other-game',
      name: 'Other Game',
      campaignId: 'other-campaign',
    };

    // When: a successful refresh returns only another campaign.
    await refreshGamesCacheFromHiddenFetch(
      state,
      {},
      makeDeps({ games: [otherCampaign], drops: [], updatedAt: 1 }, clearCalls),
    );

    // Absence supplies no acquisition or expiry proof.
    expect(state.appState.selectedGame?.campaignId).toBe(selectedCampaign.campaignId);
    expect(clearCalls.count).toBe(0);
  });

  test('delegates expiry to session progression rather than clearing the target in cache refresh', async () => {
    // Given: an idle selected campaign whose end time is already in the past.
    const state = createServiceWorkerState();
    state.appState.selectedGame = selectedCampaign;
    state.appState.availableGames = [selectedCampaign];
    const clearCalls = { count: 0 };
    const expiredCampaign: TwitchGame = {
      ...selectedCampaign,
      endsAt: new Date(Date.now() - 60_000).toISOString(),
      expiresInMs: 0,
      expiryStatus: 'urgent',
    };

    // When: a successful refresh returns only the expired campaign record.
    await refreshGamesCacheFromHiddenFetch(
      state,
      {},
      makeDeps({ games: [expiredCampaign], drops: [], updatedAt: 1 }, clearCalls),
    );

    // Cache projection retains positive expiry evidence; the session owns the stop.
    expect(state.appState.selectedGame?.campaignId).toBe(selectedCampaign.campaignId);
    expect(state.appState.selectedGame?.endsAt).toBe(expiredCampaign.endsAt);
    expect(clearCalls.count).toBe(0);
  });
});

test('fresh cache reapplies durable markers without deriving completion from cached data', async () => {
  const state = createServiceWorkerState();
  const priorSummary = { completion: 'farmable' as const, remainderReasons: [] };
  state.appState.availableGames = [{ ...selectedCampaign, rewardSummary: priorSummary }];
  state.cachedDropsSnapshot = [unverifiableReward];
  state.unverifiableRewardsByKey['["terminal-campaign","unverifiable-reward"]'] = {
    progress: 99,
    currentMinutes: 59,
    markedAt: 1,
  };
  let saveCalls = 0;

  const result = await handleEnsureGamesCache(state, undefined, {
    awaitInitPromise: async () => undefined,
    trackActivity: async () => undefined,
    ensureStateHydratedForCache: async () => undefined,
    shouldRefreshGamesCache: () => false,
    refreshGamesCacheFromHiddenFetch: async () => [],
    saveState: async () => {
      saveCalls += 1;
    },
  });

  expect(result.refreshed).toBe(false);
  expect(state.cachedDropsSnapshot[0]?.verificationState).toBe('unverifiable');
  expect(state.appState.availableGames[0]?.rewardSummary).toBe(priorSummary);
  expect(saveCalls).toBe(1);
});
