import type { AppState } from '../types/index.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeWatchHealth(value: unknown): AppState['watchHealth'] {
  if (!isRecord(value)) return null;
  const { mode, status, reason } = value;
  const isMode = (candidate: unknown): candidate is NonNullable<AppState['watchHealth']>['mode'] =>
    candidate === 'managed-tab' || candidate === 'tabless';
  const isStatus = (candidate: unknown): candidate is NonNullable<AppState['watchHealth']>['status'] =>
    ['healthy', 'degraded', 'failed', 'stalled', 'disabled', 'stopped', 'not-started'].includes(
      typeof candidate === 'string' ? candidate : '',
    );
  const isReason = (candidate: unknown): candidate is NonNullable<AppState['watchHealth']>['reason'] =>
    [
      'started',
      'heartbeat',
      'heartbeat-failed',
      'stream-offline',
      'wrong-channel',
      'wrong-game',
      'drops-inactive',
      'stalled-progress',
      'managed-tab-unavailable',
      'transport-disabled',
      'not-started',
      'stopped',
      'error',
    ].includes(typeof candidate === 'string' ? candidate : '');
  if (
    !isMode(mode) ||
    !isStatus(status) ||
    !isReason(reason) ||
    typeof value.isHealthy !== 'boolean' ||
    typeof value.consecutiveFailures !== 'number' ||
    !Number.isFinite(value.consecutiveFailures) ||
    typeof value.consecutiveStalls !== 'number' ||
    !Number.isFinite(value.consecutiveStalls) ||
    (value.progress !== null && (typeof value.progress !== 'number' || !Number.isFinite(value.progress))) ||
    typeof value.shouldFallback !== 'boolean' ||
    typeof value.checkedAt !== 'number' ||
    !Number.isFinite(value.checkedAt)
  ) {
    return null;
  }
  return {
    mode,
    isHealthy: value.isHealthy,
    status,
    reason,
    consecutiveFailures: value.consecutiveFailures,
    consecutiveStalls: value.consecutiveStalls,
    progress: value.progress,
    shouldFallback: value.shouldFallback,
    checkedAt: value.checkedAt,
  };
}

function nullableFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function normalizeCampaignSyncState(value: Record<string, unknown>): AppState['campaignSyncState'] {
  const candidate = isRecord(value.campaignSyncState) ? value.campaignSyncState : null;
  const lastAttemptAt = nullableFiniteNumber(candidate?.lastAttemptAt ?? value.lastDropsPageRefreshAttemptAt);
  const lastSuccessAt = nullableFiniteNumber(candidate?.lastSuccessAt ?? value.lastSuccessfulRefreshAt);
  const campaignCount = nullableFiniteNumber(
    candidate?.campaignCount ?? value.lastDropsPageRefreshCampaignCount,
  );
  const retryAttemptCount = nonNegativeInteger(candidate?.retryAttemptCount) ?? 0;
  const lastErrorKind = isActivationSyncErrorKind(candidate?.lastErrorKind) ? candidate.lastErrorKind : null;
  const common = { lastAttemptAt, lastSuccessAt, campaignCount, retryAttemptCount, lastErrorKind };
  const attemptDeadlineAt = nullableFiniteNumber(candidate?.attemptDeadlineAt);
  if (candidate?.status === 'syncing' && attemptDeadlineAt !== null) {
    return { status: 'syncing', ...common, nextRetryAt: null, attemptDeadlineAt };
  }
  if (candidate?.status === 'needs-session') {
    return { status: 'needs-session', ...common, nextRetryAt: null, attemptDeadlineAt: null };
  }
  const nextRetryAt = nullableFiniteNumber(candidate?.nextRetryAt);
  if (
    candidate?.status === 'retry-scheduled' &&
    typeof candidate.error === 'string' &&
    nextRetryAt !== null
  ) {
    return {
      status: 'retry-scheduled',
      ...common,
      retryAttemptCount: Math.max(1, retryAttemptCount),
      nextRetryAt,
      attemptDeadlineAt: null,
      error: candidate.error,
    };
  }
  if (candidate?.status === 'retry-failed' && typeof candidate.error === 'string') {
    return {
      status: 'retry-failed',
      ...common,
      retryAttemptCount: Math.max(1, retryAttemptCount),
      nextRetryAt: null,
      attemptDeadlineAt: null,
      error: candidate.error,
    };
  }
  return {
    status: 'idle',
    ...common,
    retryAttemptCount: 0,
    lastErrorKind: null,
    nextRetryAt: null,
    attemptDeadlineAt: null,
  };
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

function isActivationSyncErrorKind(value: unknown): value is AppState['campaignSyncState']['lastErrorKind'] {
  return (
    value === 'auth' ||
    value === 'session' ||
    value === 'integrity' ||
    value === 'network' ||
    value === 'rate-limit' ||
    value === 'invalid-response'
  );
}

export function normalizeTwitchSessionSyncState(
  value: Record<string, unknown>,
): AppState['twitchSessionSyncState'] {
  const candidate = isRecord(value.twitchSessionSyncState) ? value.twitchSessionSyncState : null;
  if (candidate?.status === 'ready') {
    return { status: 'ready', attempts: 0, nextRetryAt: null };
  }
  if (candidate?.status === 'unknown') {
    return { status: 'unknown', attempts: 0, nextRetryAt: null };
  }
  const attempts = nonNegativeInteger(candidate?.attempts);
  if (candidate?.status === 'retrying') {
    const nextRetryAt = nullableFiniteNumber(candidate.nextRetryAt);
    if (attempts !== null && attempts > 0 && nextRetryAt !== null) {
      return { status: 'retrying', attempts, nextRetryAt };
    }
    return { status: 'unknown', attempts: 0, nextRetryAt: null };
  }
  if (candidate?.status === 'blocked' && attempts !== null) {
    return { status: 'blocked', attempts, nextRetryAt: null };
  }

  const legacyAttempts = nonNegativeInteger(value.recoveryAttempts) ?? 0;
  if (value.isRunning === true && value.recoveryReason === 'sign-in-required') {
    return {
      status: 'retrying',
      attempts: Math.max(1, legacyAttempts),
      nextRetryAt: nullableFiniteNumber(value.recoveryBackoffUntil) ?? 0,
    };
  }
  if (value.lastStopReason === 'sign-in-required') {
    return { status: 'blocked', attempts: legacyAttempts, nextRetryAt: null };
  }
  return { status: 'unknown', attempts: 0, nextRetryAt: null };
}
