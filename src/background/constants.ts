// Storage keys
export const TWITCH_SESSION_STORAGE_KEY = 'twitchSession';
export const CLAIM_LOG_KEY = 'claimLog';
export const TELEGRAM_CREDENTIALS_KEY = 'telegramCredentials';
export const DROPS_SNAPSHOT_CACHE_KEY = 'dropsSnapshotCache';
export const TIMING_STATE_KEY = 'timingState';
export const LAST_ACTIVITY_AT_KEY = 'lastActivityAt';
export const ALARM_NAME = 'dropCheck';
export const CAMPAIGN_SYNC_ALARM_NAME = 'campaignSync';
export const CAMPAIGN_SYNC_RETRY_ALARM_NAME = 'campaignSyncRetry';
export const TWITCH_DROPS_PAGE_URL = 'https://www.twitch.tv/drops/campaigns';

// Timing constants
export const GAMES_CACHE_TTL_MS = 5 * 60_000;
export const PROGRESS_POLL_MS = 60_000;
export const DROP_CLAIM_RETRY_COOLDOWN_MS = 45_000;
export const TIMING_SAVE_DEBOUNCE_MS = 5_000;
export const CRASH_DETECTION_THRESHOLD_MS = 30_000;
export const CRASH_RECOVERY_GRACE_MS = 2 * 60_000;
// Consecutive dropVanished misses required before a queued campaign is pruned — guards
// against a single partial/stale post-resume snapshot wiping the queue.
export const QUEUE_MISSING_CONFIRM_THRESHOLD = 2;
// Max heartbeat gap that still counts as a routine SW recycle (not a long browser restart)
// when a no-tab recovery (no-streamers/offline/open-failed) is active.
export const RESUME_RECOVERY_GRACE_MS = 5 * 60_000;
export const STREAM_VALIDATION_GRACE_MS = 75_000;
export const FULL_REFRESH_INTERVAL_MS = 30 * 60_000;
export const INVALID_STREAM_THRESHOLD = 8;
export const STREAM_ROTATE_COOLDOWN_MS = 5 * 60_000;
export const TWITCH_SESSION_RETRY_COOLDOWN_MS = 5_000;
export const INTEGRITY_FALLBACK_TTL_MS = 30 * 60_000; // 30 minutes
export const TICK_WATCHDOG_TIMEOUT_MS = 60_000;
