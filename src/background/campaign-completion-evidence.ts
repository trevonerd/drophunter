import { isCampaignAcquired } from '../shared/campaign-eligibility.ts';
import type { AppState, TwitchGame } from '../types/index.ts';

export function rememberAcquiredCampaigns(state: AppState, games: readonly TwitchGame[]): void {
  const acquired = new Set(state.acquiredCampaignIds ?? []);
  for (const game of games) {
    if (game.campaignId && isCampaignAcquired(game)) acquired.add(game.campaignId);
  }
  if (acquired.size > 0) state.acquiredCampaignIds = [...acquired].sort();
}

export function preserveAcquiredCampaigns(state: AppState, games: readonly TwitchGame[]): TwitchGame[] {
  const acquired = new Set(state.acquiredCampaignIds ?? []);
  return games.map((game) =>
    game.campaignId && acquired.has(game.campaignId)
      ? {
          ...game,
          allDropsCompleted: true,
          rewardSummary: { completion: 'all-acquired', remainderReasons: [] },
        }
      : game,
  );
}
