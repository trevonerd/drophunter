import { browser } from '../shared/browser-api.ts';
import { isDropCompleted } from '../shared/drops';
import { getGameDisplayLabel, replaceAvailableGames, sameCampaignId } from '../shared/game-selection';
import type { AppState, DropsSnapshot, TwitchDrop, TwitchGame, TwitchStreamer } from '../types';
import { autoClaimClaimableDrops as autoClaimClaimableDropsExt } from './auto-claim.ts';
import { ALARM_NAME, PROGRESS_POLL_MS, STREAM_VALIDATION_GRACE_MS } from './constants.ts';
import {
  completedDropKeys,
  dropMatchesSelectedGame as dropMatchesSelectedGameExt,
  dropStateKey,
  projectDropsSnapshot as projectDropsSnapshotExt,
  splitDropsForSelectedGame as splitDropsForSelectedGameExt,
} from './drops-projection.ts';
import {
  checkDropProgress as checkDropProgressExt,
  handleAddToQueue as handleAddToQueueExt,
  handleRemoveFromQueue as handleRemoveFromQueueExt,
  handleReorderQueue as handleReorderQueueExt,
  handleSetSelectedGame as handleSetSelectedGameExt,
  refreshDropsData as refreshDropsDataExt,
} from './drops-tick.ts';
import { logDebug, logWarn } from './logging';
import {
  normalizeQueueSelection as normalizeQueueSelectionExt,
  removeGameFromQueue as removeGameFromQueueExt,
  resolveGameFromState as resolveGameFromStateExt,
} from './queue-operations.ts';
import {
  applyStopState as applyStopStateExt,
  clearRecoveryState as clearRecoveryStateExt,
  clearStopState as clearStopStateExt,
  enterPersistentRecovery as enterPersistentRecoveryExt,
} from './recovery-state.ts';
import { clearRotationMetadata, type ServiceWorkerState } from './runtime-state';
import {
  advanceQueueIfCompleted as advanceQueueIfCompletedExt,
  handleStartFarming as handleStartFarmingExt,
  skipCurrentGameAndAdvanceQueue as skipCurrentGameAndAdvanceQueueExt,
  skipCurrentGameDueToStall as skipCurrentGameDueToStallExt,
  stopFarmingSession as stopFarmingSessionExt,
} from './session-lifecycle.ts';
import {
  acquireStreamerForSelectedGame as acquireStreamerForSelectedGameExt,
  openBestStreamerForSelectedGame as openBestStreamerForSelectedGameExt,
  rotateStreamer as rotateStreamerExt,
  rotateStreamerIfInvalid as rotateStreamerIfInvalidExt,
} from './streamer-acquisition.ts';
import { normalizePreferredStreamerLanguage, pickStreamerForPreferences } from './streamer-selection';
import type { TwitchSession } from './twitch-api/types';

export interface StreamContext {
  channelName: string;
  categorySlug: string;
  categoryLabel: string;
  streamTitle: string;
  titleContainsDrops: boolean;
  hasDropsSignal: boolean;
  isLive: boolean;
  pageUrl: string;
}

export interface RefreshDropsOptions {
  includeCampaignFetch?: boolean;
  includeInventoryFetch?: boolean;
  forceInventoryFetch?: boolean;
  suppressNotifications?: boolean;
}

export interface FarmingSessionAdapters {
  getInitPromise: () => Promise<void> | null;
  trackActivity: (reason: string) => Promise<void>;
  ensureTwitchSession: (forceRefresh?: boolean) => Promise<TwitchSession | null>;
  fetchDropsSnapshotFromApi: (forceSessionRefresh?: boolean) => Promise<DropsSnapshot | null>;
  fetchInventorySnapshotFromApi: (
    baseDrops: TwitchDrop[],
    forceSessionRefresh?: boolean,
  ) => Promise<DropsSnapshot | null>;
  fetchDirectoryStreamersFromApi: (
    game: TwitchGame,
    forceSessionRefresh?: boolean,
    language?: string,
  ) => Promise<TwitchStreamer[] & { languageFilterApplied: boolean }>;
  fetchStreamContext: (tabId: number) => Promise<StreamContext | null>;
  resolveCategorySlug: (game: TwitchGame) => Promise<string>;
  openForegroundChannel: (streamer: TwitchStreamer) => Promise<void>;
  enforcePlaybackPolicyOnStreamTab: () => Promise<void>;
  attemptPlaybackSelfHeal: (tabId: number) => Promise<void>;
  attemptAutoClaimChannelPointsBonus: () => Promise<boolean>;
  closeManagedTabIfSafe: (tabId: number | null) => Promise<boolean>;
  clearManagedTabOwnership: () => void;
  openMonitorDashboardWindow: (options: { toggle: boolean }) => Promise<unknown>;
  sendAlert: (kind: 'drop-complete' | 'all-complete', message: string) => Promise<void>;
  notify: (title: string, message: string, priority?: number) => Promise<void>;
  saveState: (state: ServiceWorkerState) => Promise<void>;
  saveTimingState: (state: ServiceWorkerState) => Promise<void>;
  broadcastStateUpdate: (appState: AppState) => void;
  monitorAutoOpenDelayMs: number;
}

