import type { TwitchGame, TwitchStreamer } from '../types';
import type { RefreshDropsOutcome } from './drops-tick-refresh.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import type { StalledProgressRecoveryResult, StalledProgressSource } from './stalled-progress-recovery.ts';
import type { StreamRotationReason } from './stream-rotation.ts';

export type EnterPersistentRecoveryFn = (
  state: ServiceWorkerState,
  reason: StreamRotationReason,
  message: string,
  opts?: {
    onSkipCurrentGame?: () => Promise<void>;
    onNotify?: (title: string, message: string, priority?: number) => Promise<void>;
  },
) => Promise<void>;

export interface RotateStreamerOptions {
  onOpenStreamer?: () => Promise<boolean>;
  onSaveState?: () => Promise<void>;
  onSaveTimingState?: (state: ServiceWorkerState) => Promise<void>;
  onEnterPersistentRecovery?: EnterPersistentRecoveryFn;
  onSkipCurrentGame?: () => Promise<void>;
}

export type RotateStreamerFn = (
  state: ServiceWorkerState,
  reason: StreamRotationReason,
  opts?: RotateStreamerOptions,
) => Promise<boolean>;

export interface StreamContext {
  channelName: string;
  categorySlug: string;
  categoryLabel: string;
  streamTitle: string;
  titleContainsDrops: boolean;
  hasDropsSignal: boolean;
  isLive: boolean;
  pageUrl: string;
}

export interface RotateStreamerIfInvalidOptions {
  onFetchStreamContext?: (tabId: number) => Promise<StreamContext | null>;
  onResolveCategorySlug?: (game: TwitchGame) => Promise<string>;
  onAttemptPlaybackSelfHeal?: (tabId: number) => Promise<void>;
  onSaveState?: () => Promise<void>;
  onSaveTimingState?: (state: ServiceWorkerState) => Promise<void>;
  onRotateStreamer?: RotateStreamerFn;
  onOpenStreamer?: () => Promise<boolean>;
  onEnterPersistentRecovery?: EnterPersistentRecoveryFn;
  onSkipCurrentGame?: () => Promise<void>;
  onForceRefreshDropsData?: () => Promise<RefreshDropsOutcome>;
  onTablessWatchActive?: () => boolean;
  onRecoverStalledProgress?: (source: StalledProgressSource) => Promise<StalledProgressRecoveryResult>;
}

export interface OpenBestStreamerCallbacks {
  onFetchDirectoryStreamersFromApi: (
    game: TwitchGame,
    forceRefresh?: boolean,
    language?: string,
  ) => Promise<TwitchStreamer[] & { languageFilterApplied: boolean }>;
  onOpenForegroundChannel: (streamer: TwitchStreamer) => Promise<void>;
  onOpenWatchTransport?: (streamer: TwitchStreamer) => Promise<boolean>;
}

export function rotateStreamerOptsFrom(
  opts: RotateStreamerIfInvalidOptions | undefined,
): RotateStreamerOptions {
  return {
    onOpenStreamer: opts?.onOpenStreamer,
    onSaveState: opts?.onSaveState,
    onSaveTimingState: opts?.onSaveTimingState,
    onEnterPersistentRecovery: opts?.onEnterPersistentRecovery,
    onSkipCurrentGame: opts?.onSkipCurrentGame,
  };
}
