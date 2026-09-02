import type { TwitchDrop, TwitchGame } from '../types/index.ts';
import { dropStateKey } from './drops-projection.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

export type GamesCacheRefreshResult =
  | {
      readonly kind: 'refreshed';
      readonly games: TwitchGame[];
      readonly authoritativeEmpty?: boolean;
      readonly inventoryVerified?: boolean;
    }
  | { readonly kind: 'cached'; readonly games: TwitchGame[] }
  | { readonly kind: 'unavailable'; readonly games: TwitchGame[] };

const refreshInFlightByState = new WeakMap<ServiceWorkerState, Promise<GamesCacheRefreshResult>>();

export function getGamesCacheRefreshInFlight(
  state: ServiceWorkerState,
): Promise<GamesCacheRefreshResult> | null {
  return refreshInFlightByState.get(state) ?? null;
}

export function setGamesCacheRefreshInFlight(
  state: ServiceWorkerState,
  refresh: Promise<GamesCacheRefreshResult> | null,
): void {
  if (refresh === null) refreshInFlightByState.delete(state);
  else refreshInFlightByState.set(state, refresh);
}

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
  const withoutSummary = { ...game };
  delete withoutSummary.rewardSummary;
  delete withoutSummary.allDropsCompleted;
  return withoutSummary;
}
