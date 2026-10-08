import { isCampaignAcquired } from '../shared/campaign-eligibility.ts';
import type { TwitchDrop, TwitchGame } from '../types/index.ts';
import { dropStateKey } from './drops-projection.ts';
import type { TwitchApiFailure } from './twitch-api/errors.ts';

export type GamesCacheRefreshResult =
  | {
      readonly kind: 'refreshed';
      readonly games: TwitchGame[];
      readonly authoritativeEmpty?: boolean;
      readonly inventoryVerified?: boolean;
    }
  | { readonly kind: 'cached'; readonly games: TwitchGame[] }
  | { readonly kind: 'unavailable'; readonly games: TwitchGame[]; readonly failure?: TwitchApiFailure };

export function mergeUniqueDrops(primary: TwitchDrop[], additional: TwitchDrop[]): TwitchDrop[] {
  const merged = primary.slice();
  const keys = new Set(merged.map(dropStateKey));
  for (const drop of additional) {
    const key = dropStateKey(drop);
    if (keys.has(key)) continue;
    keys.add(key);
    merged.push(drop);
  }
  return merged;
}

export function removeTerminalSummary(game: TwitchGame): TwitchGame {
  if (isCampaignAcquired(game) || game.rewardSummary?.completion !== 'farming-complete') return game;
  const withoutSummary = { ...game };
  delete withoutSummary.rewardSummary;
  delete withoutSummary.allDropsCompleted;
  return withoutSummary;
}
