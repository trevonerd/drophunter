import type { AppState } from '../types/index.ts';

export interface TimingState {
  lastStreamRotationAt: number;
  streamValidationGraceUntil: number;
  invalidStreamChecks: number;
  noProgressRotationAttempts: number;
  twitchSessionLastAttemptAt: number;
  dropClaimRetryAtById: Record<string, number>;
  lastProgressAdvanceAt: number;
  lastTrackedProgress: number;
  lastTrackedMinutes: number;
  lastTrackedDropKey: string | null;
  apiConsecutiveFailures: number;
  apiBackoffUntil: number;
  integrityFallbackActive: boolean;
  integrityFallbackActiveUntil: number;
  recoveryBackoffUntil: number;
  lastRecoveryAttemptAt: number;
  stalledRecoveryAttempts: number;
  recoveryNotificationSent: boolean;
  lastHeartbeatAt: number;
}

export function createInitialTimingState(): TimingState {
  return {
    lastStreamRotationAt: 0,
    streamValidationGraceUntil: 0,
    invalidStreamChecks: 0,
    noProgressRotationAttempts: 0,
    twitchSessionLastAttemptAt: 0,
    dropClaimRetryAtById: {},
    lastProgressAdvanceAt: 0,
    lastTrackedProgress: -1,
    lastTrackedMinutes: -1,
    lastTrackedDropKey: null,
    apiConsecutiveFailures: 0,
    apiBackoffUntil: 0,
    integrityFallbackActive: false,
    integrityFallbackActiveUntil: 0,
    recoveryBackoffUntil: 0,
    lastRecoveryAttemptAt: 0,
    stalledRecoveryAttempts: 0,
    recoveryNotificationSent: false,
    lastHeartbeatAt: 0,
  };
}

