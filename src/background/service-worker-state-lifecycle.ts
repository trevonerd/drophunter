import { browser } from '../shared/browser-api.ts';
import { clearRecoveryStatus } from '../shared/runtime-status.ts';
import { getFarmableTwitchChannelNameFromUrl } from '../shared/twitch-url.ts';
import { createInitialState } from '../shared/utils.ts';
import {
  CRASH_DETECTION_THRESHOLD_MS,
  DROPS_SNAPSHOT_CACHE_KEY,
  LAST_ACTIVITY_AT_KEY,
  RESUME_RECOVERY_GRACE_MS,
  STREAM_VALIDATION_GRACE_MS,
  TIMING_STATE_KEY,
  TWITCH_SESSION_STORAGE_KEY,
} from './constants.ts';
import { logInfo } from './logging.ts';
import {
  applyExtensionUpdateStateTransition,
  applyStartupResumePolicy,
  clearRotationMetadata,
  type ServiceWorkerState,
} from './runtime-state.ts';
import { resetStreamTrackingState } from './session-lifecycle.ts';
import {
  broadcastStateUpdate,
  loadState as loadStateExt,
  loadTimingState,
  markActivity,
  resetStateForInactivity as resetStateForInactivityExt,
  saveState,
  saveTimingState,
  sessionDebugSummary,
} from './state-persistence.ts';
import { initializeAfterStorageMigration } from './storage-migrations.ts';
import { sanitizeTwitchSession } from './twitch-api/types.ts';

const INACTIVITY_RESET_MS = 3 * 24 * 60 * 60_000;

interface StateLifecycleFarmingSession {
  readonly acquireStreamerForSelectedGame: () => Promise<boolean>;
  readonly startMonitoring: () => void;
  readonly stopMonitoring: () => void;
}

interface ServiceWorkerStateLifecycleDependencies {
  readonly getFarmingSession: () => StateLifecycleFarmingSession;
  readonly initializeFarmingAutomation?: () => Promise<void>;
}

