import type { TwitchGame } from '../types/index.ts';
import { isExpiredGame } from './utils.ts';

export type CampaignRejectionReason = 'already_completed' | 'not_farmable' | 'expired';

export function isCampaignAcquired(game: TwitchGame): boolean {
  return game.allDropsCompleted === true || game.rewardSummary?.completion === 'all-acquired';
}

export function campaignRejectionReason(game: TwitchGame, now = Date.now()): CampaignRejectionReason | null {
  if (isCampaignAcquired(game)) {
    return 'already_completed';
  }
  if (game.rewardSummary?.completion === 'farming-complete') return 'not_farmable';
  return isExpiredGame(game, now) ? 'expired' : null;
}
