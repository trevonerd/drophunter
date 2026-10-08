import { isCampaignAcquired } from '../shared/campaign-eligibility.ts';
import { dropMatchesGame, gameKey } from '../shared/game-selection.ts';
import { isRewardAcquired } from '../shared/reward-semantics.ts';
import { isExpiredGame } from '../shared/utils.ts';
import type { TwitchGame } from '../types/index.ts';
import { hasCompleteIdentifiedRewardSet } from './campaign-reward-identity.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { hasCompletedCampaignWatchTime } from './session-lifecycle-completion.ts';

export function reconcileFarmingSessionTargets(state: ServiceWorkerState): void {
  const app = state.appState;
  for (const game of [...app.queue, ...(app.selectedGame ? [app.selectedGame] : [])]) {
    const key = gameKey(game);
    if (
      !app.manualQueueAuthorized &&
      app.farmingSessionOrigin === 'automatic' &&
      app.queueEntryMetadataByKey[key]?.source !== 'favorite-auto' &&
      (!app.selectedGame || gameKey(app.selectedGame) !== key)
    )
      continue;
    const previous = app.farmingSessionTargets[key];
    app.farmingSessionTargets[key] = {
      game: {
        ...game,
        endsAt: game.endsAt && Number.isFinite(Date.parse(game.endsAt)) ? game.endsAt : previous?.game.endsAt,
      },
      acquired: previous?.acquired ?? false,
    };
  }
  for (const [key, target] of Object.entries(app.farmingSessionTargets)) {
    const latest = app.availableGames.find((game) => gameKey(game) === key) ?? target.game;
    const drops = state.cachedDropsSnapshot.filter((drop) => dropMatchesGame(drop, target.game));
    const acquired =
      target.acquired ||
      isCampaignAcquired(latest) ||
      (drops.length > 0 &&
        hasCompleteIdentifiedRewardSet(latest, drops, true) &&
        drops.every(isRewardAcquired));
    app.farmingSessionTargets[key] = {
      game: {
        ...latest,
        endsAt:
          latest.endsAt && Number.isFinite(Date.parse(latest.endsAt)) ? latest.endsAt : target.game.endsAt,
        ...(acquired
          ? { allDropsCompleted: true, rewardSummary: { completion: 'all-acquired', remainderReasons: [] } }
          : {}),
      },
      acquired,
    };
    const watchComplete = hasCompletedCampaignWatchTime(state, latest);
    if (watchComplete && !acquired) {
      app.farmingSessionTargets[key] = {
        ...app.farmingSessionTargets[key],
        game: {
          ...app.farmingSessionTargets[key].game,
          rewardSummary: { completion: 'farming-complete', remainderReasons: [] },
        },
      };
      app.queue = app.queue.filter((game) => gameKey(game) !== key);
      const metadata = app.queueEntryMetadataByKey[key];
      if (metadata) {
        const {
          attemptedStreamerNames: _attempts,
          watchAttempt: _watch,
          streamerRetryAt: _retry,
          streamerRetryReason: _reason,
          streamerWaitState: _wait,
          ...retained
        } = metadata;
        app.queueEntryMetadataByKey[key] = retained;
      }
    }
    if (acquired || watchComplete || isExpiredGame(app.farmingSessionTargets[key].game))
      delete app.campaignFailureEpisodesByKey[key];
  }
}

export function unresolvedFarmingTargets(state: ServiceWorkerState): TwitchGame[] {
  return Object.values(state.appState.farmingSessionTargets)
    .filter((target) => !target.acquired && !isExpiredGame(target.game))
    .map((target) => target.game);
}

export function retireFarmingTarget(state: ServiceWorkerState, game: TwitchGame): void {
  const key = gameKey(game);
  delete state.appState.farmingSessionTargets[key];
  delete state.appState.campaignFailureEpisodesByKey[key];
}
