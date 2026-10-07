import type { WatchTransportMode } from '../types/index.ts';
import type { WatchOwnershipV1 } from './farming-automation-contracts.ts';
import { prepareWatchCandidate } from './watch-candidate-preparation.ts';
import { createWatchHealth, isTablessServiceFailure } from './watch-health.ts';
import type { FarmingTarget, WatchHealth } from './watch-transport.ts';

export type { WatchOwnershipV1 } from './farming-automation-contracts.ts';

export type WatchReleaseResult =
  | { readonly kind: 'not-required' }
  | { readonly kind: 'released'; readonly method: 'closed' | 'neutralized' }
  | { readonly kind: 'abandoned-unproven' };

export interface ProvisionalWatchCandidate {
  readonly target: FarmingTarget;
  readonly ownership: WatchOwnershipV1;
  readonly health: WatchHealth;
  readonly dispose: () => Promise<void>;
}

export type WatchPromotion =
  | {
      readonly kind: 'promoted';
      readonly ownership: WatchOwnershipV1;
      readonly obsolete: WatchOwnershipV1 | null;
    }
  | { readonly kind: 'discarded'; readonly ownership: WatchOwnershipV1 };

export interface PreparedWatch {
  readonly target: FarmingTarget;
  readonly ownership: WatchOwnershipV1;
  readonly health: WatchHealth;
  promote(): WatchPromotion;
  dispose(): Promise<void>;
}

export type WatchPreparation =
  | { readonly kind: 'prepared'; readonly watch: PreparedWatch }
  | {
      readonly kind: 'failed';
      readonly reason: 'candidate-unavailable';
      readonly health?: WatchHealth | null;
    };

export interface WatchTransportTransition {
  suspend?(isCurrent?: () => boolean): Promise<void>;
  prepare(
    target: FarmingTarget,
    mode: WatchHealth['mode'],
    isCurrent?: () => boolean,
    allowInitialCreation?: boolean,
  ): Promise<WatchPreparation>;
  release(ownership: WatchOwnershipV1): Promise<WatchReleaseResult>;
  currentOwnership(): WatchOwnershipV1 | null;
}

export type WatchTransportAdoption = {
  readonly target: FarmingTarget;
  readonly ownership: WatchOwnershipV1;
  readonly health: WatchHealth;
  readonly obsolete: WatchOwnershipV1 | null;
};

export interface WatchTransportRuntime {
  readonly stop?: () => Promise<void>;
  readonly currentOwnership: () => WatchOwnershipV1 | null;
  readonly prepare?: (
    target: FarmingTarget,
    isCurrent?: () => boolean,
    allowInitialCreation?: boolean,
    mode?: WatchTransportMode,
  ) => Promise<WatchPreparation>;
  readonly hasViableManagedWatch?: () => boolean;
  readonly adopt: (adoption: WatchTransportAdoption) => void;
}

export interface WatchTransportTransitionOptions {
  readonly currentOwnership: WatchOwnershipV1 | null;
  readonly runtime?: WatchTransportRuntime;
  readonly prepareManaged: (
    target: FarmingTarget,
    isCurrent?: () => boolean,
    allowInitialCreation?: boolean,
  ) => Promise<ProvisionalWatchCandidate | null>;
  readonly prepareTabless: (
    target: FarmingTarget,
    isCurrent?: () => boolean,
  ) => Promise<ProvisionalWatchCandidate | null>;
  readonly release: (ownership: WatchOwnershipV1) => Promise<WatchReleaseResult>;
}

function sameOwnership(left: WatchOwnershipV1 | null, right: WatchOwnershipV1): boolean {
  if (!left || left.kind !== right.kind) return false;
  switch (left.kind) {
    case 'managed-tab':
      return (
        right.kind === 'managed-tab' &&
        left.tabId === right.tabId &&
        left.ownershipToken === right.ownershipToken
      );
    case 'tabless':
      return right.kind === 'tabless' && left.targetKey === right.targetKey;
  }
}

export function createWatchTransportTransition(
  options: WatchTransportTransitionOptions,
): WatchTransportTransition {
  let ownership = options.currentOwnership;
  const currentOwnership = () => (options.runtime ? options.runtime.currentOwnership() : ownership);

  const prepare = async (
    target: FarmingTarget,
    mode: WatchHealth['mode'],
    isCurrent = () => true,
    allowInitialCreation = false,
  ): Promise<WatchPreparation> => {
    if (options.runtime?.prepare)
      return options.runtime.prepare(target, isCurrent, allowInitialCreation, mode);
    const preparePreferred = mode === 'tabless' ? options.prepareTabless : options.prepareManaged;
    const preferred = await prepareWatchCandidate({
      prepare: () => preparePreferred(target, isCurrent, allowInitialCreation),
      isCurrent,
      accept: (health) =>
        health.isHealthy ||
        (mode === 'managed-tab' &&
          health.status === 'degraded' &&
          (health.reason === 'drops-inactive' || health.reason === 'user-interaction-required')),
    });
    if (preferred.kind === 'failed')
      return {
        kind: 'failed',
        reason: 'candidate-unavailable',
        ...(mode === 'managed-tab'
          ? {
              health:
                preferred.health ?? createWatchHealth(mode, 'failed', 'managed-tab-unavailable', Date.now),
            }
          : isTablessServiceFailure(preferred.health)
            ? { health: preferred.health }
            : {}),
      };
    const candidate = preferred.candidate;

    let promotion: WatchPromotion | null = null;
    let disposal: Promise<void> | null = null;
    let discarded = false;
    const watch: PreparedWatch = {
      target: candidate.target,
      ownership: candidate.ownership,
      health: candidate.health,
      promote: () => {
        if (promotion) return promotion;
        if (discarded) return { kind: 'discarded', ownership: candidate.ownership };
        const obsolete = currentOwnership();
        if (options.runtime) {
          options.runtime.adopt({
            target: candidate.target,
            ownership: candidate.ownership,
            health: candidate.health,
            obsolete,
          });
        } else {
          ownership = candidate.ownership;
        }
        promotion = { kind: 'promoted', ownership: candidate.ownership, obsolete };
        return promotion;
      },
      dispose: () => {
        if (promotion) return Promise.resolve();
        discarded = true;
        disposal ??= Promise.resolve().then(candidate.dispose);
        return disposal;
      },
    };
    return { kind: 'prepared', watch };
  };

  const release = async (obsolete: WatchOwnershipV1): Promise<WatchReleaseResult> => {
    if (sameOwnership(currentOwnership(), obsolete)) return { kind: 'abandoned-unproven' };
    return options.release(obsolete);
  };

  return {
    prepare,
    release,
    currentOwnership,
    suspend: async (isCurrent = () => true) => {
      if (isCurrent()) await options.runtime?.stop?.();
    },
  };
}
