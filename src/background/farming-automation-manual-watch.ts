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

export type ManualWatchTransportDirective = 'suspend' | 'resume' | 'unchanged';

export type FarmingAutomationManualWatchInput = {
  readonly target: TwitchGame | null;
  readonly managedTabId: number | null;
  readonly automationActive: boolean;
};

export type FarmingAutomationManualWatchResult =
  | { readonly kind: 'inactive' }
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
    switch (saved.kind) {
      case 'failed':
        return false;
      case 'written':
        await options.replaceDeadline(facts.nextEvaluationAt);
        return true;
      default: {
        const unreachable: never = saved;
        throw new DOMException(`Unexpected persistence result: ${String(unreachable)}`, 'InvariantError');
      }
    }
  };

  const evaluateWithCachePolicy = async (
    input: FarmingAutomationManualWatchInput,
    honorCachedWatch: boolean,
  ): Promise<FarmingAutomationManualWatchResult> => {
    const loaded = await options.persistence.loadFacts();
    switch (loaded.kind) {
      case 'failed':
        return { kind: 'failed', reason: 'persistence-failed' };
      case 'ready': {
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
        switch (observation.kind) {
          case 'failed':
            return { kind: 'failed', reason: 'candidate-preparation-failed' };
          case 'observed': {
            const classification =
              input.target === null
                ? { kind: 'inactive' as const }
                : await detectManualViewing({
                    target: input.target,
                    managedTabId: input.managedTabId,
                    automationActive: input.automationActive,
                    now: observedAt,
                    queryTabs: async () => observation.tabs.map(({ tab }) => tab),
                    getStreamContext: async (tabId) =>
                      observation.tabs.find(({ tab }) => tab.id === tabId)?.context ?? null,
                  });
            switch (classification.kind) {
              case 'inactive': {
                if (currentWatch === null) {
                  return { kind: 'inactive' };
                }
                const persisted = await persistAndReplaceDeadline({
                  ...loaded.value,
                  manualWatch: null,
                  nextEvaluationAt: withoutManualWatchDeadline(loaded.value),
                });
                if (!persisted) {
                  return { kind: 'failed', reason: 'persistence-failed' };
                }
                return { kind: 'inactive' };
              }
              case 'eligible-manual':
              case 'automation-paused': {
                const recheckAt = observedAt + MANUAL_WATCH_TTL_MS;
                const watch: FarmingAutomationManualWatchV1 = {
                  kind: classification.kind,
                  observedAt,
                  expiresAt: recheckAt,
                  recheckAt,
                };
                const persisted = await persistAndReplaceDeadline({
                  ...loaded.value,
                  manualWatch: watch,
                  nextEvaluationAt: withManualWatchDeadline(loaded.value, recheckAt),
                });
                if (!persisted) {
                  return { kind: 'failed', reason: 'persistence-failed' };
                }
                return { kind: 'active', watch };
              }
              default: {
                const unreachable: never = classification;
                throw new DOMException(
                  `Unexpected manual-watch variant: ${String(unreachable)}`,
                  'InvariantError',
                );
              }
            }
          }
          default: {
            const unreachable: never = observation;
            throw new DOMException(
              `Unexpected observation variant: ${String(unreachable)}`,
              'InvariantError',
            );
          }
        }
      }
      default: {
        const unreachable: never = loaded;
        throw new DOMException(`Unexpected persistence variant: ${String(unreachable)}`, 'InvariantError');
      }
    }
  };

  const evaluate = (input: FarmingAutomationManualWatchInput) =>
    serialize(() => evaluateWithCachePolicy(input, true));

  return {
    evaluate,
    reconcileTransport(input) {
      return serialize(async () => {
        const result = await evaluateWithCachePolicy(input, false);
        switch (result.kind) {
          case 'failed':
            options.onSessionFailure?.(result.reason);
            return 'unchanged';
          case 'active':
            return input.transportSuspended ? 'unchanged' : 'suspend';
          case 'inactive':
            return input.transportSuspended ? 'resume' : 'unchanged';
          default: {
            const unreachable: never = result;
            throw new DOMException(
              `Unexpected manual-watch result: ${String(unreachable)}`,
              'InvariantError',
            );
          }
        }
      });
    },
  };
}
