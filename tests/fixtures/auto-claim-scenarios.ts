import type { TwitchGame } from '../../src/types/index.ts';

export type SnapshotDropSpec = {
  readonly game: TwitchGame;
  readonly dropId: string;
  readonly claimId?: string;
  readonly currentMinutes?: number;
  readonly requiredMinutes?: number | null;
  readonly endsAt?: string;
  readonly claimed?: boolean;
  readonly claimable?: boolean;
};

export const farmingGame: TwitchGame = {
  id: 'game-farming',
  name: 'Farming Game',
  imageUrl: 'https://example.com/farming.png',
  campaignId: 'campaign-farming',
  categorySlug: 'farming-game',
};

export const crossGameOne: TwitchGame = {
  id: 'game-one',
  name: 'Cross Game One',
  imageUrl: 'https://example.com/game-one.png',
  campaignId: 'campaign-one',
  categorySlug: 'cross-game-one',
};

export const crossGameTwo: TwitchGame = {
  id: 'game-two',
  name: 'Cross Game Two',
  imageUrl: 'https://example.com/game-two.png',
  campaignId: 'campaign-two',
  categorySlug: 'cross-game-two',
};

export const crossGameThree: TwitchGame = {
  id: 'game-three',
  name: 'Cross Game Three',
  imageUrl: 'https://example.com/game-three.png',
  campaignId: 'campaign-three',
  categorySlug: 'cross-game-three',
};

export function createSeedDrop(game: TwitchGame = farmingGame): SnapshotDropSpec {
  return {
    game,
    dropId: `${game.campaignId}-seed-drop`,
    currentMinutes: 10,
    requiredMinutes: 60,
    claimed: false,
    claimable: false,
  };
}

export function createWatchDrop(
  game: TwitchGame,
  dropId: string,
  claimId: string,
  claimed = false,
): SnapshotDropSpec {
  return {
    game,
    dropId,
    claimId,
    currentMinutes: 60,
    requiredMinutes: 60,
    claimed,
    claimable: true,
  };
}
