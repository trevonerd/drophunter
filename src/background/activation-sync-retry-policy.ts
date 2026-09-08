import type {
  ActivationSyncErrorKind,
  ActivationTrigger,
  CampaignSyncState,
} from '../types/activation-sync.ts';

export const CAMPAIGN_SYNC_INTERVAL_MS = 30 * 60_000;
export const ACTIVATION_SYNC_ATTEMPT_TIMEOUT_MS = 90_000;

const RETRY_DELAYS_MS = [60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000] as const;
const RETRY_SCHEDULE_RESPECTING_TRIGGERS = new Set<ActivationTrigger>([
  'popup-open',
  'worker-start',
  'browser-start',
  'wake',
  'extension-update',
  'periodic-campaign',
]);

export function nextActivationSyncRetryDelay(
  retryAttemptCount: number,
  retryAfterMs: number | undefined,
): number {
  if (retryAfterMs !== undefined && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return Math.floor(retryAfterMs);
  }
  const retryIndex = Math.min(Math.max(0, retryAttemptCount - 1), RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[retryIndex] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 10 * 60_000;
}

export function interruptedActivationSyncErrorKind(
  errorKind: ActivationSyncErrorKind | null,
): ActivationSyncErrorKind {
  return errorKind ?? 'network';
}

export function isCampaignSyncFresh(syncState: CampaignSyncState, at: number): boolean {
  return (
    syncState.status === 'idle' &&
    syncState.lastSuccessAt !== null &&
    at - syncState.lastSuccessAt < CAMPAIGN_SYNC_INTERVAL_MS
  );
}

export function shouldRespectActivationSyncRetry(trigger: ActivationTrigger): boolean {
  return RETRY_SCHEDULE_RESPECTING_TRIGGERS.has(trigger);
}
