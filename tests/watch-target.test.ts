import { expect, test } from 'bun:test';
import { dropsForFarmingTarget } from '../src/background/watch-target.ts';
import type { TwitchDrop } from '../src/types/index.ts';

function drop(gameId: string, campaignId?: string): TwitchDrop {
  return {
    id: campaignId ?? gameId,
    name: 'Reward',
    gameId,
    gameName: 'Game',
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

test('inventory progress matches the campaign while heartbeat validates the Twitch category', () => {
  const result = dropsForFarmingTarget(
    [drop('campaign-derived-a', 'campaign-a'), drop('campaign-derived-b', 'campaign-b')],
    {
      gameId: 'twitch-category-id',
      selectionId: 'campaign-derived-a',
      campaignId: 'campaign-a',
      channelName: 'streamer',
    },
  );

  expect(result.map((item) => item.id)).toEqual(['campaign-a']);
});

test('inventory progress falls back to selection identity when campaign id is absent', () => {
  const result = dropsForFarmingTarget([drop('campaign-derived-a'), drop('campaign-derived-b')], {
    gameId: 'twitch-category-id',
    selectionId: 'campaign-derived-b',
    channelName: 'streamer',
  });

  expect(result.map((item) => item.id)).toEqual(['campaign-derived-b']);
});
