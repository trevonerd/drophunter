import { expect, test } from 'bun:test';
import { createMainViewModel } from '../src/popup/components/main-view-model.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import { createInitialState } from '../src/shared/utils.ts';
import type { TwitchGame } from '../src/types/index.ts';

const campaign: TwitchGame = {
  id: 'game-1',
  name: 'Game 1',
  imageUrl: '',
  campaignId: 'campaign-1',
  campaignName: 'Campaign 1',
};

test('main view model owns popup campaign, queue, and transient activity projection', () => {
  const cleanupActivity = {
    id: 'queue-cleanup:1',
    kind: 'queue-campaigns-removed' as const,
    at: 900,
    message: 'Removed one expired campaign.',
  };
  const state = {
    ...createInitialState(),
    selectedGame: campaign,
    availableGames: [campaign],
    queue: [campaign],
    favoriteGames: [campaign],
    automationActivity: [
      cleanupActivity,
      {
        id: 'queue-cleanup:older',
        kind: 'queue-campaigns-removed' as const,
        at: 800,
        message: 'Older cleanup.',
      },
      {
        id: 'favorite-added:1',
        kind: 'favorite-added' as const,
        at: 950,
        message: 'Favorite added.',
        campaignId: campaign.campaignId,
      },
    ],
  };

  const model = createMainViewModel({
    state,
    campaignSyncStatus: 'fresh',
    sortedGames: [campaign],
    queueGames: [campaign],
    pendingDrops: [],
    completedDrops: [],
    dismissedQueueCleanupActivityId: null,
    now: 1_000,
  });

  expect(model.startDisabled).toBe(false);
  expect(model.highlightedCampaignKey).toBe(gameKey(campaign));
  expect(model.queueCleanupActivity).toEqual(cleanupActivity);
  expect(model.favoriteIds.size).toBeGreaterThan(0);
  expect(model.loadedCampaignKeys).toEqual(new Set());
  expect(model.campaignProgressByKey.get(gameKey(campaign))).toEqual({
    nextRewardName: undefined,
    progress: undefined,
    currentMinutes: undefined,
    requiredMinutes: undefined,
    eligibleStreamerCount: null,
  });

  const dismissed = createMainViewModel({
    state,
    campaignSyncStatus: 'signed-out',
    sortedGames: [campaign],
    queueGames: [campaign],
    pendingDrops: [],
    completedDrops: [],
    dismissedQueueCleanupActivityId: cleanupActivity.id,
    now: 1_000,
  });
  expect(dismissed.queueCleanupActivity).toBeUndefined();
  expect(dismissed.sessionRequired).toBe(true);
});
