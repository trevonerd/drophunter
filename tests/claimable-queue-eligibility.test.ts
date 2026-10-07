import { expect, test } from 'bun:test';
import { splitDropsForSelectedGame } from '../src/background/drops-projection.ts';
import { handleAddToQueue } from '../src/background/drops-tick-queue.ts';
import { resolveGameFromState } from '../src/background/queue-operations.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { handleStartFarming } from '../src/background/session-lifecycle-start.ts';
import { isCampaignQueueEligible } from '../src/popup/components/campaign-list-model.ts';
import { getGameToStartFromQueue } from '../src/popup/queue-start.ts';
import { dropMatchesGame, gameKey } from '../src/shared/game-selection.ts';
import { isRewardFarmableNow, isRewardScheduledForFuture } from '../src/shared/reward-scheduling.ts';
import { isRewardWatchable } from '../src/shared/reward-semantics.ts';
import type { TwitchDrop, TwitchGame } from '../src/types';

const game: TwitchGame = { id: 'game', name: 'Game', imageUrl: '', campaignId: 'earned' };
function reward(overrides: Partial<TwitchDrop> = {}): TwitchDrop {
  return {
    id: 'reward',
    gameId: game.id,
    gameName: game.name,
    campaignId: game.campaignId,
    name: 'Reward',
    imageUrl: '',
    progress: 100,
    currentMinutes: 60,
    requiredMinutes: 60,
    claimed: false,
    claimable: true,
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
    ...overrides,
  };
}

test.each([
  reward(),
  reward({ progress: 0 }), // Twitch claimability is stronger evidence than a stale percentage.
  reward({ claimable: false }),
  reward({ rewardKind: 'twitch-badge' }),
  reward({ claimed: true }),
])('earned reward cannot be watched or scheduled: %j', (drop) => {
  expect(isRewardFarmableNow(drop)).toBe(false);
  expect(isRewardScheduledForFuture({ ...drop, startsAt: '2030-01-01T00:00:00Z' })).toBe(false);
  expect(isCampaignQueueEligible(game, [drop], true)).toBe(false);
});

test.each(['catalog', 'cache', 'selected'] as const)(
  'background rejects claim-only Add with a stale farmable summary from %s',
  async (source) => {
    const state = createServiceWorkerState();
    state.appState.availableGames = [
      { ...game, rewardSummary: { completion: 'farmable', remainderReasons: [] } },
    ];
    const drops = [reward()];
    if (source === 'catalog') state.appState.campaignDropsByKey[gameKey(game)] = drops;
    if (source === 'cache') state.cachedDropsSnapshot = drops;
    if (source === 'selected') state.appState.allDrops = drops;
    let saved = false;
    const result = await handleAddToQueue(
      state,
      { game },
      {
        onTrackActivity: async () => {},
        onSaveState: async () => {
          saved = true;
        },
      },
      {
        resolveGameFromState,
        evaluateDropsForGame: (target, all) => ({
          allDrops: all.filter((drop) => dropMatchesGame(drop, target)),
          hasFarmableDrops: false,
        }),
        getGameDisplayLabel: (target) => target.name,
      },
    );
    expect(result).toMatchObject({ success: true, added: false, reason: 'farming-complete' });
    expect(state.appState.queue).toEqual([]);
    expect(saved).toBe(false);
  },
);

test('mixed campaign remains addable, while another campaign for the same game stays independent', async () => {
  const state = createServiceWorkerState();
  state.appState.availableGames = [game];
  const future = reward({ id: 'next', progress: 0, claimable: false, startsAt: '2030-01-01T00:00:00Z' });
  state.appState.campaignDropsByKey[gameKey(game)] = [reward(), future];
  expect(isCampaignQueueEligible(game, [reward(), future], true)).toBe(true);
  expect(isCampaignQueueEligible(game, [reward(), { ...future, campaignId: 'other' }], true)).toBe(false);
  const result = await handleAddToQueue(
    state,
    { game },
    {
      onTrackActivity: async () => {},
      onSaveState: async () => {},
    },
    {
      resolveGameFromState,
      evaluateDropsForGame: () => ({ allDrops: [], hasFarmableDrops: false }),
      getGameDisplayLabel: (target) => target.name,
    },
  );
  expect(result.added).toBe(true);
});

test('Start keeps an earned unclaimed reward authorized for claim retry', async () => {
  const state = createServiceWorkerState();
  state.appState.availableGames = [game];
  state.appState.selectedGame = game;
  state.cachedDropsSnapshot = [reward()];
  splitDropsForSelectedGame(state, state.cachedDropsSnapshot);
  expect(state.appState.currentDrop).toBeNull();
  expect(state.appState.pendingDrops).toHaveLength(1);
  expect(state.appState.completedDrops).toEqual([]);
  const result = await handleStartFarming(state, { game });
  expect(result.success).toBe(true);
  expect(state.appState.isRunning).toBe(true);
  expect(state.appState.manualQueueAuthorized).toBe(true);
  expect(state.appState.queue).toEqual([game]);
});

test('unloaded campaigns stay addable and fresh native/unknown rewards remain watchable', () => {
  expect(isCampaignQueueEligible(game, [], false)).toBe(true);
  expect(isCampaignQueueEligible(game, [], true)).toBe(false);
  for (const rewardKind of ['twitch-badge', 'twitch-emote', 'unknown'] as const) {
    expect(isRewardWatchable(reward({ rewardKind, progress: 0, claimable: false }))).toBe(true);
  }
});

test('idle Start skips an earned queue head even with a stale farmable summary', () => {
  const state = createServiceWorkerState();
  const next = { ...game, campaignId: 'next' };
  state.appState.campaignDropsByKey[gameKey(game)] = [reward()];
  state.appState.campaignDropsByKey[gameKey(next)] = [
    reward({ campaignId: 'next', progress: 0, claimable: false }),
  ];
  expect(getGameToStartFromQueue(game, [game, next], state.appState)).toBe(next);
  expect(getGameToStartFromQueue(game, [], state.appState)).toBeNull();
});
