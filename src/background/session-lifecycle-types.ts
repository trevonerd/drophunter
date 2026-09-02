import type { TwitchGame } from '../types/index.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

export type LifecycleRefreshOptions = {
  readonly includeCampaignFetch: boolean;
  readonly includeInventoryFetch: boolean;
  readonly suppressNotifications: boolean;
};

export type QueueProgressOptions = {
  readonly onOpenStreamer?: () => Promise<boolean>;
  readonly onEnsureWorkspace?: () => Promise<void>;
  readonly onRefreshDropsData?: (options: LifecycleRefreshOptions) => Promise<void>;
  readonly onSaveState?: () => Promise<void>;
  readonly onSaveTimingState?: (state: ServiceWorkerState) => Promise<void>;
};

export type StopFarmingSessionOptions = {
  readonly skipTimingStateSave?: boolean;
  readonly notification?: { readonly title: string; readonly message: string };
  readonly stopReason?: string;
  readonly stopMessage?: string | null;
  readonly onStopMonitoring?: () => void;
  readonly onCloseManagedTab?: (tabId: number | null) => Promise<void>;
  readonly onClearRotationMetadata?: (
    appState: ServiceWorkerState['appState'],
  ) => ServiceWorkerState['appState'];
  readonly onApplyStopState?: (state: ServiceWorkerState, reason: string, message: string | null) => void;
  readonly onNotify?: (title: string, message: string) => Promise<void>;
  // Fires for every automatic (non user-stop) terminal reason, independent of
  // whether a desktop `notification` was supplied — covers reasons like
  // no-active-campaigns that never had a desktop notification.
  readonly onSystemAlert?: (reason: string, message: string) => Promise<void>;
  readonly onSaveState?: () => Promise<void>;
  readonly onSaveTimingState?: (state: ServiceWorkerState) => Promise<void>;
};

export type AdvanceQueueOptions = QueueProgressOptions & {
  readonly onSendAlert?: (kind: 'drop-complete' | 'all-complete', message: string) => Promise<void>;
  readonly onStopMonitoring?: () => void;
  readonly onCloseManagedTabIfSafe?: (tabId: number | null) => Promise<boolean>;
  readonly onClearManagedTabOwnership?: () => void;
  readonly onApplyStopState?: (state: ServiceWorkerState, reason: string, message: string | null) => void;
  readonly onNotify?: (title: string, message: string) => Promise<void>;
  readonly onSystemAlert?: (reason: string, message: string) => Promise<void>;
};

export type CompletedQueueContext = {
  readonly completedWhileNoStreamers: boolean;
  readonly completedGameName: string;
  readonly terminalFarmingCompleteGame: TwitchGame | null;
};

export type QueueSkipReason = 'stalled-progress' | 'no-streamers' | 'unverifiable-twitch' | 'unfarmable';

export type QueueSkipCopy = {
  readonly logMessage: string;
  readonly skipNotificationTitle: string;
  readonly skipMessage: string;
  readonly terminalNotificationTitle: string;
  readonly terminalMessage: string;
  readonly terminalNotificationMessage: string;
  readonly stopReason: string;
};

export type StopFarmingSessionRequest = {
  readonly stopReason: string;
  readonly stopMessage: string;
  readonly notification: { readonly title: string; readonly message: string };
  readonly suppressNotifications?: boolean;
};

export type SkipCurrentGameOptions = QueueProgressOptions & {
  readonly onStopFarmingSession?: (options: StopFarmingSessionRequest) => Promise<void>;
  readonly onNotify?: (title: string, message: string, priority?: number) => Promise<void>;
};

export type StartFarmingPayload = { readonly game?: TwitchGame };

export type StartFarmingOptions = QueueProgressOptions & {
  readonly onBroadcastStateUpdate?: () => void;
  readonly onStartMonitoring?: () => void;
  readonly onOpenMonitorDashboard?: (options: { readonly toggle: boolean }) => Promise<void>;
  readonly onStopMonitoring?: () => void;
  readonly onTrackActivity?: (reason: string) => Promise<void>;
  readonly onApplyStopState?: (state: ServiceWorkerState, reason: string, message: string | null) => void;
};

export type StartFarmingResult = {
  readonly success: boolean;
  readonly error?: string;
};
