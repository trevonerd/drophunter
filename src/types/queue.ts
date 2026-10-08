export type QueueEntrySource = 'manual' | 'favorite-auto';
export type FavoriteAutoStartDispositionStatus = 'started' | 'queued' | 'waiting' | 'disabled';
export type FavoriteAutoStartDispositionReason =
  | 'session'
  | 'campaign-data'
  | 'streamer'
  | 'manual-watch'
  | 'refresh-failed';
export interface FavoriteAutoStartDisposition {
  readonly status: FavoriteAutoStartDispositionStatus;
  readonly reason?: FavoriteAutoStartDispositionReason;
  readonly retryAt?: number;
}

export interface QueueEntryMetadata {
  readonly source: QueueEntrySource;
  readonly addedAt: number;
  readonly reason: 'user-added' | 'favorite-discovered' | 'retained-after-hide';
  readonly streamerRetryAt?: number;
  readonly streamerRetryReason?:
    | 'no-streamers'
    | 'directory-unavailable'
    | 'open-failed'
    | 'stalled-progress';
  readonly streamerWaitState?: 'availability';
  /** Explicit queued Play that could not start yet; resumes ahead of the incumbent once streamers appear. */
  readonly manualPriorityAt?: number;
  readonly attemptedStreamerNames?: readonly string[];
  /** Eligible live streamers already known while a stalled-progress park waits; a new one ends the wait. */
  readonly parkedStreamerNames?: readonly string[];
  readonly watchAttempt?: {
    readonly channelName: string;
    readonly observedAt: number;
    readonly firstPlaybackAt?: number;
    readonly suspendedAt?: number;
    readonly preparing?: boolean;
    readonly preparationProgress?: number;
  };
}

export interface QueueAcquisitionRound {
  readonly attemptedCampaignKeys: readonly string[];
  readonly nextRoundAt: number | null;
}