export function createServiceWorkerStateLifecycle(
  state: ServiceWorkerState,
  dependencies: ServiceWorkerStateLifecycleDependencies,
) {
  let initPromise: Promise<void> | null = null;

  async function resetForInactivity(trigger: string, idleForMs: number): Promise<void> {
    logInfo('Resetting state after inactivity', {
      trigger,
      idleForMs,
      wasRunning: state.appState.isRunning,
      wasPaused: state.appState.isPaused,
    });
    const farmingSession = dependencies.getFarmingSession();
    await resetStateForInactivityExt(
      state,
      trigger,
      idleForMs,
      {
        onStopMonitoring: farmingSession.stopMonitoring,
        onClearRotationMetadata: clearRotationMetadata,
        onResetStreamTrackingState: resetStreamTrackingState,
        onSaveTimingState: saveTimingState,
        onBroadcastStateUpdate: broadcastStateUpdate,
      },
      { createInitialState, DROPS_SNAPSHOT_CACHE_KEY, LAST_ACTIVITY_AT_KEY, TIMING_STATE_KEY },
    );
  }

  async function enforceInactivityReset(trigger: string): Promise<boolean> {
    const reference = Math.max(state.lastActivityAt, state.appState.lastSuccessfulRefreshAt ?? 0);
    if (!reference) {
      await markActivity(state, `${trigger}:bootstrap`);
      return false;
    }
    const idleForMs = Date.now() - reference;
    if (idleForMs < INACTIVITY_RESET_MS) return false;
    await resetForInactivity(trigger, idleForMs);
    return true;
  }

  async function trackActivity(reason: string): Promise<void> {
    await enforceInactivityReset(`activity:${reason}`);
    await markActivity(state, reason);
  }

  async function handleExtensionUpdate(): Promise<void> {
    applyExtensionUpdateStateTransition(state);
    await browser.storage.local.remove([DROPS_SNAPSHOT_CACHE_KEY, TIMING_STATE_KEY, 'twitchIntegrity']);
    await browser.storage.session.remove([TIMING_STATE_KEY]).catch(() => undefined);
    await browser.storage.local.set({ appState: state.appState, [DROPS_SNAPSHOT_CACHE_KEY]: [] });
    broadcastStateUpdate(state.appState);
  }

  async function canResumeWithExistingManagedTab(): Promise<boolean> {
    const tabId = state.appState.tabId;
    if (!tabId) return false;
    const tab = await browser.tabs.get(tabId).catch(() => null);
    return Boolean(tab?.id && getFarmableTwitchChannelNameFromUrl(tab.url));
  }

  async function handleStartupResumePolicy(): Promise<boolean> {
    const now = Date.now();
    const policy = applyStartupResumePolicy(
      state,
      now,
      CRASH_DETECTION_THRESHOLD_MS,
      RESUME_RECOVERY_GRACE_MS,
    );
    const farmingSession = dependencies.getFarmingSession();
    if (policy === 'resume-recovery') {
      logInfo('SW recycled during active no-tab recovery; resuming monitoring without reset', {
        recoveryReason: state.appState.recoveryReason,
        recoveryAttempts: state.appState.recoveryAttempts,
        secondsAgo: Math.round((now - state.lastHeartbeatAt) / 1000),
      });
      farmingSession.startMonitoring();
      return true;
    }
    if (policy === 'paused-on-startup') {
      logInfo('Long browser restart detected; leaving farming paused', {
        secondsAgo: Math.round((now - state.lastHeartbeatAt) / 1000),
      });
      farmingSession.stopMonitoring();
      await saveState(state);
      await saveTimingState(state);
      return true;
    }
    if (policy !== 'auto-resume') return false;
    const keptExistingTab = await canResumeWithExistingManagedTab();
    logInfo(
      keptExistingTab
        ? 'Long browser restart detected; resuming with existing Twitch tab'
        : 'Long browser restart detected; reopening streamer',
      { secondsAgo: Math.round((now - state.lastHeartbeatAt) / 1000) },
    );
    state.appState.resumedFromCrash = now;
    state.lastProgressAdvanceAt = now;
    state.noProgressRotationAttempts = 0;
    state.recoveryBackoffUntil = 0;
    state.stalledRecoveryAttempts = 0;
    state.recoveryNotificationSent = false;
    state.appState = clearRecoveryStatus(state.appState);
    state.streamValidationGraceUntil = now + STREAM_VALIDATION_GRACE_MS;
    if (!keptExistingTab) {
      state.appState.tabId = null;
      state.appState.activeStreamer = null;
    }
    await saveState(state);
    await saveTimingState(state);
    if (!keptExistingTab && state.appState.selectedGame) {
      await farmingSession.acquireStreamerForSelectedGame();
    }
    farmingSession.startMonitoring();
    return true;
  }

  async function loadState(): Promise<void> {
    await loadStateExt(
      state,
      { onLoadTimingState: loadTimingState, onEnforceInactivityReset: enforceInactivityReset },
      {
        sanitizeTwitchSession,
        sessionDebugSummary,
        createInitialState,
        clearRotationMetadata,
        TWITCH_SESSION_STORAGE_KEY,
        DROPS_SNAPSHOT_CACHE_KEY,
        LAST_ACTIVITY_AT_KEY,
        TIMING_STATE_KEY,
        STREAM_VALIDATION_GRACE_MS,
      },
    );
    const handledStartupPolicy = await handleStartupResumePolicy();
    if (!handledStartupPolicy && state.appState.isRunning && !state.appState.isPaused) {
      dependencies.getFarmingSession().startMonitoring();
    }
  }

  async function ensureStateHydratedForCache(): Promise<void> {
    const appState = state.appState;
    if (
      appState.availableGames.length > 0 ||
      appState.queue.length > 0 ||
      appState.selectedGame ||
      appState.isRunning
    )
      return;
    await loadState();
  }

  function beginInitialization(afterLoad: () => Promise<void>): Promise<void> {
    initPromise = initializeAfterStorageMigration(loadState).then(async () => {
      await dependencies.initializeFarmingAutomation?.();
      await afterLoad();
    });
    return initPromise;
  }

  async function awaitInitialization(): Promise<void> {
    if (initPromise) await initPromise;
  }

  async function markDropsRefreshNoticeSeen(payload?: { readonly seenAt?: number }) {
    await awaitInitialization();
    const completedAt = state.appState.lastDropsPageRefreshCompletedAt ?? 0;
    const requestedSeenAt =
      typeof payload?.seenAt === 'number' && Number.isFinite(payload.seenAt) ? payload.seenAt : completedAt;
    const seenAt = Math.max(
      state.appState.lastDropsPageRefreshNoticeSeenAt ?? 0,
      requestedSeenAt,
      completedAt,
    );
    state.appState.lastDropsPageRefreshNoticeSeenAt = seenAt || Date.now();
    await saveState(state);
    return { success: true, seenAt: state.appState.lastDropsPageRefreshNoticeSeenAt };
  }

  return {
    awaitInitialization,
    beginInitialization,
    ensureStateHydratedForCache,
    getInitPromise: () => initPromise,
    handleExtensionUpdate,
    markDropsRefreshNoticeSeen,
    trackActivity,
  };
}
