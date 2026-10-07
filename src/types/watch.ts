export type WatchTransportMode = 'managed-tab' | 'tabless';

export type WatchHealthStatus =
  | 'healthy'
  | 'degraded'
  | 'failed'
  | 'stalled'
  | 'disabled'
  | 'stopped'
  | 'not-started';

export type WatchHealthReason =
  | 'started'
  | 'heartbeat'
  | 'heartbeat-failed'
  | 'stream-offline'
  | 'wrong-channel'
  | 'wrong-game'
  | 'drops-inactive'
  | 'stalled-progress'
  | 'managed-tab-unavailable'
  | 'playback-inactive'
  | 'playback-pending'
  | 'user-interaction-required'
  | 'transport-disabled'
  | 'not-started'
  | 'stopped'
  | 'error';

export interface WatchHealthSnapshot {
  readonly mode: WatchTransportMode;
  readonly isHealthy: boolean;
  readonly status: WatchHealthStatus;
  readonly reason: WatchHealthReason;
  readonly consecutiveFailures: number;
  readonly consecutiveStalls: number;
  readonly progress: number | null;
  readonly shouldFallback: boolean;
  readonly checkedAt: number;
}