function evaluateDropsForGame(
  game: TwitchGame,
  drops: TwitchDrop[],
): { allDrops: TwitchDrop[]; pendingDrops: TwitchDrop[]; hasFarmableDrops: boolean } {
  const relevantDrops = drops.filter((drop) => dropMatchesSelectedGameExt(drop, game));
  const allDrops = relevantDrops;
  const pendingDrops = allDrops.filter((drop) => !isDropCompleted(drop));
  const hasFarmableDrops = pendingDrops.some((drop) => drop.dropType !== 'event-based');
  return { allDrops, pendingDrops, hasFarmableDrops };
}

export function createFarmingSession(state: ServiceWorkerState, adapters: FarmingSessionAdapters) {
  async function evaluateDropTransitions(previousCompletedKeys: Set<string>) {
    const nowCompletedKeys = completedDropKeys(state.appState.completedDrops);
    const newlyCompleted = state.appState.completedDrops.filter(
      (drop) => !previousCompletedKeys.has(dropStateKey(drop)),
    );

    for (const drop of newlyCompleted) {
      await adapters.sendAlert('drop-complete', `Reward unlocked: ${drop.name}`);
    }

    const hasDrops = state.appState.allDrops.length > 0;
    const allCompleted =
      hasDrops && state.appState.pendingDrops.length === 0 && state.appState.currentDrop === null;
    if (allCompleted && !state.appState.completionNotified) {
      await adapters.sendAlert(
        'all-complete',
        `All rewards for ${state.appState.selectedGame ? getGameDisplayLabel(state.appState.selectedGame) : 'this campaign'} are complete.`,
      );
      state.appState.completionNotified = true;
    }

    if (nowCompletedKeys.size < previousCompletedKeys.size) {
      state.appState.completionNotified = false;
    }
  }

  async function autoClaimClaimableDrops(): Promise<boolean> {
    return autoClaimClaimableDropsExt(
      state,
      (force) => adapters.ensureTwitchSession(force),
      async (drop) => {
        await adapters.sendAlert('drop-complete', `Claimed: ${drop.name} (${drop.gameName})`);
      },
    );
  }

  async function refreshDropsData(options: RefreshDropsOptions = {}) {
    await refreshDropsDataExt(
      state,
      options,
      {
        onFetchDropsSnapshotFromApi: adapters.fetchDropsSnapshotFromApi,
        onFetchInventorySnapshotFromApi: adapters.fetchInventorySnapshotFromApi,
        onEvaluateDropTransitions: evaluateDropTransitions,
        onSaveState: adapters.saveState,
      },
      {
        replaceAvailableGames,
        getGameDisplayLabel,
        projectDropsSnapshot: projectDropsSnapshotExt,
        normalizeQueueSelection: normalizeQueueSelectionExt,
      },
    );
  }

  async function checkDropProgress() {
    const initPromise = adapters.getInitPromise();
    if (initPromise) {
      await initPromise;
    }

    await checkDropProgressExt(state, {
      onEnforcePlaybackPolicy: adapters.enforcePlaybackPolicyOnStreamTab,
      onRotateStreamerIfInvalid: rotateStreamerIfInvalid,
      onAcquireStreamerForSelectedGame: acquireStreamerForSelectedGame,
      onAttemptAutoClaimChannelPointsBonus: adapters.attemptAutoClaimChannelPointsBonus,
      onRefreshDropsData: refreshDropsData,
      onAutoClaimClaimableDrops: autoClaimClaimableDrops,
      onAdvanceQueueIfCompleted: advanceQueueIfCompleted,
      onSaveTimingState: adapters.saveTimingState,
    });
  }

  function startMonitoring() {
    browser.alarms.create(ALARM_NAME, { periodInMinutes: Math.max(0.5, PROGRESS_POLL_MS / 60_000) });
    checkDropProgress().catch((error) => logWarn('Initial monitoring error:', String(error)));
  }

  function stopMonitoring() {
    browser.alarms.clear(ALARM_NAME).catch(() => undefined);
  }

  async function openBestStreamerForSelectedGame(): Promise<boolean> {
    return openBestStreamerForSelectedGameExt(
      state,
      {
        onFetchDirectoryStreamersFromApi: adapters.fetchDirectoryStreamersFromApi,
        onOpenForegroundChannel: adapters.openForegroundChannel,
      },
      {
        dropMatchesSelectedGame: dropMatchesSelectedGameExt,
        isDropCompleted,
        getGameDisplayLabel,
        resolveCategorySlug: adapters.resolveCategorySlug,
        pickStreamerForPreferences,
        normalizePreferredStreamerLanguage,
      },
    );
  }

  async function stop(options?: {
    notification?: { title: string; message: string };
    stopReason?: string;
    stopMessage?: string | null;
  }) {
    await stopFarmingSessionExt(state, {
      ...options,
      onStopMonitoring: stopMonitoring,
      onCloseManagedTab: async (tabId: number | null) => {
        await adapters.closeManagedTabIfSafe(tabId);
      },
      onClearRotationMetadata: clearRotationMetadata,
      onApplyStopState: applyStopStateExt,
      onNotify: async (title: string, message: string) => {
        await adapters.notify(title, message);
      },
      onSaveState: () => adapters.saveState(state),
      onSaveTimingState: adapters.saveTimingState,
    });
  }

  async function skipCurrentGameDueToNoStreamers() {
    await skipCurrentGameAndAdvanceQueueExt(state, 'no-streamers', {
      onEnsureWorkspace: ensureWorkspaceForSelectedGame,
      onRefreshDropsData: refreshDropsData,
      onOpenStreamer: acquireStreamerForSelectedGame,
      onSaveState: () => adapters.saveState(state),
      onSaveTimingState: adapters.saveTimingState,
      onStopFarmingSession: stop,
      onNotify: adapters.notify,
    });
  }

  async function acquireStreamerForSelectedGame(): Promise<boolean> {
    return acquireStreamerForSelectedGameExt(state, {
      onOpenStreamer: openBestStreamerForSelectedGame,
      onSkipCurrentGame: skipCurrentGameDueToNoStreamers,
      onSaveState: () => adapters.saveState(state),
      onSaveTimingState: adapters.saveTimingState,
    });
  }

  async function ensureWorkspaceForSelectedGame() {
    if (!state.appState.selectedGame) {
      return;
    }
    const resolvedSlug = await adapters.resolveCategorySlug(state.appState.selectedGame);
    state.appState.selectedGame = {
      ...state.appState.selectedGame,
      categorySlug: resolvedSlug,
    };
  }

  async function advanceQueueIfCompleted(): Promise<boolean> {
    return advanceQueueIfCompletedExt(state, {
      onOpenStreamer: acquireStreamerForSelectedGame,
      onEnsureWorkspace: ensureWorkspaceForSelectedGame,
      onSendAlert: adapters.sendAlert,
      onStopMonitoring: stopMonitoring,
      onCloseManagedTabIfSafe: adapters.closeManagedTabIfSafe,
      onClearManagedTabOwnership: adapters.clearManagedTabOwnership,
      onApplyStopState: applyStopStateExt,
      onNotify: async (title: string, message: string) => {
        await adapters.notify(title, message);
      },
      onRefreshDropsData: refreshDropsData,
      onSaveState: () => adapters.saveState(state),
      onSaveTimingState: adapters.saveTimingState,
    });
  }

  async function handleStartFarming(payload: { game?: TwitchGame }) {
    const result = await handleStartFarmingExt(state, payload, {
      onEnsureWorkspace: ensureWorkspaceForSelectedGame,
      onRefreshDropsData: refreshDropsData,
      onSaveState: () => adapters.saveState(state),
      onSaveTimingState: adapters.saveTimingState,
      onBroadcastStateUpdate: () => adapters.broadcastStateUpdate(state.appState),
      onStopMonitoring: stopMonitoring,
      onTrackActivity: adapters.trackActivity,
      onApplyStopState: applyStopStateExt,
    });

    if (!result.success) {
      return result;
    }

    const advanced = await advanceQueueIfCompleted();
    if (!advanced) {
      return { success: false, error: 'Queue completed. No pending rewards left.' };
    }
    if (!state.appState.tabId && state.appState.selectedGame) {
      await acquireStreamerForSelectedGame();
    }
    if (state.appState.monitorAutoOpen) {
      await new Promise((resolve) => setTimeout(resolve, adapters.monitorAutoOpenDelayMs));
      await adapters.openMonitorDashboardWindow({ toggle: false }).catch(() => undefined);
    }

    await adapters.saveState(state);
    await adapters.saveTimingState(state);
    startMonitoring();
    return { success: true };
  }

  async function skipCurrentGameDueToOfflineRecovery() {
    await skipCurrentGameDueToStallExt(state, {
      onEnsureWorkspace: ensureWorkspaceForSelectedGame,
      onRefreshDropsData: refreshDropsData,
      onOpenStreamer: acquireStreamerForSelectedGame,
      onSaveState: () => adapters.saveState(state),
      onSaveTimingState: adapters.saveTimingState,
      onStopFarmingSession: stop,
      onNotify: adapters.notify,
    });
  }

  async function rotateStreamerIfInvalid() {
    await rotateStreamerIfInvalidExt(state, {
      onFetchStreamContext: adapters.fetchStreamContext,
      onResolveCategorySlug: adapters.resolveCategorySlug,
      onAttemptPlaybackSelfHeal: adapters.attemptPlaybackSelfHeal,
      onSaveState: () => adapters.saveState(state),
      onSaveTimingState: adapters.saveTimingState,
      onRotateStreamer: rotateStreamerExt,
      onOpenStreamer: acquireStreamerForSelectedGame,
      onEnterPersistentRecovery: async (nextState, reason, message, recoveryOpts) =>
        enterPersistentRecoveryExt(nextState, reason, message, {
          ...recoveryOpts,
          onNotify: adapters.notify,
        }),
      onSkipCurrentGame: skipCurrentGameDueToOfflineRecovery,
      onForceRefreshDropsData: () =>
        refreshDropsData({
          includeCampaignFetch: true,
          includeInventoryFetch: true,
          forceInventoryFetch: true,
        }),
    });
  }

  async function handleStopFarming() {
    await adapters.trackActivity('stop-farming');
    await stop({
      stopReason: 'user-stop',
      stopMessage: 'Stopped by user.',
    });
    return { success: true };
  }

  async function handleSetSelectedGame(payload: { game: TwitchGame }) {
    return handleSetSelectedGameExt(
      state,
      payload,
      {
        onTrackActivity: adapters.trackActivity,
        onEnsureWorkspace: ensureWorkspaceForSelectedGame,
        onRefreshDropsData: refreshDropsData,
        onOpenBestStreamer: acquireStreamerForSelectedGame,
        onSaveState: adapters.saveState,
        onSaveTimingState: adapters.saveTimingState,
      },
      {
        resolveGameFromState: resolveGameFromStateExt,
        removeGameFromQueue: removeGameFromQueueExt,
        splitDropsForSelectedGame: splitDropsForSelectedGameExt,
        getGameDisplayLabel,
        logDebug,
        logWarn,
      },
    );
  }

  async function handleAddToQueue(payload: { game?: TwitchGame }) {
    return handleAddToQueueExt(
      state,
      payload,
      { onTrackActivity: adapters.trackActivity, onSaveState: adapters.saveState },
      { resolveGameFromState: resolveGameFromStateExt, evaluateDropsForGame, getGameDisplayLabel },
    );
  }

  async function handleRemoveFromQueue(payload: { game?: TwitchGame; gameId?: string; campaignId?: string }) {
    return handleRemoveFromQueueExt(
      state,
      payload,
      { onTrackActivity: adapters.trackActivity, onSaveState: adapters.saveState },
      { removeGameFromQueue: removeGameFromQueueExt, sameCampaignId },
    );
  }

  async function handleReorderQueue(payload: { fromIndex?: number; toIndex?: number }) {
    return handleReorderQueueExt(state, payload, {
      onTrackActivity: adapters.trackActivity,
      onSaveState: adapters.saveState,
    });
  }

  async function handleClearQueue() {
    await adapters.trackActivity('clear-queue');
    state.appState.queue = [];
    await adapters.saveState(state);
    return { success: true, queueLength: 0 };
  }

  async function handlePauseFarming() {
    await adapters.trackActivity('pause-farming');
    state.appState.isPaused = true;
    state.playbackAttentionWarningSent = false;
    stopMonitoring();
    await adapters.saveState(state);
    await adapters.saveTimingState(state);
    return { success: true };
  }

  async function handleResumeFarming() {
    await adapters.trackActivity('resume-farming');
    state.appState.isPaused = false;
    state.invalidStreamChecks = 0;
    state.noProgressRotationAttempts = 0;
    clearStopStateExt(state);
    if (state.appState.tabId) {
      state.streamValidationGraceUntil = Date.now() + STREAM_VALIDATION_GRACE_MS;
    }
    clearRecoveryStateExt(state);
    startMonitoring();
    await adapters.saveState(state);
    await adapters.saveTimingState(state);
    return { success: true };
  }

  async function handleRefreshDrops() {
    await adapters.trackActivity('refresh-drops');
    await refreshDropsData({
      includeCampaignFetch: true,
      includeInventoryFetch: Boolean(state.appState.selectedGame),
      forceInventoryFetch: true,
    });
    return { success: true };
  }

  return {
    acquireStreamerForSelectedGame,
    checkDropProgress,
    handleAddToQueue,
    handleClearQueue,
    handlePauseFarming,
    handleRefreshDrops,
    handleRemoveFromQueue,
    handleReorderQueue,
    handleResumeFarming,
    handleSetSelectedGame,
    handleStartFarming,
    handleStopFarming,
    refreshDropsData,
    startMonitoring,
    stop,
    stopMonitoring,
  };
}
