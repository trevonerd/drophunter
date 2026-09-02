import type { TwitchGame } from '../types/index.ts';
import { reconcileUnverifiableRewardMarkers } from './drops-projection-semantics.ts';
import type { RefreshGamesCacheOptions } from './games-cache-orchestration.ts';
import type { GamesCacheRefreshResult } from './games-cache-refresh-state.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

export interface EnsureGamesCacheDeps {
  awaitInitPromise: () => Promise<void> | null;
  trackActivity: (action: string) => Promise<void>;
  ensureStateHydratedForCache: () => Promise<void>;
  shouldRefreshGamesCache: (state: ServiceWorkerState, force: boolean) => boolean;
  refreshGamesCacheFromHiddenFetch: (
    options: RefreshGamesCacheOptions,
  ) => Promise<GamesCacheRefreshResult | TwitchGame[]>;
  saveState: (state: ServiceWorkerState) => Promise<void>;
}

export async function handleEnsureGamesCache(
  state: ServiceWorkerState,
  payload: { force?: boolean } | undefined,
  deps: EnsureGamesCacheDeps,
) {
  await deps.awaitInitPromise();
  await deps.trackActivity('ensure-games-cache');
  await deps.ensureStateHydratedForCache();
  const force = Boolean(payload?.force);
  const shouldRefresh = deps.shouldRefreshGamesCache(state, force);
  let refreshResult: GamesCacheRefreshResult | null = null;
  if (shouldRefresh) {
    const rawRefreshResult = await deps.refreshGamesCacheFromHiddenFetch({});
    refreshResult = Array.isArray(rawRefreshResult)
      ? { kind: 'cached', games: rawRefreshResult }
      : rawRefreshResult;
  } else if (state.cachedDropsSnapshot.length > 0) {
    state.cachedDropsSnapshot = reconcileUnverifiableRewardMarkers(
      state,
      {
        games: state.appState.availableGames,
        drops: state.cachedDropsSnapshot,
        updatedAt: Date.now(),
      },
      'cached',
    );
    await deps.saveState(state);
  }
  return {
    success: refreshResult?.kind !== 'unavailable',
    refreshed: shouldRefresh,
    gamesCount: state.appState.availableGames.length,
    games: state.appState.availableGames,
    ...(refreshResult?.kind === 'unavailable'
      ? { error: 'Twitch campaign data is temporarily unavailable. Try again.' }
      : {}),
  };
}