export function normalizeTimingState(input: unknown, now = Date.now()): TimingState {
  const initial = createInitialTimingState();
  if (!input || typeof input !== 'object') {
    return initial;
  }

  const source = input as Partial<TimingState>;
  const integrityFallbackActiveUntil =
    typeof source.integrityFallbackActiveUntil === 'number' &&
    Number.isFinite(source.integrityFallbackActiveUntil)
      ? source.integrityFallbackActiveUntil
      : 0;
  const integrityFallbackActive =
    Boolean(source.integrityFallbackActive) && integrityFallbackActiveUntil > now;
  const recoveryBackoffUntil =
    typeof source.recoveryBackoffUntil === 'number' && Number.isFinite(source.recoveryBackoffUntil)
      ? source.recoveryBackoffUntil
      : 0;

  return {
    lastStreamRotationAt:
      typeof source.lastStreamRotationAt === 'number' && Number.isFinite(source.lastStreamRotationAt)
        ? source.lastStreamRotationAt
        : initial.lastStreamRotationAt,
    streamValidationGraceUntil:
      typeof source.streamValidationGraceUntil === 'number' &&
      Number.isFinite(source.streamValidationGraceUntil)
        ? source.streamValidationGraceUntil
        : initial.streamValidationGraceUntil,
    invalidStreamChecks:
      typeof source.invalidStreamChecks === 'number' && Number.isFinite(source.invalidStreamChecks)
        ? source.invalidStreamChecks
        : initial.invalidStreamChecks,
    noProgressRotationAttempts:
      typeof source.noProgressRotationAttempts === 'number' &&
      Number.isFinite(source.noProgressRotationAttempts)
        ? source.noProgressRotationAttempts
        : initial.noProgressRotationAttempts,
    twitchSessionLastAttemptAt:
      typeof source.twitchSessionLastAttemptAt === 'number' &&
      Number.isFinite(source.twitchSessionLastAttemptAt)
        ? source.twitchSessionLastAttemptAt
        : initial.twitchSessionLastAttemptAt,
    dropClaimRetryAtById:
      source.dropClaimRetryAtById && typeof source.dropClaimRetryAtById === 'object'
        ? source.dropClaimRetryAtById
        : initial.dropClaimRetryAtById,
    lastProgressAdvanceAt:
      typeof source.lastProgressAdvanceAt === 'number' && Number.isFinite(source.lastProgressAdvanceAt)
        ? source.lastProgressAdvanceAt
        : initial.lastProgressAdvanceAt,
    lastTrackedProgress:
      typeof source.lastTrackedProgress === 'number' && Number.isFinite(source.lastTrackedProgress)
        ? source.lastTrackedProgress
        : initial.lastTrackedProgress,
    lastTrackedMinutes:
      typeof source.lastTrackedMinutes === 'number' && Number.isFinite(source.lastTrackedMinutes)
        ? source.lastTrackedMinutes
        : initial.lastTrackedMinutes,
    lastTrackedDropKey:
      typeof source.lastTrackedDropKey === 'string' && source.lastTrackedDropKey.length > 0
        ? source.lastTrackedDropKey
        : initial.lastTrackedDropKey,
    apiConsecutiveFailures:
      typeof source.apiConsecutiveFailures === 'number' && Number.isFinite(source.apiConsecutiveFailures)
        ? source.apiConsecutiveFailures
        : initial.apiConsecutiveFailures,
    apiBackoffUntil:
      typeof source.apiBackoffUntil === 'number' && Number.isFinite(source.apiBackoffUntil)
        ? source.apiBackoffUntil
        : initial.apiBackoffUntil,
    integrityFallbackActive,
    integrityFallbackActiveUntil: integrityFallbackActive ? integrityFallbackActiveUntil : 0,
    recoveryBackoffUntil: recoveryBackoffUntil > now ? recoveryBackoffUntil : 0,
    lastRecoveryAttemptAt:
      typeof source.lastRecoveryAttemptAt === 'number' && Number.isFinite(source.lastRecoveryAttemptAt)
        ? source.lastRecoveryAttemptAt
        : initial.lastRecoveryAttemptAt,
    stalledRecoveryAttempts:
      typeof source.stalledRecoveryAttempts === 'number' && Number.isFinite(source.stalledRecoveryAttempts)
        ? source.stalledRecoveryAttempts
        : initial.stalledRecoveryAttempts,
    recoveryNotificationSent: Boolean(source.recoveryNotificationSent) && recoveryBackoffUntil > now,
    lastHeartbeatAt:
      typeof source.lastHeartbeatAt === 'number' && Number.isFinite(source.lastHeartbeatAt)
        ? source.lastHeartbeatAt
        : initial.lastHeartbeatAt,
  };
}

export function clearRotationMetadata(state: AppState): AppState {
  return {
    ...state,
    lastRotationReason: null,
    lastRotationAt: null,
  };
}

export type StartupResumePolicyResult = 'not-stale' | 'auto-resume' | 'paused-on-startup';

export interface StartupResumePolicyState {
  appState: AppState;
  lastHeartbeatAt: number;
  recoveryBackoffUntil: number;
  lastRecoveryAttemptAt: number;
  stalledRecoveryAttempts: number;
  recoveryNotificationSent: boolean;
}

export function applyStartupResumePolicy(
  state: StartupResumePolicyState,
  now: number,
  staleThresholdMs: number,
): StartupResumePolicyResult {
  const isStaleStartup =
    state.appState.isRunning &&
    !state.appState.isPaused &&
    state.lastHeartbeatAt > 0 &&
    now - state.lastHeartbeatAt > staleThresholdMs;

  if (!isStaleStartup) {
    return 'not-stale';
  }

  if (state.appState.autoResumeOnStartup) {
    return 'auto-resume';
  }

  state.appState = {
    ...state.appState,
    isPaused: true,
    tabId: null,
    activeStreamer: null,
    recoveryReason: null,
    recoveryBackoffUntil: null,
    recoveryAttempts: null,
    resumedFromCrash: null,
  };
  state.recoveryBackoffUntil = 0;
  state.lastRecoveryAttemptAt = 0;
  state.stalledRecoveryAttempts = 0;
  state.recoveryNotificationSent = false;

  return 'paused-on-startup';
}

export function shouldCloseManagedTab(windowTabCount: number | null | undefined): boolean {
  return typeof windowTabCount === 'number' && Number.isFinite(windowTabCount) && windowTabCount > 1;
}
