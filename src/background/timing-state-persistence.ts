import { browser } from '../shared/browser-api.ts';
import { TIMING_SAVE_DEBOUNCE_MS, TIMING_STATE_KEY } from './constants.ts';
import { logWarn } from './logging.ts';
import { normalizeTimingState, type ServiceWorkerState, type TimingState } from './runtime-state.ts';

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveResolvers: Array<() => void> = [];
const debounceMs = Math.max(0, TIMING_SAVE_DEBOUNCE_MS - 100);
let testDebounceMs: number | null = null;

function resolvePendingSaves() {
  const resolvers = saveResolvers;
  saveResolvers = [];
  for (const resolve of resolvers) resolve();
}

export function clearPendingTimingStateSaveForTests() {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  resolvePendingSaves();
}

export function setTimingSaveDebounceMsForTests(delayMs: number | null) {
  if (delayMs === null) {
    clearPendingTimingStateSaveForTests();
    testDebounceMs = null;
    return;
  }
  testDebounceMs = Math.max(0, delayMs);
}

function createTimingState(state: ServiceWorkerState): TimingState {
  return {
    lastStreamRotationAt: state.lastStreamRotationAt,
    streamValidationGraceUntil: state.streamValidationGraceUntil,
    invalidStreamChecks: state.invalidStreamChecks,
    noProgressRotationAttempts: state.noProgressRotationAttempts,
    twitchSessionLastAttemptAt: state.twitchSessionLastAttemptAt,
    lastInventoryRefreshAt: state.lastInventoryRefreshAt,
    dropClaimRetryAtById: Object.fromEntries(state.dropClaimRetryAtById),
    lastProgressAdvanceAt: state.lastProgressAdvanceAt,
    lastTrackedProgress: state.lastTrackedProgress,
    lastTrackedMinutes: state.lastTrackedMinutes,
    lastTrackedDropKey: state.lastTrackedDropKey,
    apiConsecutiveFailures: state.apiConsecutiveFailures,
    apiBackoffUntil: state.apiBackoffUntil,
    integrityFallbackActive: state.integrityFallbackActive,
    integrityFallbackActiveUntil: state.integrityFallbackActiveUntil,
    recoveryBackoffUntil: state.recoveryBackoffUntil,
    lastRecoveryAttemptAt: state.lastRecoveryAttemptAt,
    stalledRecoveryAttempts: state.stalledRecoveryAttempts,
    recoveryNotificationSent: state.recoveryNotificationSent,
    lastHeartbeatAt: state.lastHeartbeatAt,
    lastLifecycleCheckAt: state.lastLifecycleCheckAt,
    offlineChecks: state.offlineChecks,
    avoidStreamerName: state.avoidStreamerName,
    cachedCampaignChannelsMap: state.cachedCampaignChannelsMap,
    previousAllDropsCount: state.previousAllDropsCount,
    unverifiableRewardsByKey: state.unverifiableRewardsByKey,
  };
}

export async function saveTimingState(state: ServiceWorkerState) {
  return new Promise<void>((resolve) => {
    saveResolvers.push(resolve);
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      try {
        await browser.storage.local
          .set({ [TIMING_STATE_KEY]: createTimingState(state) })
          .catch(() => undefined);
      } catch {
        // Browser storage can be unavailable after extension/test teardown.
      } finally {
        resolvePendingSaves();
      }
    }, testDebounceMs ?? debounceMs);
  });
}

export async function loadTimingState(state: ServiceWorkerState) {
  try {
    const result = await browser.storage.local.get([TIMING_STATE_KEY]);
    const saved = normalizeTimingState(result[TIMING_STATE_KEY]);
    Object.assign(state, {
      lastStreamRotationAt: saved.lastStreamRotationAt,
      streamValidationGraceUntil: saved.streamValidationGraceUntil,
      invalidStreamChecks: saved.invalidStreamChecks,
      noProgressRotationAttempts: saved.noProgressRotationAttempts,
      twitchSessionLastAttemptAt: saved.twitchSessionLastAttemptAt,
      lastInventoryRefreshAt: saved.lastInventoryRefreshAt,
      lastProgressAdvanceAt: saved.lastProgressAdvanceAt,
      lastTrackedProgress: saved.lastTrackedProgress,
      lastTrackedMinutes: saved.lastTrackedMinutes,
      lastTrackedDropKey: saved.lastTrackedDropKey,
      apiConsecutiveFailures: saved.apiConsecutiveFailures,
      apiBackoffUntil: saved.apiBackoffUntil,
      integrityFallbackActive: saved.integrityFallbackActive,
      integrityFallbackActiveUntil: saved.integrityFallbackActiveUntil,
      recoveryBackoffUntil: saved.recoveryBackoffUntil,
      lastRecoveryAttemptAt: saved.lastRecoveryAttemptAt,
      stalledRecoveryAttempts: saved.stalledRecoveryAttempts,
      recoveryNotificationSent: saved.recoveryNotificationSent,
      lastHeartbeatAt: saved.lastHeartbeatAt,
      lastLifecycleCheckAt: saved.lastLifecycleCheckAt,
      offlineChecks: saved.offlineChecks,
      avoidStreamerName: saved.avoidStreamerName,
      cachedCampaignChannelsMap: saved.cachedCampaignChannelsMap,
      previousAllDropsCount: saved.previousAllDropsCount,
      unverifiableRewardsByKey: saved.unverifiableRewardsByKey,
    });
    state.dropClaimRetryAtById.clear();
    for (const [id, at] of Object.entries(saved.dropClaimRetryAtById)) state.dropClaimRetryAtById.set(id, at);
  } catch (error) {
    logWarn('Failed to load timing state from local storage:', String(error));
  }
}
