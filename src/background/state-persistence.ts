import { AppState } from '../types';
import {
  DROPS_SNAPSHOT_CACHE_KEY,
  GAMES_CACHE_TTL_MS,
  LAST_ACTIVITY_AT_KEY,
  TIMING_STATE_KEY,
} from './constants';
import { logDebug, logWarn } from './logging';
import { normalizeTimingState, TimingState } from './runtime-state';
import type { ServiceWorkerState } from './service-worker';
import { TwitchSession } from './twitch-api/types';

export function sessionDebugSummary(session: TwitchSession | null) {
  if (!session) {
    return { available: false };
  }
  return {
    available: true,
    userId: session.userId || null,
    oauthTokenLength: session.oauthToken ? session.oauthToken.length : 0,
    hasIntegrity: Boolean(session.clientIntegrity),
    deviceIdSuffix: session.deviceId ? session.deviceId.slice(-6) : null,
    uuid: session.uuid || null,
    clientId: session.clientId || null,
  };
}

export async function markActivity(state: ServiceWorkerState, reason: string) {
  state.lastActivityAt = Date.now();
  await chrome.storage.local.set({ [LAST_ACTIVITY_AT_KEY]: state.lastActivityAt }).catch(() => undefined);
  logDebug('Activity marked', { reason, lastActivityAt: state.lastActivityAt });
}

export async function saveTimingState(state: ServiceWorkerState) {
  const timing: TimingState = {
    lastStreamRotationAt: state.lastStreamRotationAt,
    streamValidationGraceUntil: state.streamValidationGraceUntil,
    invalidStreamChecks: state.invalidStreamChecks,
    noProgressRotationAttempts: state.noProgressRotationAttempts,
    twitchSessionLastAttemptAt: state.twitchSessionLastAttemptAt,
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
  };
  await chrome.storage.session.set({ [TIMING_STATE_KEY]: timing }).catch(() => undefined);
}

export async function loadTimingState(state: ServiceWorkerState) {
  try {
    const result = await chrome.storage.session.get([TIMING_STATE_KEY]);
    const saved = normalizeTimingState(result[TIMING_STATE_KEY]);
    state.lastStreamRotationAt = saved.lastStreamRotationAt;
    state.streamValidationGraceUntil = saved.streamValidationGraceUntil;
    state.invalidStreamChecks = saved.invalidStreamChecks;
    state.noProgressRotationAttempts = saved.noProgressRotationAttempts;
    state.twitchSessionLastAttemptAt = saved.twitchSessionLastAttemptAt;
    if (saved.dropClaimRetryAtById) {
      state.dropClaimRetryAtById.clear();
      for (const [id, at] of Object.entries(saved.dropClaimRetryAtById)) {
        state.dropClaimRetryAtById.set(id, at);
      }
    }
    state.lastProgressAdvanceAt = saved.lastProgressAdvanceAt;
    state.lastTrackedProgress = saved.lastTrackedProgress;
    state.lastTrackedMinutes = saved.lastTrackedMinutes;
    state.lastTrackedDropKey = saved.lastTrackedDropKey;
    state.apiConsecutiveFailures = saved.apiConsecutiveFailures;
    state.apiBackoffUntil = saved.apiBackoffUntil;
    state.integrityFallbackActive = saved.integrityFallbackActive;
    state.integrityFallbackActiveUntil = saved.integrityFallbackActiveUntil;
    state.recoveryBackoffUntil = saved.recoveryBackoffUntil;
    state.lastRecoveryAttemptAt = saved.lastRecoveryAttemptAt;
    state.stalledRecoveryAttempts = saved.stalledRecoveryAttempts;
    state.recoveryNotificationSent = saved.recoveryNotificationSent;
  } catch (error) {
    logWarn('Failed to load timing state from session storage:', String(error));
  }
}

export function shouldRefreshGamesCache(state: ServiceWorkerState, force = false): boolean {
  if (force) return true;
  return Date.now() - state.lastGamesCacheRefreshAt >= GAMES_CACHE_TTL_MS;
}

