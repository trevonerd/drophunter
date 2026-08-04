import type {
  WatchHealthReason,
  WatchHealthSnapshot,
  WatchHealthStatus,
  WatchTransportMode,
} from '../types/index.ts';
import type { WatchProbeResult } from './watch-transport.ts';

export function normalizeWatchProgress(progress: number | null | undefined): number | null {
  if (progress == null || !Number.isFinite(progress) || progress < 0) return null;
  return progress;
}

export function isHealthyWatchProbe(probe: WatchProbeResult): boolean {
  return probe.accepted && probe.isLive !== false && probe.sameChannel !== false && probe.sameGame !== false;
}

export function reasonForWatchProbe(probe: WatchProbeResult): WatchHealthReason {
  if (probe.reason && probe.reason !== 'started' && probe.reason !== 'stopped') return probe.reason;
  if (!probe.accepted) return 'heartbeat-failed';
  if (probe.isLive === false) return 'stream-offline';
  if (probe.sameChannel === false) return 'wrong-channel';
  if (probe.sameGame === false) return 'wrong-game';
  if (probe.hasDropsSignal === false) return 'drops-inactive';
  return 'heartbeat';
}

export function createWatchHealth(
  mode: WatchTransportMode,
  status: WatchHealthStatus,
  reason: WatchHealthReason,
  now: () => number,
  options: {
    consecutiveFailures?: number;
    consecutiveStalls?: number;
    progress?: number | null;
    shouldFallback?: boolean;
  } = {},
): WatchHealthSnapshot {
  return {
    mode,
    isHealthy: status === 'healthy',
    status,
    reason,
    consecutiveFailures: options.consecutiveFailures ?? 0,
    consecutiveStalls: options.consecutiveStalls ?? 0,
    progress: options.progress ?? null,
    shouldFallback: options.shouldFallback ?? false,
    checkedAt: now(),
  };
}
