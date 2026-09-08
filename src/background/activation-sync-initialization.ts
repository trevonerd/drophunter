import type { CampaignSyncState } from '../types/activation-sync.ts';
import {
  interruptedActivationSyncErrorKind,
  nextActivationSyncRetryDelay,
} from './activation-sync-retry-policy.ts';
import { publishCampaignSyncState } from './activation-sync-state-publication.ts';

export type ActivationSyncInitializationDependencies = {
  readonly getCampaignSyncState: () => CampaignSyncState;
  readonly setCampaignSyncState: (state: CampaignSyncState) => Promise<void> | void;
  readonly scheduleRetry?: (retryAt: number) => Promise<void> | void;
  readonly clearRetry?: () => Promise<void> | void;
};

export async function reconcileActivationSyncState(
  dependencies: ActivationSyncInitializationDependencies,
  now: () => number,
): Promise<void> {
  const current = dependencies.getCampaignSyncState();
  if (current.status === 'retry-scheduled') {
    await dependencies.scheduleRetry?.(Math.max(now(), current.nextRetryAt));
    return;
  }
  if (current.status !== 'syncing') {
    await dependencies.clearRetry?.();
    return;
  }
  const retryAttemptCount = current.retryAttemptCount + 1;
  const retryAt = Math.max(
    now(),
    Math.min(current.attemptDeadlineAt, now() + nextActivationSyncRetryDelay(retryAttemptCount, undefined)),
  );
  await publishCampaignSyncState(
    dependencies,
    {
      status: 'retry-scheduled',
      lastAttemptAt: current.lastAttemptAt,
      lastSuccessAt: current.lastSuccessAt,
      campaignCount: current.campaignCount,
      retryAttemptCount,
      lastErrorKind: interruptedActivationSyncErrorKind(current.lastErrorKind),
      nextRetryAt: retryAt,
      attemptDeadlineAt: null,
      error: 'Campaign sync was interrupted before completion.',
    },
    () => dependencies.scheduleRetry?.(retryAt),
  );
}
