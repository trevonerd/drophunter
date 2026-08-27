import { parseUnverifiableRewardKey } from './unverifiable-reward-key.ts';

export interface UnverifiableRewardMarker {
  progress: number;
  currentMinutes: number;
  markedAt: number;
}

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
  lastLifecycleCheckAt: number;
  offlineChecks: number;
  avoidStreamerName: string | null;
  cachedCampaignChannelsMap: Record<string, string[] | null>;
  previousAllDropsCount: number;
  unverifiableRewardsByKey: Record<string, UnverifiableRewardMarker>;
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
    lastLifecycleCheckAt: 0,
    offlineChecks: 0,
    avoidStreamerName: null,
    cachedCampaignChannelsMap: {},
    previousAllDropsCount: 0,
    unverifiableRewardsByKey: {},
  };
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function isUnverifiableRewardMarker(input: unknown): input is UnverifiableRewardMarker {
  return (
    isRecord(input) &&
    typeof input.progress === 'number' &&
    Number.isFinite(input.progress) &&
    input.progress >= 0 &&
    input.progress <= 100 &&
    typeof input.currentMinutes === 'number' &&
    Number.isFinite(input.currentMinutes) &&
    input.currentMinutes >= 0 &&
    typeof input.markedAt === 'number' &&
    Number.isFinite(input.markedAt) &&
    input.markedAt >= 0
  );
}

function normalizeUnverifiableRewardsByKey(input: unknown): Record<string, UnverifiableRewardMarker> {
  if (!isRecord(input)) return {};
  const result: Record<string, UnverifiableRewardMarker> = {};
  for (const [key, value] of Object.entries(input)) {
    if (parseUnverifiableRewardKey(key) === null || !isUnverifiableRewardMarker(value)) continue;
    result[key] = {
      progress: value.progress,
      currentMinutes: value.currentMinutes,
      markedAt: value.markedAt,
    };
  }
  return result;
}

function normalizeCachedCampaignChannelsMap(input: unknown): Record<string, string[] | null> {
  if (!isRecord(input)) return {};
  const result: Record<string, string[] | null> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === null) result[key] = null;
    else if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) result[key] = value;
  }
  return result;
}

export function normalizeTimingState(input: unknown, now = Date.now()): TimingState {
  const initial = createInitialTimingState();
  if (!isRecord(input)) return initial;
  const source = input;
  const fallbackUntil = finiteNumber(source.integrityFallbackActiveUntil, 0);
  const fallbackActive = Boolean(source.integrityFallbackActive) && fallbackUntil > now;
  const recoveryUntil = finiteNumber(source.recoveryBackoffUntil, 0);
  return {
    lastStreamRotationAt: finiteNumber(source.lastStreamRotationAt, initial.lastStreamRotationAt),
    streamValidationGraceUntil: finiteNumber(
      source.streamValidationGraceUntil,
      initial.streamValidationGraceUntil,
    ),
    invalidStreamChecks: finiteNumber(source.invalidStreamChecks, initial.invalidStreamChecks),
    noProgressRotationAttempts: finiteNumber(
      source.noProgressRotationAttempts,
      initial.noProgressRotationAttempts,
    ),
    twitchSessionLastAttemptAt: finiteNumber(
      source.twitchSessionLastAttemptAt,
      initial.twitchSessionLastAttemptAt,
    ),
    dropClaimRetryAtById: isRecord(source.dropClaimRetryAtById)
      ? (source.dropClaimRetryAtById as Record<string, number>)
      : {},
    lastProgressAdvanceAt: finiteNumber(source.lastProgressAdvanceAt, initial.lastProgressAdvanceAt),
    lastTrackedProgress: finiteNumber(source.lastTrackedProgress, initial.lastTrackedProgress),
    lastTrackedMinutes: finiteNumber(source.lastTrackedMinutes, initial.lastTrackedMinutes),
    lastTrackedDropKey:
      typeof source.lastTrackedDropKey === 'string' && source.lastTrackedDropKey.length > 0
        ? source.lastTrackedDropKey
        : null,
    apiConsecutiveFailures: finiteNumber(source.apiConsecutiveFailures, initial.apiConsecutiveFailures),
    apiBackoffUntil: finiteNumber(source.apiBackoffUntil, initial.apiBackoffUntil),
    integrityFallbackActive: fallbackActive,
    integrityFallbackActiveUntil: fallbackActive ? fallbackUntil : 0,
    recoveryBackoffUntil: recoveryUntil > now ? recoveryUntil : 0,
    lastRecoveryAttemptAt: finiteNumber(source.lastRecoveryAttemptAt, initial.lastRecoveryAttemptAt),
    stalledRecoveryAttempts: finiteNumber(source.stalledRecoveryAttempts, initial.stalledRecoveryAttempts),
    recoveryNotificationSent: Boolean(source.recoveryNotificationSent) && recoveryUntil > now,
    lastHeartbeatAt: finiteNumber(source.lastHeartbeatAt, initial.lastHeartbeatAt),
    lastLifecycleCheckAt: finiteNumber(source.lastLifecycleCheckAt, initial.lastLifecycleCheckAt),
    offlineChecks: finiteNumber(source.offlineChecks, initial.offlineChecks),
    avoidStreamerName:
      typeof source.avoidStreamerName === 'string' && source.avoidStreamerName.length > 0
        ? source.avoidStreamerName
        : null,
    cachedCampaignChannelsMap: normalizeCachedCampaignChannelsMap(source.cachedCampaignChannelsMap),
    previousAllDropsCount: finiteNumber(source.previousAllDropsCount, initial.previousAllDropsCount),
    unverifiableRewardsByKey: normalizeUnverifiableRewardsByKey(source.unverifiableRewardsByKey),
  };
}
