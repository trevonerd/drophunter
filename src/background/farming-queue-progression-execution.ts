import type { TwitchGame } from '../types/index.ts';
import type { CampaignTransitionResult } from './farming-campaign-transition.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import type { StopFarmingSessionRequest } from './session-lifecycle-types.ts';

// Private execution contract shared by the queue module's implementation.
// Callers bind effects once through createFarmingQueueProgression.
export type QueueProgressionExecution = {
  readonly now: () => number;
  readonly isCurrent: () => boolean;
  readonly onTransitionToCampaign: (
    game: TwitchGame,
    isCurrent: () => boolean,
  ) => Promise<CampaignTransitionResult>;
  readonly onSaveState: () => Promise<void>;
  readonly onSaveTimingState: (state: ServiceWorkerState) => Promise<void>;
  readonly onStopMonitoring?: () => void | Promise<void>;
  readonly onCloseManagedTabIfSafe?: (tabId: number | null) => Promise<boolean>;
  readonly onQueueWaiting?: (transitionAt: number) => Promise<void>;
  readonly onSendAlert?: (kind: 'drop-complete' | 'all-complete', message: string) => Promise<void>;
  readonly onQueueCompleteNotification?: (title: string, message: string) => Promise<void>;
  readonly isCampaignValidationCurrent?: () => boolean;
  readonly onClearManagedTabOwnership?: () => void;
  readonly onApplyStopState?: (state: ServiceWorkerState, reason: string, message: string | null) => void;
  readonly onNotify?: (title: string, message: string, priority?: number) => Promise<void>;
  readonly onSystemAlert?: (reason: string, message: string) => Promise<void>;
  readonly onStopFarmingSession?: (options: StopFarmingSessionRequest) => Promise<void>;
};
