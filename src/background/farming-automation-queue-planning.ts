import { favoriteGameIdentityKeys, gameKey, isFavoriteGame } from '../shared/game-selection.ts';
import { planFarmingAutomationPolicy } from './farming-automation-candidates.ts';
import type { FarmingAutomationDiscoveryResult } from './farming-automation-discovery.ts';
import {
  cloneFarmingAutomationGame,
  createFarmingAutomationPolicySnapshot,
  PARKED_CAMPAIGN_RETRY_MS,
} from './farming-automation-gates.ts';
import { rehabilitateCampaignsWithNewStreamers } from './farming-automation-stall-rehabilitation.ts';
import { resetQueueAcquisitionRound } from './queue-acquisition-round.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

type ReadyDiscovery = Extract<FarmingAutomationDiscoveryResult, { readonly kind: 'ready' }>;

export function resumeQueuedCampaignsWithAvailableStreamers(
  state: ServiceWorkerState,
  discovery: ReadyDiscovery,
): void {
  rehabilitateCampaignsWithNewStreamers(
    state,
    discovery.snapshot.games.map(cloneFarmingAutomationGame),
    discovery.directories,
  );
  let newlyAvailable = false;
  for (const game of state.appState.queue) {
    const key = gameKey(game);
    const metadata = state.appState.queueEntryMetadataByKey[key];
    if (
      metadata?.streamerWaitState !== 'availability' ||
      (discovery.availability[key]?.eligibleStreamerCount ?? 0) === 0
    )
      continue;
    const { streamerWaitState: _waitState, streamerRetryCycles: _cycles, ...ready } = metadata;
    state.appState.queueEntryMetadataByKey[key] = ready;
    newlyAvailable = true;
  }
  if (newlyAvailable) resetQueueAcquisitionRound(state);
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
    retryMetadata[key] = {
      ...metadata,
      streamerRetryAt:
        metadata.streamerRetryAt !== undefined && metadata.streamerRetryAt > now
          ? metadata.streamerRetryAt
          : availabilityRetryAt,
      streamerRetryReason: 'no-streamers',
      streamerRetryAttempts: (metadata.streamerRetryAttempts ?? 0) + 1,
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
