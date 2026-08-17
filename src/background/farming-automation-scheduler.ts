import type { FarmingAutomationOutcome, FarmingAutomationTrigger } from './farming-automation.ts';

export type FarmingAutomationEvaluateBatch = (
  triggers: ReadonlySet<FarmingAutomationTrigger>,
) => Promise<FarmingAutomationOutcome>;

export interface FarmingAutomationSchedulerDependencies {
  readonly evaluateBatch: FarmingAutomationEvaluateBatch;
}

export interface FarmingAutomationSchedulerStatus {
  readonly active: boolean;
  readonly pending: boolean;
  readonly activeTriggerCount: number;
  readonly pendingTriggerCount: number;
}

export interface FarmingAutomationScheduler {
  readonly request: (trigger: FarmingAutomationTrigger) => Promise<FarmingAutomationOutcome>;
  readonly invalidate: () => void;
  readonly getStatus: () => FarmingAutomationSchedulerStatus;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
}

interface EvaluationRun {
  readonly triggers: Set<FarmingAutomationTrigger>;
  readonly deferred: Deferred<FarmingAutomationOutcome>;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

export function createFarmingAutomationScheduler(
  dependencies: FarmingAutomationEvaluateBatch | FarmingAutomationSchedulerDependencies,
): FarmingAutomationScheduler {
  const evaluateBatch = typeof dependencies === 'function' ? dependencies : dependencies.evaluateBatch;
  let active: EvaluationRun | null = null;
  let pending: EvaluationRun | null = null;
  let invalidated = false;

  const start = (run: EvaluationRun): void => {
    active = run;
    invalidated = false;
    const triggers = new Set(run.triggers);
    Promise.resolve()
      .then(() => evaluateBatch(triggers))
      .then(
        (outcome) => complete(run, { outcome }),
        (error: unknown) => complete(run, { error }),
      );
  };

  const complete = (
    run: EvaluationRun,
    result: { readonly outcome: FarmingAutomationOutcome } | { readonly error: unknown },
  ): void => {
    if (active !== run) {
      return;
    }
    const wasInvalidated = invalidated;
    invalidated = false;
    active = null;
    if ('outcome' in result) {
      run.deferred.resolve(
        wasInvalidated ? { kind: 'unchanged', reason: 'superseded-by-state-change' } : result.outcome,
      );
    } else {
      run.deferred.reject(result.error);
    }
    const next = pending;
    pending = null;
    if (next) {
      start(next);
    }
  };

  const request = (trigger: FarmingAutomationTrigger): Promise<FarmingAutomationOutcome> => {
    if (active) {
      if (!pending) {
        pending = { triggers: new Set([trigger]), deferred: createDeferred() };
      } else {
        pending.triggers.add(trigger);
      }
      return pending.deferred.promise;
    }
    const run: EvaluationRun = {
      triggers: new Set([trigger]),
      deferred: createDeferred(),
    };
    start(run);
    return run.deferred.promise;
  };

  return {
    request,
    invalidate() {
      invalidated = true;
    },
    getStatus() {
      return {
        active: active !== null,
        pending: pending !== null,
        activeTriggerCount: active?.triggers.size ?? 0,
        pendingTriggerCount: pending?.triggers.size ?? 0,
      };
    },
  };
}
