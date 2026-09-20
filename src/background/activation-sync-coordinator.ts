import type {
  ActivationSyncErrorKind,
  ActivationSyncResult,
  ActivationTrigger,
  CampaignSyncState,
} from '../types/activation-sync.ts';
import { runActivationSyncAttempt } from './activation-sync-attempt-runner.ts';
import { reconcileActivationSyncState } from './activation-sync-initialization.ts';
import { applyActivationSyncOutcome } from './activation-sync-outcome.ts';
import {
  ACTIVATION_SYNC_ATTEMPT_TIMEOUT_MS,
  isCampaignSyncFresh,
  shouldRespectActivationSyncRetry,
} from './activation-sync-retry-policy.ts';

export type {
  ActivationSyncErrorKind,
  ActivationSyncResult,
  ActivationTrigger,
  CampaignSyncState,
} from '../types/activation-sync.ts';

export { CAMPAIGN_SYNC_INTERVAL_MS } from './activation-sync-retry-policy.ts';

export type ActivationSyncExecution = {
  readonly signal: AbortSignal;
  readonly isCurrent: () => boolean;
  readonly confirmCampaignValidation?: (campaignCount: number) => Promise<void>;
  readonly markBrowserVerificationAttempted?: () => Promise<void>;
};

export type ActivationSyncAttempt =
  | { readonly kind: 'synced'; readonly campaignCount: number }
  | { readonly kind: 'needs-session'; readonly errorKind?: 'auth' | 'session' | 'integrity' }
  | {
      readonly kind: 'transient-error';
      readonly error: string;
      readonly errorKind?: ActivationSyncErrorKind;
      readonly retryAfterMs?: number;
    };

interface ActivationSyncCoordinatorDependencies {
  readonly now?: () => number;
  readonly attemptTimeoutMs?: number;
  readonly getCampaignSyncState: () => CampaignSyncState;
  readonly setCampaignSyncState: (state: CampaignSyncState) => Promise<void> | void;
  readonly performSync: (
    trigger: ActivationTrigger,
    execution: ActivationSyncExecution,
  ) => Promise<ActivationSyncAttempt>;
  readonly shouldRunPeriodicSync?: () => boolean;
  readonly scheduleRetry?: (retryAt: number) => Promise<void> | void;
  readonly clearRetry?: () => Promise<void> | void;
}

export interface ActivationSyncCoordinator {
  readonly initialize: () => Promise<void>;
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
  'manual-retry': 7,
  manual: 8,
  'favorite-change': 9,
};
const CACHE_AWARE_TRIGGERS = new Set<ActivationTrigger>(['popup-open', 'periodic-campaign']);

