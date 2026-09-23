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
  readonly streamerRetryReason?: 'no-streamers' | 'directory-unavailable';
  readonly streamerRetryAttempts?: number;
  readonly streamerRetryCycles?: number;
  readonly streamerWaitState?: 'availability';
}

export interface QueueAcquisitionRound {
  readonly attemptedCampaignKeys: readonly string[];
  readonly nextRoundAt: number | null;
}
