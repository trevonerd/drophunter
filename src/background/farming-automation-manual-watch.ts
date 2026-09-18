import type { TwitchGame } from '../types/index.ts';
import type { FarmingAutomationManualTabsResult } from './farming-automation-browser.ts';
import type {
  FarmingAutomationFactsV1,
  FarmingAutomationManualWatchV1,
  FarmingAutomationPersistence,
} from './farming-automation-contracts.ts';
import type { FarmingAutomationWake } from './farming-automation-wake.ts';
import { detectManualViewing } from './manual-watch-detector.ts';
import { MANUAL_WATCH_TTL_MS } from './manual-watch-policy.ts';

export type ManualWatchTransportDirective =
  | { readonly kind: 'suspend'; readonly transitionId: string }
  | { readonly kind: 'resume'; readonly transitionId: string }
  | { readonly kind: 'unchanged' };

export type FarmingAutomationManualWatchInput = {
  readonly target: TwitchGame | null;
  readonly managedTabId: number | null;
  readonly automationActive: boolean;
};

export type FarmingAutomationManualWatchResult =
  | { readonly kind: 'inactive'; readonly stoppedAt?: number }
  | { readonly kind: 'active'; readonly watch: FarmingAutomationManualWatchV1 }
  | {
      readonly kind: 'failed';
      readonly reason: 'candidate-preparation-failed' | 'persistence-failed';
    };

export interface FarmingAutomationManualWatchController {
  readonly evaluate: (
    input: FarmingAutomationManualWatchInput,
  ) => Promise<FarmingAutomationManualWatchResult>;
  readonly reconcileTransport: (
    input: FarmingAutomationManualWatchInput & { readonly transportSuspended: boolean },
  ) => Promise<ManualWatchTransportDirective>;
}

export interface FarmingAutomationManualWatchOptions {
  readonly persistence: Pick<FarmingAutomationPersistence, 'loadFacts' | 'saveFacts'>;
  readonly observeManualTabs: () => Promise<FarmingAutomationManualTabsResult>;
  readonly replaceDeadline: FarmingAutomationWake['replaceDeadline'];
  readonly now?: () => number;
  readonly onSessionFailure?: (
    reason: Extract<FarmingAutomationManualWatchResult, { readonly kind: 'failed' }>['reason'],
  ) => void;
}

function transitionId(
  event: 'manual-suspended' | 'manual-resumed',
  target: TwitchGame | null,
  at: number,
): string {
  return `${event}:${target?.campaignId ?? target?.id ?? 'manual-watch'}:${at}`;
}

function withoutManualWatchDeadline(facts: FarmingAutomationFactsV1): number | null {
  if (facts.manualWatch !== null && facts.nextEvaluationAt === facts.manualWatch.recheckAt) {
    return null;
  }
  return facts.nextEvaluationAt;
}

function withManualWatchDeadline(facts: FarmingAutomationFactsV1, recheckAt: number): number {
  const existingDeadline = withoutManualWatchDeadline(facts);
  return existingDeadline === null ? recheckAt : Math.min(existingDeadline, recheckAt);
}

type ManualWatchClassification =
  | { readonly kind: 'inactive' }
  | { readonly kind: 'eligible-manual' }
  | { readonly kind: 'automation-paused' };

interface ManualWatchDecision {
  readonly result: Exclude<FarmingAutomationManualWatchResult, { readonly kind: 'failed' }>;
  readonly nextFacts: FarmingAutomationFactsV1 | null;
}

function decideManualWatch(
  facts: FarmingAutomationFactsV1,
  classification: ManualWatchClassification,
  observedAt: number,
): ManualWatchDecision {
  if (classification.kind === 'inactive') {
    return facts.manualWatch === null
      ? { result: { kind: 'inactive' }, nextFacts: null }
      : {
          result: { kind: 'inactive', stoppedAt: observedAt },
          nextFacts: {
            ...facts,
            manualWatch: null,
            nextEvaluationAt: withoutManualWatchDeadline(facts),
          },
        };
  }

  const recheckAt = observedAt + MANUAL_WATCH_TTL_MS;
  const watch: FarmingAutomationManualWatchV1 = {
    kind: classification.kind,
    observedAt,
    stoppedAt: null,
    expiresAt: recheckAt,
    recheckAt,
  };
  return {
    result: { kind: 'active', watch },
    nextFacts: {
      ...facts,
      manualWatch: watch,
      nextEvaluationAt: withManualWatchDeadline(facts, recheckAt),
    },
  };
}

