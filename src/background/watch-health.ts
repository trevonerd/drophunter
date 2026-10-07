import type {
  PlaybackPrepResult,
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

/** Managed playback can be verified even when Twitch omits its optional Drops label. */
export function hasVerifiedWatchPlayback(
  health: WatchHealthSnapshot | null | undefined,
): health is WatchHealthSnapshot {
  return Boolean(
    health &&
      (health.isHealthy ||
        (health.mode === 'managed-tab' &&
          health.status === 'degraded' &&
          (health.reason === 'heartbeat' || health.reason === 'drops-inactive') &&
          health.consecutiveFailures === 0 &&
          !health.shouldFallback)),
  );
}

export function reasonForWatchProbe(probe: WatchProbeResult): WatchHealthReason {
  if (probe.isLive === false) return 'stream-offline';
  if (probe.reason && probe.reason !== 'started' && probe.reason !== 'stopped') return probe.reason;
  if (!probe.accepted) return 'heartbeat-failed';
  if (probe.sameChannel === false) return 'wrong-channel';
  if (probe.sameGame === false) return 'wrong-game';
  if (probe.hasDropsSignal === false) return 'drops-inactive';
  return 'heartbeat';
}

/** A shared Twitch endpoint failure says nothing about an individual channel. */
export function isTablessServiceFailure(health: WatchHealthSnapshot | null | undefined): boolean {
  return (
    health?.mode === 'tabless' &&
    health.status === 'failed' &&
    (health.reason === 'error' || health.reason === 'heartbeat-failed')
  );
}

export function isWatchPreparationUnavailable(health: WatchHealthSnapshot | null | undefined): boolean {
  return health?.reason === 'managed-tab-unavailable' || isTablessServiceFailure(health);
}

export function createManagedWatchPreparationHealth(
  preparation: PlaybackPrepResult,
  probe: WatchProbeResult,
  prepared: boolean,
  now: () => number,
): WatchHealthSnapshot {
  const hasDropsEligibilityProof =
    probe.isLive === true && probe.sameChannel === true && probe.sameGame === true;
  const dropsSignalIsAcceptable = probe.hasDropsSignal !== false || hasDropsEligibilityProof;
  const healthy =
    prepared && preparation.isPlaybackReady === true && dropsSignalIsAcceptable && isHealthyWatchProbe(probe);
  const awaitingInteraction =
    prepared &&
    preparation.isPlaybackReady !== true &&
    preparation.userInteractionRequired === true &&
    probe.isLive !== false &&
    probe.sameChannel !== false &&
    probe.sameGame !== false;
  const awaitingPlayback =
    prepared &&
    preparation.playbackPending === true &&
    probe.isLive !== false &&
    probe.sameChannel !== false &&
    probe.sameGame !== false;
  const status = healthy
    ? probe.hasDropsSignal === false
      ? 'degraded'
      : 'healthy'
    : awaitingInteraction || awaitingPlayback
      ? 'degraded'
      : 'failed';
  const reason =
    healthy && probe.hasDropsSignal === false
      ? 'drops-inactive'
      : awaitingInteraction
        ? 'user-interaction-required'
        : awaitingPlayback
          ? 'playback-pending'
          : reasonForWatchProbe(
              preparation.isPlaybackReady === true ? probe : { ...probe, reason: 'playback-inactive' },
            );
  return createWatchHealth('managed-tab', status, reason, now);
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
