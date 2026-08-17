import type {
  FarmingAutomationPersistence,
  FarmingAutomationPersistenceWrite,
  FarmingSessionTransitionReceiptV1,
  WatchCleanupV1,
} from './farming-automation-contracts.ts';
import type { WatchTransportTransition } from './watch-transport-transition.ts';

export type FarmingAutomationRecoveryResult =
  | {
      readonly kind: 'ready';
      readonly receipt: FarmingSessionTransitionReceiptV1 | null;
      readonly matchedCommittedTarget: boolean;
    }
  | { readonly kind: 'failed'; readonly reason: 'persistence-failed' };

export interface FarmingAutomationRecoveryOptions {
  readonly persistence: Pick<
    FarmingAutomationPersistence,
    'loadFacts' | 'loadReceipt' | 'saveFacts' | 'updateReceiptCleanup'
  >;
  readonly currentCampaignKey: () => string | null;
  readonly repairActivity: (
    receipt: FarmingSessionTransitionReceiptV1,
  ) => Promise<FarmingAutomationPersistenceWrite>;
  readonly watch: Pick<WatchTransportTransition, 'release'>;
  readonly now?: () => number;
}

function assertNever(value: never): never {
  throw new DOMException(`Unexpected recovery variant: ${String(value)}`, 'InvariantError');
}

export async function reconcileFarmingAutomationRecovery(
  options: FarmingAutomationRecoveryOptions,
): Promise<FarmingAutomationRecoveryResult> {
  try {
    const receiptRead = await options.persistence.loadReceipt();
    switch (receiptRead.kind) {
      case 'failed':
        return { kind: 'failed', reason: 'persistence-failed' };
      case 'ready':
        break;
      default:
        return assertNever(receiptRead);
    }
    const factsRead = await options.persistence.loadFacts();
    switch (factsRead.kind) {
      case 'failed':
        return { kind: 'failed', reason: 'persistence-failed' };
      case 'ready':
        break;
      default:
        return assertNever(factsRead);
    }
    const receipt = receiptRead.value;
    const matchedCommittedTarget = receipt !== null && options.currentCampaignKey() === receipt.toCampaignKey;
    let facts = factsRead.value;
    if (receipt !== null && matchedCommittedTarget) {
      switch (receipt.transition) {
        case 'start':
          break;
        case 'preemption':
          if (receipt.fromCampaignKey !== null) {
            facts = {
              ...facts,
              lastPreemption: {
                attemptId: receipt.attemptId,
                fromCampaignKey: receipt.fromCampaignKey,
                toCampaignKey: receipt.toCampaignKey,
                committedAt: receipt.committedAt,
                sessionRevision: receipt.sessionRevision,
              },
            };
          }
          break;
        default:
          return assertNever(receipt.transition);
      }
    }
    const savedFacts = await options.persistence.saveFacts(facts);
    switch (savedFacts.kind) {
      case 'failed':
        return { kind: 'failed', reason: 'persistence-failed' };
      case 'written':
        break;
      default:
        return assertNever(savedFacts);
    }
    if (receipt === null) {
      return { kind: 'ready', receipt: null, matchedCommittedTarget: false };
    }
    if (matchedCommittedTarget) {
      const activity = await options.repairActivity(receipt);
      switch (activity.kind) {
        case 'failed':
          return { kind: 'failed', reason: 'persistence-failed' };
        case 'written':
          break;
        default:
          return assertNever(activity);
      }
    }
    switch (receipt.cleanup.kind) {
      case 'not-required':
      case 'released':
      case 'abandoned-unproven':
        return { kind: 'ready', receipt, matchedCommittedTarget };
      case 'pending': {
        const released = await options.watch.release(receipt.cleanup.obsolete);
        const now = options.now?.() ?? Date.now();
        let cleanup: WatchCleanupV1;
        switch (released.kind) {
          case 'not-required':
            cleanup = { kind: 'not-required' };
            break;
          case 'released':
            cleanup = { kind: 'released', releasedAt: now, method: released.method };
            break;
          case 'abandoned-unproven':
            cleanup = { kind: 'abandoned-unproven', acknowledgedAt: now };
            break;
          default:
            return assertNever(released);
        }
        const updated = await options.persistence.updateReceiptCleanup({
          attemptId: receipt.attemptId,
          cleanup,
        });
        switch (updated.kind) {
          case 'written':
            return {
              kind: 'ready',
              receipt: { ...receipt, cleanup },
              matchedCommittedTarget,
            };
          case 'failed':
          case 'stale':
            return { kind: 'failed', reason: 'persistence-failed' };
          default:
            return assertNever(updated);
        }
      }
      default:
        return assertNever(receipt.cleanup);
    }
  } catch (error) {
    if (error instanceof Error) return { kind: 'failed', reason: 'persistence-failed' };
    throw error;
  }
}
