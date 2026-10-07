import { mergeDropProgressMonotonic } from '../shared/drops.ts';
import { dropMatchesGame, gameKey } from '../shared/game-selection.ts';
import { isRewardFarmableNow } from '../shared/reward-scheduling.ts';
import { isRewardAcquired } from '../shared/reward-semantics.ts';
import { clearRecoveryStatus } from '../shared/runtime-status.ts';
import type { TwitchDrop, TwitchGame } from '../types/index.ts';
import { completedDropKeys, dropStateKey, isDropCampaignExpired } from './drops-projection-semantics.ts';
import { resetQueueAcquisitionRound } from './queue-acquisition-round.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { clearCampaignStallBlock } from './stalled-campaign-block.ts';
import { detectRecoveryProof, didDropMinutesAdvance } from './stream-rotation.ts';

export function dropRemainingMinutes(drop: TwitchDrop): number {
  if (typeof drop.remainingMinutes === 'number' && Number.isFinite(drop.remainingMinutes)) {
    return Math.max(0, drop.remainingMinutes);
  }
  return Number.POSITIVE_INFINITY;
}

export function compareDropPriority(a: TwitchDrop, b: TwitchDrop): number {
  const byRemaining = dropRemainingMinutes(a) - dropRemainingMinutes(b);
  if (byRemaining !== 0) return byRemaining;
  if (a.progress !== b.progress) return b.progress - a.progress;
  return a.name.localeCompare(b.name);
}

export function dropMatchesSelectedGame(drop: TwitchDrop, selected: TwitchGame): boolean {
  return dropMatchesGame(drop, selected);
}

function selectRelevantDrops(allDrops: TwitchDrop[], selected: TwitchGame): TwitchDrop[] {
  return allDrops.filter((drop) => dropMatchesSelectedGame(drop, selected));
}

function mergeRelevantDrops(
  state: ServiceWorkerState,
  selected: TwitchGame,
  relevant: TwitchDrop[],
): TwitchDrop[] {
  const previousRelevant = state.appState.allDrops.filter((drop) => dropMatchesSelectedGame(drop, selected));
  const previousByKey = new Map(previousRelevant.map((drop) => [dropStateKey(drop), drop]));
  const merged = relevant.map((drop) => {
    const previous = previousByKey.get(dropStateKey(drop));
    return previous ? mergeDropProgressMonotonic(drop, previous) : drop;
  });
  const keys = new Set(merged.map((drop) => dropStateKey(drop)));
  for (const drop of previousRelevant) {
    if (!keys.has(dropStateKey(drop)) && drop.claimed) merged.push(drop);
  }
  return merged.filter((drop) => isRewardAcquired(drop) || !isDropCampaignExpired(drop));
}

function resetSelectedProjection(state: ServiceWorkerState): void {
  state.previousAllDropsCount = 0;
  state.appState.allDrops = [];
  state.appState.pendingDrops = [];
  state.appState.completedDrops = [];
  state.appState.currentDrop = null;
  state.lastTrackedDropKey = null;
  state.lastTrackedProgress = -1;
  state.lastTrackedMinutes = -1;
}

function clearRecoveredStall(state: ServiceWorkerState, selected: TwitchGame): void {
  if (
    state.appState.queueEntryMetadataByKey[gameKey(selected)]?.watchAttempt?.preparing &&
    !state.appState.activeStreamer
  ) {
    state.lastProgressAdvanceAt = Date.now();
    return;
  }
  resetQueueAcquisitionRound(state);
  const metadata = state.appState.queueEntryMetadataByKey[gameKey(selected)];
  if (metadata) {
    const {
      streamerRetryAt: _retryAt,
      streamerRetryReason: _retryReason,
      streamerWaitState: _waitState,
      attemptedStreamerNames: _attempted,
      watchAttempt: _watch,
      ...retained
    } = metadata;
    const activeName = state.appState.activeStreamer?.name.trim().toLowerCase();
    state.appState.queueEntryMetadataByKey[gameKey(selected)] = {
      ...retained,
      ...(activeName
        ? {
            attemptedStreamerNames: [activeName],
            watchAttempt: { channelName: activeName, observedAt: Date.now() },
          }
        : {}),
    };
  }
  state.lastProgressAdvanceAt = Date.now();
  state.noProgressRotationAttempts = 0;
  state.offlineChecks = 0;
  state.avoidStreamerName = null;
  state.recoveryBackoffUntil = 0;
  state.lastRecoveryAttemptAt = 0;
  state.stalledRecoveryAttempts = 0;
  state.appState.stalledCampaignBlocksByKey = clearCampaignStallBlock(
    state.appState.stalledCampaignBlocksByKey,
    selected,
  );
  state.appState = clearRecoveryStatus(state.appState);
}

export function splitDropsForSelectedGame(
  state: ServiceWorkerState,
  allDrops: TwitchDrop[],
  hasFreshProgressEvidence = false,
): void {
  const selected = state.appState.selectedGame;
  if (!selected) {
    resetSelectedProjection(state);
    return;
  }

  const previousCompletedKeys = completedDropKeys(state.appState.completedDrops);
  const relevant = mergeRelevantDrops(state, selected, selectRelevantDrops(allDrops, selected));
  const completed = relevant
    .filter((drop) => isRewardAcquired(drop))
    .map((drop) => ({ ...drop, status: 'completed' as const }));
  const pending = relevant
    .filter((drop) => !isRewardAcquired(drop))
    .map((drop) => ({
      ...drop,
      status: drop.progress > 0 || drop.claimable === true ? ('active' as const) : ('pending' as const),
    }));
  const farmable = pending.filter((drop) => isRewardFarmableNow(drop));
  const active =
    (farmable.filter((drop) => drop.progress > 0 || Boolean(drop.claimable)).length > 0
      ? farmable.filter((drop) => drop.progress > 0 || Boolean(drop.claimable))
      : farmable
    )
      .slice()
      .sort(compareDropPriority)[0] ?? null;
  const nextKey = active ? dropStateKey(active) : null;
  const nextProgress = active?.progress ?? -1;
  const nextMinutes = active?.currentMinutes ?? -1;
  const previousKey = state.lastTrackedDropKey;
  const previousProgress = state.lastTrackedProgress;
  const previousMinutes = state.lastTrackedMinutes;
  const freshTiming = previousProgress === -1 && previousMinutes === -1 && previousKey === null;

  state.previousAllDropsCount = state.appState.allDrops.length;
  state.appState.allDrops = relevant;
  state.appState.completedDrops = completed;
  state.appState.pendingDrops = pending;
  state.appState.currentDrop = active ? { ...active, status: 'active' } : null;
  state.lastTrackedDropKey = nextKey;
  state.lastTrackedProgress = nextProgress;
  state.lastTrackedMinutes = Math.max(previousMinutes, nextMinutes);

  if (freshTiming) return;
  const recoveryProof = detectRecoveryProof({
    previousDropKey: previousKey,
    previousProgress,
    nextDropKey: nextKey,
    nextProgress,
    previousCompletedKeys,
    nextCompletedKeys: completedDropKeys(completed),
  });
  const minuteAdvance =
    !recoveryProof &&
    nextKey !== null &&
    nextKey === previousKey &&
    didDropMinutesAdvance(previousMinutes, nextMinutes);
  const acquiredTrackedReward =
    previousKey !== null &&
    !previousCompletedKeys.has(previousKey) &&
    completedDropKeys(completed).has(previousKey);
  if (hasFreshProgressEvidence && (recoveryProof || minuteAdvance || acquiredTrackedReward))
    clearRecoveredStall(state, selected);
}
