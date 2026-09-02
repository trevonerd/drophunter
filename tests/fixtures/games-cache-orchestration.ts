import {
  annotateGameCompletion,
  clearSelectedCompletedIdleCampaignExt,
  normalizeGameSelection,
  resetStateForAuthoritativeEmptyCampaignExt,
  splitDropsForSelectedGame,
} from '../../src/background/drops-projection.ts';
import { createServiceWorkerState } from '../../src/background/runtime-state.ts';
import { replaceAvailableGames } from '../../src/shared/game-selection.ts';
import { clearRecoveryStatus, clearTerminalStopStatus } from '../../src/shared/runtime-status.ts';
import type { DropsSnapshot, TwitchDrop, TwitchGame } from '../../src/types/index.ts';

export const selectedCampaign: TwitchGame = {
  id: 'terminal-game',
  name: 'Terminal Game',
  imageUrl: '',
  campaignId: 'terminal-campaign',
  campaignName: 'Terminal Campaign',
  dropCount: 2,
};

export const subscriptionReward: TwitchDrop = {
  id: 'subscription-reward',
  name: 'Subscription Reward',
  gameId: selectedCampaign.id,
  gameName: selectedCampaign.name,
  imageUrl: '',
  campaignId: selectedCampaign.campaignId,
  progress: 0,
  currentMinutes: 0,
  claimed: false,
  acquisitionMethod: 'subscription',
  rewardKind: 'in-game',
  verificationState: 'unassessed',
};

export const unverifiableReward: TwitchDrop = {
  id: 'unverifiable-reward',
  name: 'Twitch Badge',
  gameId: selectedCampaign.id,
  gameName: selectedCampaign.name,
  imageUrl: '',
  campaignId: selectedCampaign.campaignId,
  progress: 99,
  currentMinutes: 59,
  claimed: false,
  acquisitionMethod: 'watch-time',
  rewardKind: 'twitch-badge',
  verificationState: 'unassessed',
};

export const freshFarmableReward: TwitchDrop = {
  ...subscriptionReward,
  id: 'fresh-farmable-reward',
  acquisitionMethod: 'watch-time',
  rewardKind: 'in-game',
  progress: 12,
  currentMinutes: 7,
};

export function makeGamesCacheDeps(snapshot: DropsSnapshot, clearCalls: { count: number }) {
  return {
    fetchDropsSnapshot: async () => snapshot,
    replaceAvailableGames,
    annotateGameCompletion,
    normalizeGameSelection,
    normalizeQueueSelection: (state: ReturnType<typeof createServiceWorkerState>, games: TwitchGame[]) => {
      state.appState.queue = state.appState.queue
        .map((queuedGame) => games.find((game) => game.campaignId === queuedGame.campaignId))
        .filter((game): game is TwitchGame => game !== undefined);
    },
    splitDropsForSelectedGame,
    resetStateForAuthoritativeEmptyCampaign: resetStateForAuthoritativeEmptyCampaignExt,
    clearSelectedCompletedIdleCampaign: (state: ReturnType<typeof createServiceWorkerState>) => {
      clearCalls.count += 1;
      clearSelectedCompletedIdleCampaignExt(state);
    },
    resetStreamTrackingState: () => undefined,
    clearRecoveryStatus,
    clearTerminalStopStatus,
    stopFarmingSession: async () => undefined,
    saveState: async () => undefined,
  };
}

export function farmingCompleteSnapshot(): DropsSnapshot {
  return {
    games: [selectedCampaign],
    drops: [subscriptionReward, unverifiableReward],
    updatedAt: 1,
  };
}

export function incompleteTerminalSnapshot(): DropsSnapshot {
  return {
    games: [selectedCampaign],
    drops: [subscriptionReward],
    updatedAt: 2,
  };
}
