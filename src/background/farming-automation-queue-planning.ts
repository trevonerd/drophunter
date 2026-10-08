import { favoriteGameIdentityKeys, gameKey, isFavoriteGame } from '../shared/game-selection.ts';
import { planFarmingAutomationPolicy } from './farming-automation-candidates.ts';
import type { FarmingAutomationDiscoveryResult } from './farming-automation-discovery.ts';
import {
  cloneFarmingAutomationGame,
  createFarmingAutomationPolicySnapshot,
  PARKED_CAMPAIGN_RETRY_MS,
} from './farming-automation-gates.ts';
import type { QueueAvailabilityEvidence } from './farming-queue-progression.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

type ReadyDiscovery = Extract<FarmingAutomationDiscoveryResult, { readonly kind: 'ready' }>;

export function collectQueueAvailabilityEvidence(
  state: ServiceWorkerState,
  discovery: ReadyDiscovery,
  now: number,
): QueueAvailabilityEvidence {
  const stallBaselines = new Map<string, readonly string[]>();
  const rehabilitatedCampaignKeys = new Set<string>();
  for (const game of state.appState.queue) {
    const key = gameKey(game);
    const metadata = state.appState.queueEntryMetadataByKey[key];
    const directory = discovery.directories.get(key);
    if (
      !directory ||
      metadata?.streamerRetryReason !== 'stalled-progress' ||
      (metadata.streamerRetryAt ?? 0) <= now
    )
      continue;
    const live = [...new Set(directory.streamers.map((streamer) => streamer.name.trim().toLowerCase()))];
    if (!metadata.parkedStreamerNames) {
      stallBaselines.set(key, live);
      continue;
    }
    const known = new Set([...metadata.parkedStreamerNames, ...(metadata.attemptedStreamerNames ?? [])]);
    if (live.some((name) => name && !known.has(name))) rehabilitatedCampaignKeys.add(key);
  }
  return {
    stallBaselines,
    rehabilitatedCampaignKeys,
    eligibleCampaignKeys: new Set(
      state.appState.queue
        .filter(
          (game) =>
            !discovery.directoryFailures.has(gameKey(game)) &&
            (discovery.availability[gameKey(game)]?.eligibleStreamerCount ?? 0) > 0,
        )
        .map(gameKey),
    ),
  };
}

export function buildFarmingAutomationQueuePlan(
  state: ServiceWorkerState,
  discovery: ReadyDiscovery,
  parkedKeys: ReadonlySet<string>,
  now: number,
) {
  const policySnapshot = createFarmingAutomationPolicySnapshot(
    state,
    discovery.snapshot,
    discovery.availability,
  );
  const plan = planFarmingAutomationPolicy(
    {
      ...policySnapshot,
      candidateFactsByKey: Object.fromEntries(
        [...parkedKeys].map((key) => [key, { hasFarmableReward: false, isActive: false }]),
      ),
    },
    now,
  );
  const availabilityRetryAt = now + PARKED_CAMPAIGN_RETRY_MS;
  const retryMetadata = { ...plan.queue.queueEntryMetadataByKey };
  let needsAvailabilityRetry = false;
  for (const game of plan.queue.queue) {
    const key = gameKey(game);
    const metadata = retryMetadata[key];
    if (metadata?.source !== 'favorite-auto' || discovery.directoryFailures.has(key)) continue;
    if ((discovery.availability[key]?.eligibleStreamerCount ?? 0) > 0) continue;
    needsAvailabilityRetry = true;
    if (metadata.streamerRetryReason) continue;
    retryMetadata[key] = {
      ...metadata,
      streamerRetryAt:
        metadata.streamerRetryAt !== undefined && metadata.streamerRetryAt > now
          ? metadata.streamerRetryAt
          : availabilityRetryAt,
      streamerRetryReason: 'no-streamers',
    };
  }
  if (
    discovery.snapshot.games.some(
      (game) =>
        game.rewardSummary === undefined &&
        isFavoriteGame(
          cloneFarmingAutomationGame(game),
          favoriteGameIdentityKeys(state.appState.favoriteGames),
        ),
    )
  )
    needsAvailabilityRetry = true;
  const queuePlan = needsAvailabilityRetry
    ? { ...plan.queue, queueEntryMetadataByKey: retryMetadata }
    : plan.queue;
  return { plan, queuePlan, availabilityRetryAt, needsAvailabilityRetry };
}
