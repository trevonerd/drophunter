import type { TwitchDrop, TwitchGame, TwitchStreamer } from '../../src/types/index.ts';

export const streamer: TwitchStreamer = {
  id: 'streamer',
  name: 'channel',
  displayName: 'Channel',
  isLive: true,
  viewerCount: 1,
};

export function campaign(campaignId: string, endsAt: string): TwitchGame {
  return {
    id: 'shared-game',
    name: 'Shared Game',
    imageUrl: '',
    campaignId,
    campaignName: campaignId,
    endsAt,
    rewardSummary: { completion: 'farmable', remainderReasons: [] },
  };
}

export function reward(game: TwitchGame): TwitchDrop {
  return {
    id: `drop-${game.campaignId}`,
    name: 'Reward',
    gameId: game.id,
    gameName: game.name,
    imageUrl: '',
    progress: 0,
    currentMinutes: 0,
    claimed: false,
    campaignId: game.campaignId,
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
  };
}
