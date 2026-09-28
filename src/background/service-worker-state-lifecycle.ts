import { campaignRejectionReason } from '../shared/campaign-eligibility.ts';
import { createInitialState } from '../shared/utils.ts';
import { prepareBrowserSessionResume } from './browser-session-resume.ts';
import {
  DROPS_SNAPSHOT_CACHE_KEY,
  LAST_ACTIVITY_AT_KEY,
  STREAM_VALIDATION_GRACE_MS,
  TIMING_STATE_KEY,
  TWITCH_SESSION_STORAGE_KEY,
} from './constants.ts';
import {
  applyExtensionDataClearStateTransition,
  applyExtensionUpdateStateTransition,
  captureExtensionUpdateIntent,
} from './extension-reset.ts';
import { persistExtensionResetState } from './extension-reset-persistence.ts';
import { currentFarmingSessionEpoch } from './farming-session-revision.ts';
import { logInfo } from './logging.ts';
import { clearRotationMetadata, type ServiceWorkerState } from './runtime-state.ts';
import { resetStreamTrackingState } from './session-lifecycle.ts';
import type { StartupPauseSession } from './startup-pause.ts';
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
import { clearExtensionRuntimeStorage, initializeAfterStorageMigration } from './storage-migrations.ts';
import { sanitizeTwitchSession } from './twitch-api/types.ts';

const INACTIVITY_RESET_MS = 3 * 24 * 60 * 60_000;

interface StateLifecycleFarmingSession extends StartupPauseSession {
  readonly acquireStreamerForSelectedGame: () => Promise<boolean>;
  readonly advanceQueueIfCompleted: () => Promise<boolean>;
  readonly startMonitoring: () => void;
  readonly stop: (options?: { readonly skipTimingStateSave?: boolean }) => Promise<void>;
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
  let extensionStorageResetInFlight: Promise<void> | null = null;

  async function resetForInactivity(trigger: string, idleForMs: number): Promise<boolean> {
    logInfo('Resetting state after inactivity', {
      trigger,
      idleForMs,
      wasRunning: state.appState.isRunning,
      wasPaused: state.appState.isPaused,
    });
    const farmingSession = dependencies.getFarmingSession();
    return resetStateForInactivityExt(
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
    return resetForInactivity(trigger, idleForMs);
  }

  async function trackActivity(reason: string): Promise<void> {
    await enforceInactivityReset(`activity:${reason}`);
    await markActivity(state, reason);
  }

  async function handleExtensionUpdate(): Promise<void> {
    const epoch = currentFarmingSessionEpoch(state);
    const updateIntent = captureExtensionUpdateIntent(state.appState);
    await dependencies.getFarmingSession().stop({ skipTimingStateSave: true });
    if (currentFarmingSessionEpoch(state) !== epoch) {
      await saveState(state);
      return;
    }
    applyExtensionUpdateStateTransition(state, updateIntent);
    state.lastLifecycleCheckAt = Date.now();
    await clearExtensionRuntimeStorage();
    await saveTimingState(state);
    await persistExtensionResetState(state);
  }

  function handleExtensionStorageCleared(): Promise<void> {
    if (extensionStorageResetInFlight) {
      return extensionStorageResetInFlight;
    }
    extensionStorageResetInFlight = (async () => {
      await dependencies.getFarmingSession().stop({ skipTimingStateSave: true });
      applyExtensionDataClearStateTransition(state);
      await clearExtensionRuntimeStorage();
      await saveTimingState(state);
      await persistExtensionResetState(state);
    })().finally(() => {
      extensionStorageResetInFlight = null;
    });
    return extensionStorageResetInFlight;
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
    await prepareBrowserSessionResume(state, dependencies.getFarmingSession());
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
      const farmingSession = dependencies.getFarmingSession();
      if (
        state.appState.isRunning &&
        !state.appState.isPaused &&
        state.appState.selectedGame &&
        campaignRejectionReason(state.appState.selectedGame, Date.now())
      ) {
        await farmingSession.advanceQueueIfCompleted();
      }
      if (state.appState.isRunning && !state.appState.isPaused) {
        farmingSession.startMonitoring();
      }
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
    handleExtensionStorageCleared,
    markDropsRefreshNoticeSeen,
    trackActivity,
  };
}
