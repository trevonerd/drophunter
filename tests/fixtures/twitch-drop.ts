import type { TwitchDrop } from '../../src/types';

export function createTwitchDrop(overrides: Partial<TwitchDrop> = {}): TwitchDrop {
  return {
    id: 'drop-1',
    name: 'Reward',
    gameId: 'game-1',
    gameName: 'Game',
    imageUrl: '',
    progress: 0,
    currentMinutes: 0,
    claimed: false,
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
    ...overrides,
  };
}
