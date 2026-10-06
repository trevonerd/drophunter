import { expect, test } from 'bun:test';
import { dropStateKey, projectDropsSnapshot } from '../src/background/drops-projection.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { blockSelectedCampaignForStall } from '../src/background/stalled-campaign-blocking.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import type { TwitchDrop, TwitchGame } from '../src/types/index.ts';

test('fresh progress during the final directory lookup prevents recreating a stall block', async () => {
  const state = createServiceWorkerState();
  const game: TwitchGame = { id: 'game', campaignId: 'campaign', name: 'Game', imageUrl: '' };
  const drop: TwitchDrop = {
    id: 'drop',
    campaignId: game.campaignId,
    gameId: game.id,
    gameName: game.name,
    name: 'Reward',
    imageUrl: '',
    progress: 10,
    currentMinutes: 1,
    claimed: false,
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
  };
  state.appState.isRunning = true;
  state.appState.selectedGame = game;
  state.appState.availableGames = [game];
  state.appState.queue = [game];
  state.appState.currentDrop = drop;
  state.appState.allDrops = [drop];
  state.cachedDropsSnapshot = [drop];
  state.lastTrackedDropKey = dropStateKey(drop);
  state.lastTrackedProgress = 10;
  state.lastTrackedMinutes = 1;
  state.appState.queueEntryMetadataByKey[gameKey(game)] = {
    source: 'manual',
    addedAt: 1,
    reason: 'user-added',
    stalledStreamerNames: ['a', 'b', 'c', 'd'],
  };
  let finishLookup = () => {};
  const lookup = new Promise<void>((resolve) => {
    finishLookup = resolve;
  });
  const pending = blockSelectedCampaignForStall({
    state,
    now: Date.now,
    isCurrent: () => state.appState.isRunning,
    fetchDirectoryStreamers: async () => {
      await lookup;
      return Object.assign([{ id: 'a', name: 'a', displayName: 'A', isLive: true }], {
        languageFilterApplied: false,
      });
    },
  });

  projectDropsSnapshot(
    state,
    {
      games: [game],
      drops: [{ ...drop, progress: 20, currentMinutes: 2 }],
      updatedAt: Date.now(),
      campaignsVerified: true,
      inventoryVerified: true,
    },
    'campaign-authoritative',
  );
  expect(state.appState.queueEntryMetadataByKey[gameKey(game)]?.stalledStreamerNames).toBeUndefined();
  finishLookup();
  await pending;

  expect(state.appState.stalledCampaignBlocksByKey).toEqual({});
});
