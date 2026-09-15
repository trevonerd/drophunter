import type {
  ActivationSyncErrorKind,
  ActivationSyncResult,
  CampaignSyncState,
} from '../types/activation-sync.ts';
import type { ActivationSyncAttempt } from './activation-sync-coordinator.ts';
import { nextActivationSyncRetryDelay } from './activation-sync-retry-policy.ts';
import { publishCampaignSyncState } from './activation-sync-state-publication.ts';

export type ActivationSyncOutcomeDependencies = {
  readonly clearRetry?: () => Promise<void> | void;
  readonly scheduleRetry?: (retryAt: number) => Promise<void> | void;
  readonly setCampaignSyncState: (state: CampaignSyncState) => Promise<void> | void;
};

type ActivationSyncOutcomeInput = {
  readonly attempt: ActivationSyncAttempt;
  readonly now: () => number;
  readonly previous: CampaignSyncState;
  readonly startedAt: number;
};

function errorKind(attempt: ActivationSyncAttempt): ActivationSyncErrorKind {
  return attempt.kind === 'transient-error' ? (attempt.errorKind ?? 'network') : 'session';
}

export async function applyActivationSyncOutcome(
  dependencies: ActivationSyncOutcomeDependencies,
  input: ActivationSyncOutcomeInput,
): Promise<ActivationSyncResult> {
  const { attempt, now, previous, startedAt } = input;
  switch (attempt.kind) {
    case 'synced': {
      const publication = await publishCampaignSyncState(
        dependencies,
        {
          status: 'idle',
          lastAttemptAt: startedAt,
          lastSuccessAt: now(),
          campaignCount: attempt.campaignCount,
          retryAttemptCount: 0,
          lastErrorKind: null,
          nextRetryAt: null,
          attemptDeadlineAt: null,
        },
        () => dependencies.clearRetry?.(),
      );
      if (!publication.statePublished) throw new TypeError('Campaign validation could not be saved.');
      return attempt;
    }
    case 'needs-session':
      await publishCampaignSyncState(
        dependencies,
        {
          status: 'needs-session',
          ...(previous.browserVerificationAttempted ? { browserVerificationAttempted: true } : {}),
          lastAttemptAt: startedAt,
          lastSuccessAt: previous.lastSuccessAt,
          campaignCount: previous.campaignCount,
          retryAttemptCount: previous.retryAttemptCount,
          lastErrorKind: attempt.errorKind ?? 'session',
          nextRetryAt: null,
          attemptDeadlineAt: null,
        },
        () => dependencies.clearRetry?.(),
      );
      return attempt;
    case 'transient-error': {
      const retryAttemptCount = previous.retryAttemptCount + 1;
      const retryAt = now() + nextActivationSyncRetryDelay(retryAttemptCount, attempt.retryAfterMs);
      const publication = await publishCampaignSyncState(
        dependencies,
        {
          status: 'retry-scheduled',
          lastAttemptAt: startedAt,
          lastSuccessAt: previous.lastSuccessAt,
          campaignCount: previous.campaignCount,
          retryAttemptCount,
          lastErrorKind: errorKind(attempt),
          nextRetryAt: retryAt,
          attemptDeadlineAt: null,
          error: attempt.error,
        },
        () => dependencies.scheduleRetry?.(retryAt),
      );
      if (publication.alarmUpdated) return { kind: 'retry-scheduled', retryAt, error: attempt.error };
      const error = `${attempt.error} Retry scheduling failed; retry manually.`;
      await dependencies.setCampaignSyncState({
        status: 'retry-failed',
        lastAttemptAt: startedAt,
        lastSuccessAt: previous.lastSuccessAt,
        campaignCount: previous.campaignCount,
        retryAttemptCount,
        lastErrorKind: errorKind(attempt),
        nextRetryAt: null,
        attemptDeadlineAt: null,
        error,
      });
      return { kind: 'retry-failed', error };
    }
    default:
      return attempt satisfies never;
  }
}