type ActiveRequest = {
  readonly controller: AbortController;
  readonly operation: Promise<ActivationSyncResult>;
  readonly trigger: ActivationTrigger;
  readonly deadlineAt: number;
  obsolete: boolean;
};
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
  const attemptTimeoutMs = dependencies.attemptTimeoutMs ?? ACTIVATION_SYNC_ATTEMPT_TIMEOUT_MS;
  let active: ActiveRequest | null = null;
  let pending: PendingRequest | null = null;
  let initialization: Promise<void> | null = null;

  function initialize(): Promise<void> {
    if (initialization) return initialization;
    const reconciliation = reconcileActivationSyncState(dependencies, now);
    initialization = reconciliation;
    void reconciliation.catch(() => {
      if (initialization === reconciliation) initialization = null;
    });
    return initialization;
  }

  async function execute(
    trigger: ActivationTrigger,
    controller: AbortController,
    isCoordinatorCurrent: () => boolean,
  ): Promise<ActivationSyncResult> {
    await initialize();
    if (!isCoordinatorCurrent()) return { kind: 'not-needed' };
    const startedAt = now();
    const previous = dependencies.getCampaignSyncState();
    let browserVerificationAttempted = previous.browserVerificationAttempted;
    if (
      previous.status === 'needs-session' &&
      previous.lastErrorKind === 'integrity' &&
      shouldRespectActivationSyncRetry(trigger)
    )
      return { kind: 'needs-session' };
    if (
      trigger === 'periodic-campaign' &&
      dependencies.shouldRunPeriodicSync &&
      !dependencies.shouldRunPeriodicSync()
    )
      return { kind: 'not-needed' };
    if (
      shouldRespectActivationSyncRetry(trigger) &&
      previous.status === 'retry-scheduled' &&
      startedAt < previous.nextRetryAt
    ) {
      return { kind: 'retry-scheduled', retryAt: previous.nextRetryAt, error: previous.error };
    }
    if (shouldRespectActivationSyncRetry(trigger) && previous.status === 'retry-failed') {
      return { kind: 'retry-failed', error: previous.error };
    }
    if (CACHE_AWARE_TRIGGERS.has(trigger) && isCampaignSyncFresh(previous, startedAt))
      return { kind: 'cache-fresh', campaignCount: previous.campaignCount };
    const syncingState: CampaignSyncState = {
      status: 'syncing',
      ...(browserVerificationAttempted ? { browserVerificationAttempted } : {}),
      lastAttemptAt: startedAt,
      lastSuccessAt: previous.lastSuccessAt,
      campaignCount: previous.campaignCount,
      retryAttemptCount: previous.retryAttemptCount,
      lastErrorKind: previous.lastErrorKind,
      nextRetryAt: null,
      attemptDeadlineAt: startedAt + attemptTimeoutMs,
    };
    const validation: { attempt: Extract<ActivationSyncAttempt, { kind: 'synced' }> | null } = {
      attempt: null,
    };
    const execution: ActivationSyncExecution = {
      signal: controller.signal,
      markBrowserVerificationAttempted: async () => {
        if (!execution.isCurrent()) return;
        browserVerificationAttempted = true;
        await dependencies.setCampaignSyncState({ ...syncingState, browserVerificationAttempted: true });
      },
      isCurrent: () =>
        isCoordinatorCurrent() && !controller.signal.aborted && now() < startedAt + attemptTimeoutMs,
      confirmCampaignValidation: async (campaignCount) => {
        if (!execution.isCurrent() || validation.attempt !== null) return;
        const attempt = { kind: 'synced', campaignCount } as const;
        await applyActivationSyncOutcome(dependencies, { attempt, now, previous, startedAt });
        if (execution.isCurrent()) validation.attempt = attempt;
      },
    };
    const attempt = await runActivationSyncAttempt(
      Promise.resolve().then(async () => {
        await dependencies.setCampaignSyncState(syncingState);
        if (!execution.isCurrent()) {
          return { kind: 'transient-error', error: 'Campaign sync was cancelled.', errorKind: 'network' };
        }
        return dependencies.performSync(trigger, execution);
      }),
      controller,
      attemptTimeoutMs,
    );
    if (!isCoordinatorCurrent() || attempt === null) return { kind: 'not-needed' };
    if (
      validation.attempt !== null &&
      !(attempt.kind === 'transient-error' && attempt.errorKind === 'invalid-response')
    )
      return validation.attempt;
    return applyActivationSyncOutcome(dependencies, {
      attempt:
        now() >= startedAt + attemptTimeoutMs
          ? { kind: 'transient-error', error: 'Campaign sync timed out.', errorKind: 'network' }
          : attempt,
      now,
      previous: { ...previous, ...(browserVerificationAttempted ? { browserVerificationAttempted } : {}) },
      startedAt,
    });
  }

  function start(trigger: ActivationTrigger): Promise<ActivationSyncResult> {
    const controller = new AbortController();
    let request: ActiveRequest | null = null;
    const operation = execute(trigger, controller, () => active === request && request?.obsolete === false);
    request = { controller, operation, trigger, deadlineAt: now() + attemptTimeoutMs, obsolete: false };
    active = request;
    void operation.then(
      () => settle(request),
      () => settle(request),
    );
    return operation;
  }

  function settle(request: ActiveRequest): void {
    if (active !== request) return;
    active = null;
    const next = pending;
    pending = null;
    if (next) void start(next.trigger).then(next.resolve, next.reject);
  }

  function request(trigger: ActivationTrigger): Promise<ActivationSyncResult> {
    if (active && now() >= active.deadlineAt) {
      const expired = active;
      const queued = pending;
      active = null;
      pending = null;
      expired.obsolete = true;
      expired.controller.abort();
      const nextTrigger =
        queued && TRIGGER_PRIORITY[queued.trigger] > TRIGGER_PRIORITY[trigger] ? queued.trigger : trigger;
      const next = start(nextTrigger);
      if (queued) void next.then(queued.resolve, queued.reject);
      return next;
    }
    if (!active) return start(trigger);
    if (pending) {
      if (TRIGGER_PRIORITY[trigger] > TRIGGER_PRIORITY[pending.trigger]) pending.trigger = trigger;
      return pending.promise;
    }
    if (TRIGGER_PRIORITY[trigger] > TRIGGER_PRIORITY[active.trigger]) {
      active.obsolete = true;
      active.controller.abort();
      pending = createPendingRequest(trigger);
      return pending.promise;
    }
    return active.operation;
  }

  return { initialize, request };
}
