import type { AppState, DropsSnapshot, TwitchDrop, TwitchGame, TwitchStreamer } from '../types/index.ts';
import type { FarmingAutomationManualWatchController } from './farming-automation-manual-watch.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import type { TwitchSession } from './twitch-api/types.ts';
import type { WatchTransportCoordinator } from './watch-transport-coordinator.ts';

export interface StreamContext {
  readonly channelName: string;
  readonly categorySlug: string;
  readonly categoryLabel: string;
  readonly streamTitle: string;
  readonly titleContainsDrops: boolean;
  readonly hasDropsSignal: boolean;
  readonly isLive: boolean;
  readonly videoCount?: number;
  readonly playingVideoCount?: number;
  readonly isPlaybackReady?: boolean;
  readonly pageUrl: string;
}

export interface RefreshDropsOptions {
  readonly includeCampaignFetch?: boolean;
  readonly includeInventoryFetch?: boolean;
  readonly forceInventoryFetch?: boolean;
  readonly suppressNotifications?: boolean;
}

export interface FarmingSessionAdapters {
  readonly getInitPromise: () => Promise<void> | null;
  readonly trackActivity: (reason: string) => Promise<void>;
  readonly ensureTwitchSession: (forceRefresh?: boolean) => Promise<TwitchSession | null>;
  readonly fetchDropsSnapshotFromApi: (forceSessionRefresh?: boolean) => Promise<DropsSnapshot | null>;
  readonly fetchInventorySnapshotFromApi: (
    baseDrops: TwitchDrop[],
    forceSessionRefresh?: boolean,
  ) => Promise<DropsSnapshot | null>;
  readonly fetchDirectoryStreamersFromApi: (
    game: TwitchGame,
    forceSessionRefresh?: boolean,
    language?: string,
  ) => Promise<TwitchStreamer[] & { languageFilterApplied: boolean }>;
  readonly fetchStreamContext: (tabId: number) => Promise<StreamContext | null>;
  readonly resolveCategorySlug: (game: TwitchGame) => Promise<string>;
  readonly openForegroundChannel: (streamer: TwitchStreamer) => Promise<void>;
  readonly enforcePlaybackPolicyOnStreamTab: () => Promise<void>;
  readonly attemptPlaybackSelfHeal: (tabId: number) => Promise<void>;
  readonly attemptAutoClaimChannelPointsBonus: () => Promise<boolean>;
  readonly closeManagedTabIfSafe: (tabId: number | null) => Promise<boolean>;
  readonly clearManagedTabOwnership: () => void;
  readonly openMonitorDashboardWindow: (options: { readonly toggle: boolean }) => Promise<unknown>;
  readonly sendAlert: (kind: 'drop-complete' | 'all-complete', message: string) => Promise<void>;
  readonly notify: (title: string, message: string, priority?: number) => Promise<void>;
  readonly saveState: (state: ServiceWorkerState) => Promise<void>;
  readonly saveTimingState: (state: ServiceWorkerState) => Promise<void>;
  readonly broadcastStateUpdate: (appState: AppState) => void;
  readonly monitorAutoOpenDelayMs: number;
  readonly manualWatchController?: FarmingAutomationManualWatchController;
  readonly now?: () => number;
  readonly watchTransport?: WatchTransportCoordinator;
}

export type FarmingSessionContext = {
  readonly state: ServiceWorkerState;
  readonly adapters: FarmingSessionAdapters;
  readonly now: () => number;
  readonly manualWatchController: FarmingAutomationManualWatchController;
  manualWatchTransportSuspended: boolean;
};

export function createFarmingSessionContext(
  state: ServiceWorkerState,
  adapters: FarmingSessionAdapters,
): FarmingSessionContext {
  const now = adapters.now ?? Date.now;
  const manualWatchController: FarmingAutomationManualWatchController = adapters.manualWatchController ?? {
    evaluate: async () => ({ kind: 'inactive' }),
    reconcileTransport: async ({ transportSuspended }) => (transportSuspended ? 'resume' : 'unchanged'),
  };
  return {
    state,
    adapters,
    now,
    manualWatchController,
    manualWatchTransportSuspended: false,
  };
}