function transportDirective(
  result: Exclude<FarmingAutomationManualWatchResult, { readonly kind: 'failed' }>,
  input: FarmingAutomationManualWatchInput & { readonly transportSuspended: boolean },
  now: () => number,
): ManualWatchTransportDirective {
  if (result.kind === 'active') {
    return input.transportSuspended
      ? { kind: 'unchanged' }
      : {
          kind: 'suspend',
          transitionId: transitionId('manual-suspended', input.target, result.watch.observedAt),
        };
  }
  return input.transportSuspended
    ? {
        kind: 'resume',
        transitionId: transitionId('manual-resumed', input.target, result.stoppedAt ?? now()),
      }
    : { kind: 'unchanged' };
}

export function createFarmingAutomationManualWatch(
  options: FarmingAutomationManualWatchOptions,
): FarmingAutomationManualWatchController {
  const now = options.now ?? Date.now;
  let evaluationTail = Promise.resolve();

  const serialize = <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const result = evaluationTail.then(operation);
    evaluationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const persistAndReplaceDeadline = async (facts: FarmingAutomationFactsV1): Promise<boolean> => {
    const saved = await options.persistence.saveFacts(facts);
    if (saved.kind === 'failed') return false;
    await options.replaceDeadline(facts.nextEvaluationAt);
    return true;
  };

  const evaluateWithCachePolicy = async (
    input: FarmingAutomationManualWatchInput,
    honorCachedWatch: boolean,
  ): Promise<FarmingAutomationManualWatchResult> => {
    const loaded = await options.persistence.loadFacts();
    if (loaded.kind === 'failed') return { kind: 'failed', reason: 'persistence-failed' };

    const observedAt = now();
    const currentWatch = loaded.value.manualWatch;
    if (
      honorCachedWatch &&
      currentWatch !== null &&
      observedAt < currentWatch.expiresAt &&
      observedAt < currentWatch.recheckAt
    ) {
      await options.replaceDeadline(loaded.value.nextEvaluationAt ?? currentWatch.recheckAt);
      return { kind: 'active', watch: currentWatch };
    }

    const observation = await options.observeManualTabs();
    if (observation.kind === 'failed') {
      return { kind: 'failed', reason: 'candidate-preparation-failed' };
    }
    const classification =
      input.target === null
        ? ({ kind: 'inactive' } as const)
        : await detectManualViewing({
            target: input.target,
            managedTabId: input.managedTabId,
            automationActive: input.automationActive,
            now: observedAt,
            queryTabs: async () => observation.tabs.map(({ tab }) => tab),
            getStreamContext: async (tabId) =>
              observation.tabs.find(({ tab }) => tab.id === tabId)?.context ?? null,
          });
    if (classification.kind === 'failed') {
      return { kind: 'failed', reason: 'candidate-preparation-failed' };
    }

    const decision = decideManualWatch(loaded.value, classification, observedAt);
    if (decision.nextFacts === null) return decision.result;
    return (await persistAndReplaceDeadline(decision.nextFacts))
      ? decision.result
      : { kind: 'failed', reason: 'persistence-failed' };
  };

  const evaluate = (input: FarmingAutomationManualWatchInput) =>
    serialize(() => evaluateWithCachePolicy(input, true));

  return {
    evaluate,
    reconcileTransport(input) {
      return serialize(async () => {
        const result = await evaluateWithCachePolicy(input, false);
        if (result.kind === 'failed') {
          options.onSessionFailure?.(result.reason);
          return { kind: 'unchanged' };
        }
        return transportDirective(result, input, now);
      });
    },
  };
}
