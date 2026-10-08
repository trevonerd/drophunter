import type { TwitchGame, TwitchStreamer } from '../types';
import type { StreamInfoProbe } from './eligible-streamer-discovery.ts';
import type { StreamContext } from './farming-session-context.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import type { StalledProgressRecoveryResult, StalledProgressSource } from './stalled-progress-recovery.ts';
import type { StreamRotationReason } from './stream-rotation.ts';
import type { WatchHealth } from './watch-transport.ts';

export type WatchStartResult =
  | { readonly kind: 'started'; readonly health: WatchHealth | null }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly health: WatchHealth | null };

export interface RotateStreamerOptions {
  readonly isCurrent?: () => boolean;
  onOpenStreamer?: (isCurrent?: () => boolean) => Promise<boolean>;
  onSaveState?: () => Promise<void>;
  onSaveTimingState?: (state: ServiceWorkerState) => Promise<void>;
  onSkipCurrentGame?: () => Promise<void>;
}

export type RotateStreamerFn = (
  state: ServiceWorkerState,
  reason: StreamRotationReason,
  opts?: RotateStreamerOptions,
) => Promise<boolean>;

export interface RotateStreamerIfInvalidOptions extends RotateStreamerOptions {
  onFetchStreamContext: (tabId: number) => Promise<StreamContext | null>;
  onResolveCategorySlug: (game: TwitchGame) => Promise<string>;
  onSaveState: () => Promise<void>;
  onSaveTimingState: (state: ServiceWorkerState) => Promise<void>;
  onRotateStreamer: RotateStreamerFn;
  onOpenStreamer: (isCurrent?: () => boolean) => Promise<boolean>;
  onSkipCurrentGame: () => Promise<void>;
  onTablessWatchActive: () => boolean;
  onRecoverStalledProgress: (
    source: StalledProgressSource,
    isCurrent?: () => boolean,
  ) => Promise<StalledProgressRecoveryResult>;
}

export interface OpenBestStreamerCallbacks {
  readonly onAttemptStreamer?: (game: TwitchGame, channelName: string) => Promise<boolean>;
  onFetchDirectoryStreamersFromApi: (
    game: TwitchGame,
    forceRefresh?: boolean,
    language?: string,
    isCurrent?: () => boolean,
  ) => Promise<TwitchStreamer[] & { languageFilterApplied: boolean }>;
  onOpenForegroundChannel: (streamer: TwitchStreamer) => Promise<void>;
  onOpenWatchTransport?: (streamer: TwitchStreamer) => Promise<WatchStartResult | boolean>;
  readonly probeStreamInfo?: (channel: string) => Promise<StreamInfoProbe>;
  readonly onRefreshVerifiedGame?: (
    game: TwitchGame,
    isCurrent?: () => boolean,
  ) => Promise<TwitchGame | null>;
  isCurrent?: () => boolean;
}
