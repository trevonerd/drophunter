import type { TwitchDrop, TwitchGame } from '../../src/types';

export function campaign(overrides: Partial<TwitchGame> = {}): TwitchGame {
  return {
    id: 'game-1',
    name: 'Cyberpunk 2077',
    imageUrl: '',
    campaignId: 'campaign-1',
    campaignName: 'Phantom Liberty Rewards',
    endsAt: '2030-08-03T18:00:00.000Z',
    isConnected: true,
    ...overrides,
  };
}

export function reward(overrides: Partial<TwitchDrop> = {}): TwitchDrop {
  return {
    id: 'reward-1',
    name: 'Neon Jacket',
    gameId: 'game-1',
    gameName: 'Cyberpunk 2077',
    campaignId: 'campaign-1',
    imageUrl: '',
    progress: 42,
    currentMinutes: 21,
    claimed: false,
    claimable: false,
    status: 'active',
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
    ...overrides,
  };
}
