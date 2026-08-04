import { expect, test } from 'bun:test';
import { projectDropsSnapshot } from '../src/background/drops-projection.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import type { TwitchDrop, TwitchGame } from '../src/types/index.ts';

function game(campaignId: string): TwitchGame {
  return {
    id: `campaign-${campaignId}`,
    name: 'Valorant',
    categoryId: '516575',
    categorySlug: 'valorant',
    campaignId,
    campaignName: `Campaign ${campaignId}`,
    imageUrl: '',
  };
}

function drop(campaignId: string): TwitchDrop {
  return {
    id: `drop-${campaignId}`,
    name: `Reward ${campaignId}`,
    gameId: `campaign-${campaignId}`,
    gameName: 'Valorant',
    campaignId,
    imageUrl: '',
    progress: 0,
    currentMinutes: 0,
    claimed: false,
    claimable: false,
    status: 'pending',
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
  };
}

test('Drops snapshot projection keeps a complete campaign-keyed catalog while selection stays scoped', () => {
  const state = createServiceWorkerState();
  const first = game('one');
  const second = game('two');
  state.appState.selectedGame = first;

  projectDropsSnapshot(
    state,
    {
      games: [first, second],
      drops: [drop('one'), drop('two')],
      updatedAt: 1,
    },
    'campaign-authoritative',
  );

  expect(state.appState.allDrops.map((reward) => reward.id)).toEqual(['drop-one']);
  expect(state.appState.campaignDropsByKey[gameKey(first)]?.map((reward) => reward.id)).toEqual(['drop-one']);
  expect(state.appState.campaignDropsByKey[gameKey(second)]?.map((reward) => reward.id)).toEqual([
    'drop-two',
  ]);
});
