import { describe, expect, test } from 'bun:test';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { computeEffectiveStallThreshold } from '../src/background/stream-rotation.ts';
import { evaluateStreamHealth } from '../src/background/streamer-health-evaluation.ts';
import type { TwitchDrop, TwitchGame } from '../src/types/index.ts';

const game: TwitchGame = {
  id: 'game-1',
  name: 'Game',
  imageUrl: '',
  campaignId: 'campaign-1',
  categorySlug: 'game',
};

const drop: TwitchDrop = {
  id: 'drop-1',
  name: 'Reward',
  gameId: game.id,
  gameName: game.name,
  imageUrl: '',
  progress: 20,
  currentMinutes: 48,
  requiredMinutes: 240,
  acquisitionMethod: 'watch-time',
  rewardKind: 'in-game',
  verificationState: 'unassessed',
  claimed: false,
  campaignId: game.campaignId,
};

describe('streamer health evaluation', () => {
  test('Given a long reward with a missing Drops marker When progress is recent Then it keeps the duration-aware stall threshold', async () => {
    const state = createServiceWorkerState();
    state.appState.selectedGame = game;
    state.appState.currentDrop = drop;
    state.lastProgressAdvanceAt = 1_000;
    const now = 1_000 + 4 * 60_000;

    const result = await evaluateStreamHealth(
      state,
      {
        channelName: 'streamer',
        categorySlug: 'game',
        categoryLabel: 'Game',
        streamTitle: 'Playing Game',
        titleContainsDrops: false,
        hasDropsSignal: false,
        isLive: true,
        pageUrl: 'https://www.twitch.tv/streamer',
      },
      computeEffectiveStallThreshold(drop.requiredMinutes),
      now,
      { onResolveCategorySlug: async () => 'game' },
    );

    expect(result.stallThreshold).toBe(14 * 60_000);
    expect(result.health.reason).toBe('drops-inactive');
  });
});
