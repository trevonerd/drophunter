import { browser } from '../shared/browser-api.ts';
import type { TwitchGame } from '../types/index.ts';
import { DROPS_SNAPSHOT_CACHE_KEY } from './constants.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

function withoutAccountEvidence(game: TwitchGame): TwitchGame {
  const {
    allDropsCompleted: _completed,
    rewardSummary: _summary,
    isConnected: _connected,
    ...identity
  } = game;
  return identity;
}

export async function bindCampaignEvidenceAccount(
  state: ServiceWorkerState,
  userId: string | undefined,
): Promise<void> {
  if (!userId) return;
  const previousUserId = state.appState.campaignEvidenceUserId ?? state.twitchSessionCache?.userId;
  if (previousUserId !== userId) {
    state.cachedDropsSnapshot = [];
    state.appState.allDrops = [];
    state.appState.pendingDrops = [];
    state.appState.completedDrops = [];
    state.appState.currentDrop = null;
    state.appState.campaignDropsByKey = {};
    state.appState.acquiredCampaignIds = [];
    state.appState.availableGames = state.appState.availableGames.map(withoutAccountEvidence);
    state.appState.queue = state.appState.queue.map(withoutAccountEvidence);
    if (state.appState.selectedGame) {
      state.appState.selectedGame = withoutAccountEvidence(state.appState.selectedGame);
    }
    state.appState.stalledCampaignBlocksByKey = {};
    state.appState.completionNotified = false;
    state.appState.lastSuccessfulRefreshAt = 0;
    state.cachedCampaignChannelsMap = {};
    state.unverifiableRewardsByKey = {};
    state.dropClaimRetryAtById.clear();
    state.previousAllDropsCount = 0;
    state.lastTrackedProgress = 0;
    state.lastTrackedMinutes = 0;
    state.lastTrackedDropKey = null;
    state.lastFullRefreshAt = 0;
    state.lastInventoryRefreshAt = 0;
    state.lastGamesCacheRefreshAt = 0;
  }
  if (state.appState.campaignEvidenceUserId === userId && previousUserId === userId) return;
  state.appState.campaignEvidenceUserId = userId;
  await browser.storage.local.set({
    appState: state.appState,
    [DROPS_SNAPSHOT_CACHE_KEY]: state.cachedDropsSnapshot,
  });
}
