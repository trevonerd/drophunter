import { describe, expect, test } from 'bun:test';
import { projectDropsSnapshot } from '../src/background/drops-projection.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import {
  blockCampaignForStall,
  clearCampaignStallBlock,
  hasNewEligibleStreamerEvidence,
  isCampaignStallBlocked,
} from '../src/background/stalled-campaign-block.ts';
import { blockSelectedCampaignForStall } from '../src/background/stalled-campaign-blocking.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import type { TwitchDrop, TwitchGame, TwitchStreamer } from '../src/types/index.ts';

const campaign: TwitchGame = {
  id: 'shared-game-id',
  name: 'Campaign A',
  imageUrl: '',
  campaignId: 'campaign-a',
};

const siblingCampaign: TwitchGame = {
  ...campaign,
  name: 'Campaign B',
  campaignId: 'campaign-b',
};

function reward(progress: number, currentMinutes: number): TwitchDrop {
  return {
    id: 'reward-a',
    name: 'Reward',
    gameId: campaign.id,
    gameName: campaign.name,
    imageUrl: '',
    progress,
    currentMinutes,
    requiredMinutes: 60,
    claimed: false,
    campaignId: campaign.campaignId,
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
  };
}

describe('stalled campaign blocks', () => {
  test('Given a stalled campaign When it is blocked Then only that campaign becomes ineligible', () => {
    const blocks = blockCampaignForStall({}, campaign, {
      blockedAt: 1_000,
      rotationAttempts: 3,
      eligibleStreamerNames: ['old-streamer'],
      rewardProgressByKey: {},
    });

    expect(isCampaignStallBlocked(blocks, campaign)).toBe(true);
    expect(isCampaignStallBlocked(blocks, siblingCampaign)).toBe(false);
  });

  test('Given a blocked campaign When fresh streamer evidence clears it Then the campaign becomes eligible', () => {
    const blocked = blockCampaignForStall({}, campaign, {
      blockedAt: 1_000,
      rotationAttempts: 3,
      eligibleStreamerNames: ['old-streamer'],
      rewardProgressByKey: {},
    });

    const blocks = clearCampaignStallBlock(blocked, campaign);

    expect(isCampaignStallBlocked(blocks, campaign)).toBe(false);
  });

  test('Given a blocked campaign When only its known streamer remains Then a refresh does not re-enable it', () => {
    const blocks = blockCampaignForStall({}, campaign, {
      blockedAt: 1_000,
      rotationAttempts: 3,
      eligibleStreamerNames: ['old-streamer'],
      rewardProgressByKey: {},
    });
    const block = blocks['campaign:campaign-a'];

    expect(block).toBeDefined();
    expect(hasNewEligibleStreamerEvidence(block, ['OLD-STREAMER'])).toBe(false);
    expect(hasNewEligibleStreamerEvidence(block, ['old-streamer', 'new-streamer'])).toBe(true);
  });

  test('Given a blocked campaign When cached data appears to advance Then it remains blocked', () => {
    const state = createServiceWorkerState();
    state.appState.selectedGame = campaign;
    state.appState.allDrops = [reward(10, 6)];
    state.appState.pendingDrops = [reward(10, 6)];
    state.appState.currentDrop = reward(10, 6);
    state.lastTrackedDropKey = 'campaign-1:reward-a';
    state.lastTrackedProgress = 10;
    state.lastTrackedMinutes = 6;
    state.appState.stalledCampaignBlocksByKey = blockCampaignForStall({}, campaign, {
      blockedAt: 1_000,
      rotationAttempts: 3,
      eligibleStreamerNames: ['old-streamer'],
      rewardProgressByKey: { 'reward-a::campaign-a': { progress: 10, currentMinutes: 6 } },
    });
    state.appState.queueEntryMetadataByKey['campaign:campaign-a'] = {
      source: 'manual',
      addedAt: 1,
      reason: 'user-added',
      stalledStreamerNames: ['old-streamer'],
    };

    projectDropsSnapshot(state, { games: [campaign], drops: [reward(11, 7)], updatedAt: 2_000 }, 'cached');

    expect(isCampaignStallBlocked(state.appState.stalledCampaignBlocksByKey, campaign)).toBe(true);
    expect(state.appState.queueEntryMetadataByKey['campaign:campaign-a']?.stalledStreamerNames).toEqual([
      'old-streamer',
    ]);
  });

  test('Given a blocked campaign When a fresh inventory update advances progress Then it becomes eligible', () => {
    const state = createServiceWorkerState();
    state.appState.selectedGame = campaign;
    state.appState.allDrops = [reward(10, 6)];
    state.appState.pendingDrops = [reward(10, 6)];
    state.appState.currentDrop = reward(10, 6);
    state.lastTrackedDropKey = 'campaign-1:reward-a';
    state.lastTrackedProgress = 10;
    state.lastTrackedMinutes = 6;
    state.appState.stalledCampaignBlocksByKey = blockCampaignForStall({}, campaign, {
      blockedAt: 1_000,
      rotationAttempts: 3,
      eligibleStreamerNames: ['old-streamer'],
      rewardProgressByKey: { 'reward-a::campaign-a': { progress: 10, currentMinutes: 6 } },
    });
    state.appState.queueEntryMetadataByKey['campaign:campaign-a'] = {
      source: 'manual',
      addedAt: 1,
      reason: 'user-added',
      stalledStreamerNames: ['old-streamer'],
    };

    projectDropsSnapshot(
      state,
      { games: [campaign], drops: [reward(11, 7)], updatedAt: 2_000 },
      'inventory-partial',
    );

    expect(isCampaignStallBlocked(state.appState.stalledCampaignBlocksByKey, campaign)).toBe(false);
    expect(
      state.appState.queueEntryMetadataByKey['campaign:campaign-a']?.stalledStreamerNames,
    ).toBeUndefined();
  });

  test('Given a dormant blocked campaign When fresh inventory progress advances Then it becomes eligible', () => {
    const state = createServiceWorkerState();
    state.appState.selectedGame = siblingCampaign;
    state.appState.stalledCampaignBlocksByKey = blockCampaignForStall({}, campaign, {
      blockedAt: 1_000,
      rotationAttempts: 3,
      eligibleStreamerNames: ['old-streamer'],
      rewardProgressByKey: { 'reward-a::campaign-a': { progress: 10, currentMinutes: 6 } },
    });
    state.appState.queueEntryMetadataByKey['campaign:campaign-a'] = {
      source: 'manual',
      addedAt: 1,
      reason: 'user-added',
      stalledStreamerNames: ['old-streamer'],
    };

    projectDropsSnapshot(
      state,
      { games: [campaign, siblingCampaign], drops: [reward(11, 7)], updatedAt: 2_000 },
      'inventory-partial',
    );

    expect(isCampaignStallBlocked(state.appState.stalledCampaignBlocksByKey, campaign)).toBe(false);
    expect(
      state.appState.queueEntryMetadataByKey['campaign:campaign-a']?.stalledStreamerNames,
    ).toBeUndefined();
  });

  test.each(['stop', 'pause', 'restart', 'selection'] as const)(
    'does not persist or redirect stall handling after %s during directory lookup',
    async (boundary) => {
      const state = createServiceWorkerState();
      state.appState.isRunning = true;
      state.appState.selectedGame = campaign;
      const selectedKey = gameKey(campaign);
      let current = true;
      const isCurrent = () =>
        current &&
        state.appState.isRunning &&
        !state.appState.isPaused &&
        (state.appState.selectedGame ? gameKey(state.appState.selectedGame) : null) === selectedKey;
      let finish: (value: TwitchStreamer[] & { languageFilterApplied: boolean }) => void = () => {};
      const directoryReady = new Promise<TwitchStreamer[] & { languageFilterApplied: boolean }>((resolve) => {
        finish = resolve;
      });
      const pending = blockSelectedCampaignForStall({
        state,
        now: () => 2_000,
        isCurrent,
        fetchDirectoryStreamers: async () => directoryReady,
      });

      if (boundary === 'stop') state.appState.isRunning = false;
      if (boundary === 'pause') state.appState.isPaused = true;
      if (boundary === 'selection') state.appState.selectedGame = siblingCampaign;
      if (boundary === 'restart') current = false;
      finish(Object.assign([], { languageFilterApplied: false }));
      await pending;

      expect(state.appState.stalledCampaignBlocksByKey['campaign:campaign-a']).toBeUndefined();
    },
  );
});
