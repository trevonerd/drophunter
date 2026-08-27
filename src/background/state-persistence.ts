import { normalizeStoredAppState } from '../shared/app-state-sync.ts';
import { browser } from '../shared/browser-api.ts';
import type { AppState, TwitchDrop } from '../types';
import { DROPS_SNAPSHOT_CACHE_KEY, GAMES_CACHE_TTL_MS, LAST_ACTIVITY_AT_KEY } from './constants';
import { logDebug, logWarn } from './logging';
import { pickDurablePreferences } from './runtime-state';
import type { ServiceWorkerState } from './runtime-state.ts';
import type { TwitchSession } from './twitch-api/types';

export {
  clearPendingTimingStateSaveForTests,
  loadTimingState,
  saveTimingState,
  setTimingSaveDebounceMsForTests,
} from './timing-state-persistence.ts';

export function sessionDebugSummary(session: TwitchSession | null) {
  if (!session) {
    return { available: false };
  }
  return {
    available: true,
    hasUserId: Boolean(session.userId),
    hasOAuthToken: Boolean(session.oauthToken),
    hasIntegrity: Boolean(session.clientIntegrity),
    hasDeviceId: Boolean(session.deviceId),
    hasUuid: Boolean(session.uuid),
    hasClientId: Boolean(session.clientId),
  };
}

export async function markActivity(state: ServiceWorkerState, reason: string) {
  state.lastActivityAt = Date.now();
  await browser.storage.local.set({ [LAST_ACTIVITY_AT_KEY]: state.lastActivityAt }).catch(() => undefined);
  logDebug('Activity marked', { reason, lastActivityAt: state.lastActivityAt });
}

export function shouldRefreshGamesCache(state: ServiceWorkerState, force = false): boolean {
  if (force) return true;
  return Date.now() - state.lastGamesCacheRefreshAt >= GAMES_CACHE_TTL_MS;
}

export function broadcastStateUpdate(appState: AppState) {
  browser.runtime
    .sendMessage({
      type: 'UPDATE_STATE',
      payload: appState,
    })
    .catch(() => undefined);

  if (appState.currentDrop && appState.isRunning) {
    browser.action.setBadgeText({ text: `${appState.currentDrop.progress}%` });
    browser.action.setBadgeBackgroundColor({ color: '#9146FF' });
  } else if (appState.isRunning) {
    browser.action.setBadgeText({ text: '...' });
    browser.action.setBadgeBackgroundColor({ color: '#9146FF' });
  } else {
    browser.action.setBadgeText({ text: '' });
  }
}

// appState is a single long-lived object mutated in place across many
// modules (not always reassigned), so reference equality can't detect
// no-op saves. A content signature lets us skip the broadcast/badge work
// (cross-context messaging) on saveState calls where nothing changed,
// without touching the storage write itself.
let lastBroadcastAppStateSignature: string | null = null;

export function resetSaveStateBroadcastCacheForTests() {
  lastBroadcastAppStateSignature = null;
}

export async function saveState(state: ServiceWorkerState) {
  await browser.storage.local.set({
    appState: state.appState,
    [DROPS_SNAPSHOT_CACHE_KEY]: state.cachedDropsSnapshot,
  });
  const signature = JSON.stringify(state.appState);
  if (signature !== lastBroadcastAppStateSignature) {
    lastBroadcastAppStateSignature = signature;
    broadcastStateUpdate(state.appState);
  }
}

export interface LoadStateCallbacks {
  onLoadTimingState: (state: ServiceWorkerState) => Promise<void>;
  onEnforceInactivityReset: (trigger: string) => Promise<boolean>;
}

export interface LoadStateDeps {
  sanitizeTwitchSession: (raw: unknown) => TwitchSession | null;
  sessionDebugSummary: (session: TwitchSession | null) => Record<string, unknown>;
  createInitialState: () => AppState;
  clearRotationMetadata: (state: AppState) => AppState;
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
    const result = await browser.storage.local.get([
      'appState',
      deps.TWITCH_SESSION_STORAGE_KEY,
      deps.DROPS_SNAPSHOT_CACHE_KEY,
      deps.LAST_ACTIVITY_AT_KEY,
    ]);
    if (result.appState) {
      state.appState = normalizeStoredAppState(result.appState);
      if (!Array.isArray(state.appState.queue)) {
        state.appState.queue = [];
      }
      if (state.appState.dropsPageRefreshInProgress) {
        state.appState.dropsPageRefreshInProgress = false;
        await browser.storage.local.set({ appState: state.appState }).catch(() => undefined);
      }
    }
    state.twitchSessionCache = deps.sanitizeTwitchSession(result[deps.TWITCH_SESSION_STORAGE_KEY]);
    const storedDropsSnapshot = result[deps.DROPS_SNAPSHOT_CACHE_KEY];
    state.cachedDropsSnapshot = Array.isArray(storedDropsSnapshot)
      ? (storedDropsSnapshot as TwitchDrop[])
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
    if (state.appState.isRunning && !state.appState.isPaused && state.appState.tabId) {
      state.streamValidationGraceUntil = Date.now() + deps.STREAM_VALIDATION_GRACE_MS;
      state.noProgressRotationAttempts = 0;
    }
  } catch (error) {
    logWarn('Error loading state:', String(error));
  }
}

export interface ResetStateForInactivityCallbacks {
  onStopMonitoring: () => void;
  onClearRotationMetadata: (state: AppState) => AppState;
  onResetStreamTrackingState: (state: ServiceWorkerState) => void;
  onSaveTimingState: (state: ServiceWorkerState) => Promise<void>;
  onBroadcastStateUpdate: (appState: AppState) => void;
}

export async function resetStateForInactivity(
  state: ServiceWorkerState,
  _trigger: string,
  _idleForMs: number,
  callbacks: ResetStateForInactivityCallbacks,
  deps: {
    createInitialState: () => AppState;
    DROPS_SNAPSHOT_CACHE_KEY: string;
    LAST_ACTIVITY_AT_KEY: string;
    TIMING_STATE_KEY: string;
  },
): Promise<void> {
  const persistentState = pickDurablePreferences(state.appState);
  callbacks.onStopMonitoring();
  state.appState = callbacks.onClearRotationMetadata({
    ...deps.createInitialState(),
    ...persistentState,
  });
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
  state.unverifiableRewardsByKey = {};
  state.lastActivityAt = Date.now();
  await browser.storage.local
    .set({
      appState: state.appState,
      [deps.DROPS_SNAPSHOT_CACHE_KEY]: [],
      [deps.LAST_ACTIVITY_AT_KEY]: state.lastActivityAt,
    })
    .catch(() => undefined);
  await Promise.all([
    browser.storage.local.remove(deps.TIMING_STATE_KEY).catch(() => undefined),
    browser.storage.session.remove(deps.TIMING_STATE_KEY).catch(() => undefined),
  ]);
  await callbacks.onSaveTimingState(state);
  callbacks.onBroadcastStateUpdate(state.appState);
}
