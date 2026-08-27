import type { ActivationSyncResult, ActivationTrigger, CampaignSyncState } from '../types/index.ts';

export type { ActivationSyncResult, ActivationTrigger, CampaignSyncState } from '../types/index.ts';

export const CAMPAIGN_SYNC_INTERVAL_MS = 30 * 60_000;

export type ActivationSyncAttempt =
  | { readonly kind: 'synced'; readonly campaignCount: number }
  | { readonly kind: 'needs-session' }
  | { readonly kind: 'transient-error'; readonly error: string };

interface ActivationSyncCoordinatorDependencies {
  readonly now?: () => number;
  readonly getCampaignSyncState: () => CampaignSyncState;
  readonly setCampaignSyncState: (state: CampaignSyncState) => Promise<void> | void;
  readonly performSync: (trigger: ActivationTrigger) => Promise<ActivationSyncAttempt>;
  readonly shouldRunPeriodicSync?: () => boolean;
  readonly scheduleRetry?: (retryAt: number) => Promise<void> | void;
  readonly clearRetry?: () => Promise<void> | void;
}

export interface ActivationSyncCoordinator {
  readonly request: (trigger: ActivationTrigger) => Promise<ActivationSyncResult>;
}

const TRIGGER_PRIORITY: Record<ActivationTrigger, number> = {
  'popup-open': 0,
  'periodic-campaign': 1,
  'worker-start': 2,
  'browser-start': 3,
  'auth-recovered': 4,
  wake: 5,
  'extension-update': 6,
  manual: 7,
};

const CACHE_AWARE_TRIGGERS = new Set<ActivationTrigger>(['popup-open', 'periodic-campaign']);
const TRANSIENT_RETRY_DELAYS_MS = [60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000] as const;

type PendingRequest = {
  trigger: ActivationTrigger;
  readonly promise: Promise<ActivationSyncResult>;
  readonly resolve: (result: ActivationSyncResult) => void;
  readonly reject: (error: unknown) => void;
};

function createPendingRequest(trigger: ActivationTrigger): PendingRequest {
  let resolve: (result: ActivationSyncResult) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<ActivationSyncResult>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { trigger, promise, resolve, reject };
}

export function createActivationSyncCoordinator(
  dependencies: ActivationSyncCoordinatorDependencies,
): ActivationSyncCoordinator {
  const now = dependencies.now ?? Date.now;
  let active: Promise<ActivationSyncResult> | null = null;
  let activeTrigger: ActivationTrigger | null = null;
  let pending: PendingRequest | null = null;
  let consecutiveTransientFailures = 0;

  function isFresh(syncState: CampaignSyncState, at: number): boolean {
    return (
      syncState.status === 'idle' &&
      syncState.lastSuccessAt !== null &&
      at - syncState.lastSuccessAt < CAMPAIGN_SYNC_INTERVAL_MS
    );
  }

  async function execute(trigger: ActivationTrigger): Promise<ActivationSyncResult> {
    const startedAt = now();
    const previous = dependencies.getCampaignSyncState();
    if (
      trigger === 'periodic-campaign' &&
      dependencies.shouldRunPeriodicSync &&
      !dependencies.shouldRunPeriodicSync()
    ) {
      return { kind: 'not-needed' };
    }
    if (
      trigger === 'periodic-campaign' &&
      previous.status === 'retry-scheduled' &&
      startedAt < previous.nextRetryAt
    ) {
      return {
        kind: 'retry-scheduled',
        retryAt: previous.nextRetryAt,
        error: previous.error,
      };
    }
    if (CACHE_AWARE_TRIGGERS.has(trigger) && isFresh(previous, startedAt)) {
      return { kind: 'cache-fresh', campaignCount: previous.campaignCount };
    }

    await dependencies.setCampaignSyncState({
      status: 'syncing',
      lastAttemptAt: startedAt,
      lastSuccessAt: previous.lastSuccessAt,
      campaignCount: previous.campaignCount,
      nextRetryAt: null,
    });

    let attempt: ActivationSyncAttempt;
    try {
      attempt = await dependencies.performSync(trigger);
    } catch (error) {
      attempt = { kind: 'transient-error', error: error instanceof Error ? error.message : String(error) };
    }

    switch (attempt.kind) {
      case 'synced': {
        consecutiveTransientFailures = 0;
        await dependencies.clearRetry?.();
        const completedAt = now();
        await dependencies.setCampaignSyncState({
          status: 'idle',
          lastAttemptAt: startedAt,
          lastSuccessAt: completedAt,
          campaignCount: attempt.campaignCount,
          nextRetryAt: null,
        });
        return attempt;
      }
      case 'needs-session':
        consecutiveTransientFailures = 0;
        await dependencies.clearRetry?.();
        await dependencies.setCampaignSyncState({
          status: 'needs-session',
          lastAttemptAt: startedAt,
          lastSuccessAt: previous.lastSuccessAt,
          campaignCount: previous.campaignCount,
          nextRetryAt: null,
        });
        return attempt;
      case 'transient-error': {
        if (consecutiveTransientFailures === 0 && previous.status === 'retry-scheduled') {
          const previousDelay = previous.nextRetryAt - (previous.lastAttemptAt ?? previous.nextRetryAt);
          const previousIndex = (TRANSIENT_RETRY_DELAYS_MS as readonly number[]).indexOf(previousDelay);
          if (previousIndex >= 0) consecutiveTransientFailures = previousIndex + 1;
        }
        const retryDelay =
          TRANSIENT_RETRY_DELAYS_MS[
            Math.min(consecutiveTransientFailures, TRANSIENT_RETRY_DELAYS_MS.length - 1)
          ];
        consecutiveTransientFailures += 1;
        const retryAt = now() + retryDelay;
        await dependencies.scheduleRetry?.(retryAt);
        await dependencies.setCampaignSyncState({
          status: 'retry-scheduled',
          lastAttemptAt: startedAt,
          lastSuccessAt: previous.lastSuccessAt,
          campaignCount: previous.campaignCount,
          nextRetryAt: retryAt,
          error: attempt.error,
        });
        return { kind: 'retry-scheduled', retryAt, error: attempt.error };
      }
      default:
        return attempt satisfies never;
    }
  }

  function start(trigger: ActivationTrigger): Promise<ActivationSyncResult> {
    const operation = execute(trigger);
    active = operation;
    activeTrigger = trigger;
    void operation.then(
      () => settle(operation),
      () => settle(operation),
    );
    return operation;
  }

  function settle(operation: Promise<ActivationSyncResult>): void {
    if (active !== operation) return;
    active = null;
    activeTrigger = null;
    const next = pending;
    pending = null;
    if (!next) return;
    void start(next.trigger).then(next.resolve, next.reject);
  }

  function request(trigger: ActivationTrigger): Promise<ActivationSyncResult> {
    if (!active) return start(trigger);

    if (pending) {
      if (TRIGGER_PRIORITY[trigger] > TRIGGER_PRIORITY[pending.trigger]) pending.trigger = trigger;
      return pending.promise;
    }

    if (activeTrigger !== null && TRIGGER_PRIORITY[trigger] > TRIGGER_PRIORITY[activeTrigger]) {
      pending = createPendingRequest(trigger);
      return pending.promise;
    }

    return active;
  }

  return { request };
}
