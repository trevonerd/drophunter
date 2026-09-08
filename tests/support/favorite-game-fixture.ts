import type { TwitchGame } from '../../src/types/index.ts';

export function game(
  campaignId: string,
  gameId = 'valorant',
  endsAt = '2030-08-03T14:00:00.000Z',
): TwitchGame {
  return {
    id: gameId,
    name: gameId === 'valorant' ? 'Valorant' : 'Other',
    campaignId,
    campaignName: campaignId,
    endsAt,
    imageUrl: '',
    rewardSummary: { completion: 'farmable', remainderReasons: [] },
  };
}
