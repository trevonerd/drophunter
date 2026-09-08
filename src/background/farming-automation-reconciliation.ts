import { isCampaignAcquired } from '../shared/campaign-eligibility.ts';
import { mergeDropProgressMonotonic } from '../shared/drops.ts';
import { gameKey } from '../shared/game-selection.ts';
import type { TwitchDrop } from '../types/index.ts';
import { annotateGameCompletion, dropStateKey } from './drops-projection-semantics.ts';
import type { FarmingAutomationTwitchSnapshot } from './farming-automation-twitch.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

export function farmingAutomationCompletionFingerprint(state: ServiceWorkerState): string {
  return JSON.stringify([
    state.twitchSessionCache?.userId ?? null,
    state.appState.acquiredCampaignIds ?? [],
    ...[
      ...state.cachedDropsSnapshot,
      ...Object.values(state.appState.campaignDropsByKey).flat(),
      ...state.appState.allDrops,
      ...state.appState.completedDrops,
    ]
      .map((drop) =>
        JSON.stringify([
          dropStateKey(drop),
          drop.progress,
          drop.currentMinutes,
          drop.claimed,
          drop.claimable,
          drop.verificationState,
          drop.startsAt,
          drop.endsAt,
        ]),
      )
      .sort(),
  ]);
}

export function reconcileFarmingAutomationSnapshot(
  snapshot: FarmingAutomationTwitchSnapshot,
  state: ServiceWorkerState,
): FarmingAutomationTwitchSnapshot {
  const previousDrops = new Map<string, TwitchDrop>();
  for (const drop of [
    ...state.cachedDropsSnapshot,
    ...Object.values(state.appState.campaignDropsByKey).flat(),
    ...state.appState.allDrops,
    ...state.appState.completedDrops,
  ]) {
    if (!drop.campaignId) continue;
    const key = dropStateKey(drop);
    const previous = previousDrops.get(key);
    previousDrops.set(key, previous ? mergeDropProgressMonotonic(drop, previous) : drop);
  }
  const drops = snapshot.drops.map((drop): TwitchDrop => {
    const next = {
      ...drop,
      benefitIds: drop.benefitIds ? [...drop.benefitIds] : undefined,
      rewardDistributionTypes: drop.rewardDistributionTypes ? [...drop.rewardDistributionTypes] : undefined,
    };
    const previous = drop.campaignId ? previousDrops.get(dropStateKey(next)) : undefined;
    return previous ? mergeDropProgressMonotonic(next, previous) : next;
  });
  const completedKeys = new Set([
    ...(state.appState.acquiredCampaignIds ?? []).map((id) => `campaign:${id}`),
    ...[
      ...state.appState.availableGames,
      ...state.appState.queue,
      ...(state.appState.selectedGame ? [state.appState.selectedGame] : []),
    ]
      .filter((game) => game.campaignId && isCampaignAcquired(game))
      .map(gameKey),
  ]);
  const games = annotateGameCompletion(
    snapshot.games.map((game) => ({
      ...game,
      allowedChannels: game.allowedChannels ? [...game.allowedChannels] : game.allowedChannels,
    })),
    drops,
    'campaign-authoritative',
  ).map((game) =>
    completedKeys.has(gameKey(game))
      ? {
          ...game,
          allDropsCompleted: true,
          rewardSummary: { completion: 'all-acquired' as const, remainderReasons: [] },
        }
      : game,
  );
  return {
    ...snapshot,
    games,
    drops,
    campaignDropsByKey: Object.fromEntries(
      games.map((game) => [
        gameKey(game),
        drops.filter((drop) => drop.campaignId === game.campaignId && Boolean(game.campaignId)),
      ]),
    ),
  };
}
