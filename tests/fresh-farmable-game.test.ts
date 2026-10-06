import { describe, expect, test } from 'bun:test';
import { normalizeFreshFarmableGame } from '../src/background/service-worker-twitch-gateway.ts';
import type { DropsSnapshot, TwitchDrop, TwitchGame } from '../src/types/index.ts';

const rawGame: TwitchGame = {
  id: 'game-1',
  name: 'Game',
  imageUrl: '',
  campaignId: 'campaign-1',
  categorySlug: 'game',
  dropCount: 1,
};

const watchTimeDrop: TwitchDrop = {
  id: 'drop-1',
  name: 'Reward',
  gameId: rawGame.id,
  gameName: rawGame.name,
  imageUrl: '',
  progress: 0,
  currentMinutes: 0,
  claimed: false,
  campaignId: rawGame.campaignId,
  acquisitionMethod: 'watch-time',
  rewardKind: 'in-game',
  verificationState: 'unassessed',
};

function snapshot(drops: TwitchDrop[]): DropsSnapshot {
  return {
    games: [rawGame],
    drops,
    campaignsVerified: true,
    inventoryVerified: true,
    updatedAt: Date.now(),
  };
}

describe('fresh gateway campaign completion', () => {
  test('derives farmable completion from a fresh raw Twitch game and complete watch-time reward set', () => {
    const result = normalizeFreshFarmableGame(snapshot([watchTimeDrop]), rawGame);

    expect(result?.game.rewardSummary?.completion).toBe('farmable');
  });

  test('rejects fresh games when the reward catalog is missing or incomplete', () => {
    expect(normalizeFreshFarmableGame(snapshot([]), rawGame)).toBeNull();
    expect(
      normalizeFreshFarmableGame(
        { ...snapshot([watchTimeDrop]), games: [{ ...rawGame, dropCount: 2 }] },
        rawGame,
      ),
    ).toBeNull();
  });
});
