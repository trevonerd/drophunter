import type {
  AppState,
  CampaignAvailability,
  QueueEntryMetadata,
  TwitchDrop,
  TwitchGame,
} from '../types/index.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

export type FarmingAutomationLastPreemptionV1 = {
  readonly attemptId: string;
  readonly fromCampaignKey: string;
  readonly toCampaignKey: string;
  readonly committedAt: number;
  readonly sessionRevision: string;
};

export type FarmingAutomationManualWatchV1 = {
  readonly kind: 'eligible-manual' | 'automation-paused';
  readonly observedAt: number;
  readonly expiresAt: number;
  readonly recheckAt: number;
};

export type FarmingAutomationFactsV1 = {
  readonly version: 1;
  readonly lastPreemption: FarmingAutomationLastPreemptionV1 | null;
  readonly manualWatch: FarmingAutomationManualWatchV1 | null;
  readonly nextEvaluationAt: number | null;
};

export type WatchOwnershipV1 =
  | { readonly kind: 'tabless'; readonly targetKey: string }
  | {
      readonly kind: 'managed-tab';
      readonly tabId: number;
      readonly ownershipToken: string;
      readonly expectedChannel: string;
    };

export type WatchCleanupV1 =
  | { readonly kind: 'not-required' }
  | { readonly kind: 'pending'; readonly obsolete: WatchOwnershipV1 }
  | {
      readonly kind: 'released';
      readonly releasedAt: number;
      readonly method: 'closed' | 'neutralized';
    }
  | { readonly kind: 'abandoned-unproven'; readonly acknowledgedAt: number };

export type FarmingSessionTransitionReceiptV1 = {
  readonly version: 1;
  readonly attemptId: string;
  readonly transition: 'start' | 'preemption';
  readonly fromCampaignKey: string | null;
  readonly toCampaignKey: string;
  readonly toStreamerName: string;
  readonly committedAt: number;
  readonly sessionRevision: string;
  readonly fromWatch: WatchOwnershipV1 | null;
  readonly toWatch: WatchOwnershipV1 | null;
  readonly cleanup: WatchCleanupV1;
};

export type StoredRecordNormalization<T> =
  | { readonly kind: 'missing'; readonly value: T }
  | { readonly kind: 'valid'; readonly value: T }
  | { readonly kind: 'repairable'; readonly value: T }
  | { readonly kind: 'unsupported'; readonly raw: unknown };

export type FarmingAutomationPersistenceRead<T> =
  | {
      readonly kind: 'ready';
      readonly source: 'missing' | 'stored' | 'repaired';
      readonly value: T;
    }
  | {
      readonly kind: 'failed';
      readonly reason: 'storage-unavailable' | 'unsupported-record';
    };

export interface FarmingAutomationStorageArea {
  get(keys: readonly string[]): Promise<Record<string, unknown>>;
  set(values: Readonly<Record<string, unknown>>): Promise<void>;
  remove(keys: readonly string[]): Promise<void>;
}

export type FarmingAutomationPersistenceContext = {
  readonly state: ServiceWorkerState;
  readonly getSessionRevision: () => string;
  readonly broadcast: (appState: ServiceWorkerState['appState']) => void;
};

export type FarmingAutomationPersistenceWrite =
  | { readonly kind: 'written' }
  | {
      readonly kind: 'failed';
      readonly reason: 'storage-unavailable' | 'unsupported-record';
    };

export type FarmingAutomationPolicyPatch = {
  readonly queue: readonly TwitchGame[];
  readonly queueEntryMetadataByKey: Readonly<Record<string, QueueEntryMetadata>>;
  readonly campaignAvailabilityByKey: Readonly<Record<string, CampaignAvailability>>;
};

export type FarmingSessionTransitionCommit = {
  readonly expectedSessionRevision: string;
  readonly nextAppState: AppState;
  readonly nextDropsSnapshot: readonly TwitchDrop[];
  readonly receipt: FarmingSessionTransitionReceiptV1;
};

export type FarmingSessionTransitionCommitResult =
  | { readonly kind: 'committed' }
  | { readonly kind: 'stale' }
  | { readonly kind: 'failed'; readonly reason: 'transition-commit-failed' };

export type FarmingAutomationReceiptCleanupUpdate = {
  readonly attemptId: string;
  readonly cleanup: WatchCleanupV1;
};

export type FarmingAutomationReceiptCleanupResult =
  | FarmingAutomationPersistenceWrite
  | { readonly kind: 'stale' };

export interface FarmingAutomationPersistence {
  loadFacts(): Promise<FarmingAutomationPersistenceRead<FarmingAutomationFactsV1>>;
  loadReceipt(): Promise<FarmingAutomationPersistenceRead<FarmingSessionTransitionReceiptV1 | null>>;
  loadSnooze(): Promise<FarmingAutomationPersistenceRead<boolean>>;
  saveFacts(facts: FarmingAutomationFactsV1): Promise<FarmingAutomationPersistenceWrite>;
  savePolicyPatch(patch: FarmingAutomationPolicyPatch): Promise<FarmingAutomationPersistenceWrite>;
  setSnooze(): Promise<FarmingAutomationPersistenceWrite>;
  clearSnooze(): Promise<FarmingAutomationPersistenceWrite>;
  updateReceiptCleanup(
    update: FarmingAutomationReceiptCleanupUpdate,
  ): Promise<FarmingAutomationReceiptCleanupResult>;
  commitTransition(commit: FarmingSessionTransitionCommit): Promise<FarmingSessionTransitionCommitResult>;
}

export const FARMING_AUTOMATION_FACTS_STORAGE_KEY = 'farmingAutomationFactsV1';
export const FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY = 'farmingSessionTransitionReceiptV1';
export const FARMING_AUTOMATION_SNOOZE_STORAGE_KEY = 'autoStartSnoozedForBrowserSession';

export type FarmingAutomationTrigger = 'browser-start' | 'periodic' | 'campaign-refresh' | 'user-request';

export type FarmingAutomationUnchangedReason =
  | 'disabled'
  | 'snoozed'
  | 'paused'
  | 'manual-watch-active'
  | 'already-farming-best-campaign'
  | 'no-eligible-campaign'
  | 'preemption-already-applied'
  | 'superseded-by-state-change';

export type FarmingAutomationFailureReason =
  | 'notifications-unavailable'
  | 'twitch-session-missing'
  | 'drops-refresh-failed'
  | 'candidate-preparation-failed'
  | 'transition-commit-failed'
  | 'persistence-failed';

export type FarmingAutomationOutcome =
  | {
      readonly kind: 'started';
      readonly campaignKey: string;
      readonly transition: 'start' | 'preemption';
    }
  | { readonly kind: 'unchanged'; readonly reason: FarmingAutomationUnchangedReason }
  | {
      readonly kind: 'failed';
      readonly reason: FarmingAutomationFailureReason;
      readonly retryAt?: number;
    };

export interface FarmingAutomation {
  request(trigger: FarmingAutomationTrigger): Promise<FarmingAutomationOutcome>;
  snooze(reason: 'manual-pause' | 'manual-stop'): Promise<'snoozed' | 'persistence-failed'>;
}
