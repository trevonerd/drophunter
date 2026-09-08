import { gameKey, getGameDisplayLabel } from '../shared/game-selection.ts';
import { recordAutomationActivity } from './automation-activity.ts';
import type { GamesCacheRefreshDeps } from './games-cache-contracts.ts';
import { logWarn } from './logging.ts';
import type { QueueAvailabilityCleanupResult } from './queue-availability-cleanup.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

export function combineQueueCleanupResults(
  primary: QueueAvailabilityCleanupResult,
  additional: QueueAvailabilityCleanupResult,
): QueueAvailabilityCleanupResult {
  return {
    removed: [...primary.removed, ...additional.removed],
    selectedRemoved: primary.selectedRemoved || additional.selectedRemoved,
  };
}

function activityId(result: QueueAvailabilityCleanupResult): string {
  return `queue-cleanup:${result.removed
    .map(({ game, reason }) => `${reason}:${gameKey(game)}`)
    .sort()
    .join('|')}`;
}

function message(result: QueueAvailabilityCleanupResult): string {
  const labels = result.removed.map(({ game }) => getGameDisplayLabel(game));
  const count = labels.length;
  const reasons = new Set(result.removed.map(({ reason }) => reason));
  const reason = reasons.size === 1 && reasons.has('expired') ? 'expired' : 'unavailable or expired';
  return `Removed ${count} ${reason} ${count === 1 ? 'campaign' : 'campaigns'} from the queue: ${labels.join(', ')}.`;
}

export function queueCleanupNotification(result: QueueAvailabilityCleanupResult): {
  readonly transitionId: string;
  readonly message: string;
} {
  return { transitionId: activityId(result), message: message(result) };
}

export function recordQueueCleanupActivity(
  state: ServiceWorkerState,
  result: QueueAvailabilityCleanupResult,
): void {
  if (result.removed.length === 0) return;
  const id = activityId(result);
  if (!state.appState.automationActivity.some((entry) => entry.id === id)) {
    recordAutomationActivity(state.appState, {
      id,
      kind: 'queue-campaigns-removed',
      at: Date.now(),
      message: message(result),
    });
  }
}

export async function notifyQueueCleanup(
  result: QueueAvailabilityCleanupResult,
  deps: Pick<GamesCacheRefreshDeps, 'onQueueCampaignsRemoved'>,
): Promise<void> {
  if (result.removed.length === 0) return;
  try {
    await deps.onQueueCampaignsRemoved?.(result);
  } catch (error) {
    logWarn('Queue cleanup notification delivery failed', { error: String(error) });
  }
}

export async function persistQueueCleanup(
  state: ServiceWorkerState,
  result: QueueAvailabilityCleanupResult,
  deps: Pick<GamesCacheRefreshDeps, 'onQueueCampaignsRemoved' | 'saveState'>,
): Promise<void> {
  recordQueueCleanupActivity(state, result);
  await deps.saveState(state);
  await notifyQueueCleanup(result, deps);
}