export function broadcastStateUpdate(appState: AppState) {
  chrome.runtime
    .sendMessage({
      type: 'UPDATE_STATE',
      payload: appState,
    })
    .catch(() => undefined);

  if (appState.currentDrop && appState.isRunning) {
    chrome.action.setBadgeText({ text: `${appState.currentDrop.progress}%` });
    chrome.action.setBadgeBackgroundColor({ color: '#9146FF' });
  } else if (appState.isRunning) {
    chrome.action.setBadgeText({ text: '...' });
    chrome.action.setBadgeBackgroundColor({ color: '#9146FF' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

export async function saveState(state: ServiceWorkerState) {
  await chrome.storage.local.set({
    appState: state.appState,
    [DROPS_SNAPSHOT_CACHE_KEY]: state.cachedDropsSnapshot,
  });
  broadcastStateUpdate(state.appState);
}

export interface LoadStateCallbacks {
  onLoadTimingState: (state: ServiceWorkerState) => Promise<void>;
  onEnforceInactivityReset: (trigger: string) => Promise<boolean>;
  onStartMonitoring: () => void;
}

export interface LoadStateDeps {
  sanitizeTwitchSession: (raw: unknown) => any | null;
  sessionDebugSummary: (session: any | null) => any;
  createInitialState: () => any;
  clearRotationMetadata: (state: any) => any;
  TWITCH_SESSION_STORAGE_KEY: string;
  DROPS_SNAPSHOT_CACHE_KEY: string;
  LAST_ACTIVITY_AT_KEY: string;
  TIMING_STATE_KEY: string;
  STREAM_VALIDATION_GRACE_MS: number;
}

export async function loadState(
  state: ServiceWorkerState,
  callbacks: LoadStateCallbacks,
  deps: LoadStateDeps,
): Promise<void> {
  try {
    const result = await chrome.storage.local.get([
      'appState',
      deps.TWITCH_SESSION_STORAGE_KEY,
      deps.DROPS_SNAPSHOT_CACHE_KEY,
      deps.LAST_ACTIVITY_AT_KEY,
    ]);
    if (result.appState) {
      state.appState = { ...deps.createInitialState(), ...result.appState };
      if (!Array.isArray(state.appState.queue)) {
        state.appState.queue = [];
      }
    }
    state.twitchSessionCache = deps.sanitizeTwitchSession(result[deps.TWITCH_SESSION_STORAGE_KEY] as unknown);
    state.cachedDropsSnapshot = Array.isArray(result[deps.DROPS_SNAPSHOT_CACHE_KEY])
      ? (result[deps.DROPS_SNAPSHOT_CACHE_KEY] as any[])
      : [];
    state.lastActivityAt =
      typeof result[deps.LAST_ACTIVITY_AT_KEY] === 'number'
        ? (result[deps.LAST_ACTIVITY_AT_KEY] as number)
        : 0;
    await callbacks.onLoadTimingState(state);
    const resetForInactivity = await callbacks.onEnforceInactivityReset('loadState');
    if (resetForInactivity) {
      return;
    }
    if (state.appState.isRunning && !state.appState.isPaused) {
      if (state.appState.tabId) {
        state.streamValidationGraceUntil = Date.now() + deps.STREAM_VALIDATION_GRACE_MS;
      }
      state.noProgressRotationAttempts = 0;
      callbacks.onStartMonitoring();
    }
  } catch (error) {
    console.warn('Error loading state:', String(error));
  }
}

export interface ResetStateForInactivityCallbacks {
  onStopMonitoring: () => void;
  onClearRotationMetadata: (state: any) => any;
  onResetStreamTrackingState: (state: ServiceWorkerState) => void;
  onSaveTimingState: (state: ServiceWorkerState) => Promise<void>;
  onBroadcastStateUpdate: (appState: any) => void;
}

export async function resetStateForInactivity(
  state: ServiceWorkerState,
  _trigger: string,
  _idleForMs: number,
  callbacks: ResetStateForInactivityCallbacks,
  deps: {
    createInitialState: () => any;
    DROPS_SNAPSHOT_CACHE_KEY: string;
    LAST_ACTIVITY_AT_KEY: string;
    TIMING_STATE_KEY: string;
  },
): Promise<void> {
  callbacks.onStopMonitoring();
  state.appState = callbacks.onClearRotationMetadata(deps.createInitialState());
  state.cachedDropsSnapshot = [];
  state.cachedCampaignChannelsMap = {};
  callbacks.onResetStreamTrackingState(state);
  state.lastFullRefreshAt = 0;
  state.lastGamesCacheRefreshAt = 0;
  state.dropClaimRetryAtById.clear();
  state.apiConsecutiveFailures = 0;
  state.apiBackoffUntil = 0;
  state.integrityFallbackActive = false;
  state.integrityFallbackActiveUntil = 0;
  state.recoveryBackoffUntil = 0;
  state.lastRecoveryAttemptAt = 0;
  state.stalledRecoveryAttempts = 0;
  state.recoveryNotificationSent = false;
  state.lastActivityAt = Date.now();
  await chrome.storage.local
    .set({
      appState: state.appState,
      [deps.DROPS_SNAPSHOT_CACHE_KEY]: [],
      [deps.LAST_ACTIVITY_AT_KEY]: state.lastActivityAt,
    })
    .catch(() => undefined);
  await chrome.storage.session.remove([deps.TIMING_STATE_KEY]).catch(() => undefined);
  await callbacks.onSaveTimingState(state);
  callbacks.onBroadcastStateUpdate(state.appState);
}
