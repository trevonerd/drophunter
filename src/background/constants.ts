// Storage keys
export const TWITCH_SESSION_STORAGE_KEY = 'twitchSession';
export const DROPS_SNAPSHOT_CACHE_KEY = 'dropsSnapshotCache';
export const TIMING_STATE_KEY = 'timingState';
export const LAST_ACTIVITY_AT_KEY = 'lastActivityAt';
export const ALARM_NAME = 'dropCheck';

// Timing constants
export const GAMES_CACHE_TTL_MS = 5 * 60_000;
// Chrome 120+ clamps alarm periods to a 30s minimum, so anything lower never fires faster.
export const PROGRESS_POLL_MS = 30_000;
export const DROP_CLAIM_RETRY_COOLDOWN_MS = 45_000;
export const TIMING_SAVE_DEBOUNCE_MS = 5_000;
export const CRASH_DETECTION_THRESHOLD_MS = 30_000;
export const CRASH_RECOVERY_GRACE_MS = 2 * 60_000;
export const STREAM_VALIDATION_GRACE_MS = 75_000;
