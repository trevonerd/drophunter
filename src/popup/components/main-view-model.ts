import {
  dropMatchesGame,
  favoriteGameIdentityKeys,
  gameKey,
  hiddenGameIdentityKeys,
  isSameGameIdentity,
} from '../../shared/game-selection.ts';
import { isRewardWatchable } from '../../shared/reward-semantics.ts';
import type { AppState, TwitchDrop, TwitchGame } from '../../types/index.ts';
import type { CampaignSyncStatus } from '../constants.ts';
import { isCampaignFarmable } from '../format.ts';
import { getGameToStartFromQueue } from '../queue-start.ts';
import { type CampaignProgressSummary, isCampaignQueueEligible } from './campaign-list-model.ts';
import { startupRecovery } from './startup-recovery.ts';

export interface MainViewModelInput {
  readonly state: AppState;
  readonly campaignSyncStatus: CampaignSyncStatus;
  readonly sortedGames: readonly TwitchGame[];
  readonly queueGames: readonly TwitchGame[];
  readonly pendingDrops: readonly TwitchDrop[];
  readonly completedDrops: readonly TwitchDrop[];
  readonly now?: number;
}

export function createMainViewModel({
  state,
  campaignSyncStatus,
  sortedGames,
  queueGames,
  pendingDrops,
  completedDrops,
  now = Date.now(),
}: MainViewModelInput) {
  const campaignCatalogDrops = Object.values(state.campaignDropsByKey ?? {}).flat();
  const catalogDrops =
    campaignCatalogDrops.length > 0
      ? campaignCatalogDrops
      : state.allDrops.length > 0
        ? state.allDrops
        : [...pendingDrops, ...completedDrops];
  const loadedCampaignKeys = new Set(Object.keys(state.campaignDropsByKey ?? {}));
  if (loadedCampaignKeys.size === 0 && state.allDrops.length > 0) {
    for (const game of sortedGames) {
      if (state.allDrops.some((drop) => dropMatchesGame(drop, game))) loadedCampaignKeys.add(gameKey(game));
    }
  }

  const campaignAvailabilityByKey = state.campaignAvailabilityByKey ?? {};
  const campaignProgressByKey = new Map<string, CampaignProgressSummary>();
  for (const game of sortedGames) {
    const nextReward = catalogDrops.find((drop) => dropMatchesGame(drop, game) && isRewardWatchable(drop));
    campaignProgressByKey.set(gameKey(game), {
      nextRewardName: nextReward?.benefitName ?? nextReward?.name,
      progress: nextReward?.progress,
      currentMinutes: nextReward?.currentMinutes,
      requiredMinutes: nextReward?.requiredMinutes,
      eligibleStreamerCount: campaignAvailabilityByKey[gameKey(game)]?.eligibleStreamerCount ?? null,
    });
  }

  const startup = startupRecovery(state, campaignSyncStatus);
  const automationActivity = state.automationActivity ?? [];
  const recentFavoriteAddition = automationActivity.find(
    (entry) => entry.kind === 'favorite-added' && now - entry.at < 5_000,
  );
  const highlightedGame = recentFavoriteAddition?.campaignId
    ? sortedGames.find((game) => game.campaignId === recentFavoriteAddition.campaignId)
    : undefined;
  const gameToStart = getGameToStartFromQueue(state.selectedGame, [...queueGames], state);
  const selectedGame = state.selectedGame;

  return {
    catalogDrops,
    loadedCampaignKeys,
    campaignProgressByKey,
    currentAutomatableDrop:
      state.currentDrop && isRewardWatchable(state.currentDrop) ? state.currentDrop : null,
    startDisabled:
      gameToStart == null ||
      !isCampaignFarmable(gameToStart) ||
      !isCampaignQueueEligible(gameToStart, catalogDrops, loadedCampaignKeys.has(gameKey(gameToStart))),
    startup,
    sessionRequired:
      state.twitchSessionSyncState?.status === 'blocked' ||
      campaignSyncStatus === 'signed-out' ||
      state.campaignSyncState?.status === 'needs-session',
    campaignPriorityMode: state.campaignPriorityMode ?? 'priority-list-only',
    favoriteIds: favoriteGameIdentityKeys(state.favoriteGames ?? []),
    hiddenIds: hiddenGameIdentityKeys(state.hiddenGames ?? []),
    highlightedCampaignKey: highlightedGame ? gameKey(highlightedGame) : null,
    hasVisibleQueue: queueGames.some(
      (game) => !state.isRunning || !state.selectedGame || !isSameGameIdentity(game, state.selectedGame),
    ),
    showSelectedCampaignStatus:
      selectedGame !== null && sortedGames.some((game) => gameKey(game) === gameKey(selectedGame)),
    now,
  };
}
