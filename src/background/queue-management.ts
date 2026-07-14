import { haveAllDropsExpiredOrVanished } from '../shared/drops';
import { findMatchingGame, getGameDisplayLabel } from '../shared/game-selection';
import { TwitchGame } from '../types';
import { logDebug, logInfo, logWarn } from './logging';
import {
  normalizeQueueSelection,
  promoteQueueHead,
  removeGameFromQueue,
  removeQueueEntriesForGame,
  removeQueueEntriesForHeadGame,
  resolveGameFromState,
} from './queue-operations';
import { clearRecoveryState, clearStopState } from './recovery-state';
import type { ServiceWorkerState } from './service-worker';
import { saveTimingState as saveTimingStateExt } from './state-persistence';

// Backward-compat re-exports — symbols moved to ./drops-tick (batch 4 of candidate #1).
// External callers should import directly from ./drops-tick; these re-exports are
// temporary scaffold that a later batch will remove once all import sites are updated.
export type {
  CheckDropProgressCallbacks,
  HandleAddToQueueDeps,
  HandleSetSelectedGameCallbacks,
  HandleSetSelectedGameDeps,
  RefreshDropsDataCallbacks,
  RefreshDropsDataDeps,
} from './drops-tick';
export {
  checkDropProgress,
  handleAddToQueue,
  handleRemoveFromQueue,
  handleReorderQueue,
  handleSetSelectedGame,
  refreshDropsData,
} from './drops-tick';
// Backward-compat re-exports — symbols moved to ./queue-operations (batch 1 of candidate #1).
// External callers should import directly from ./queue-operations; these re-exports are
// temporary scaffold that a later batch will remove once all import sites are updated.
export {
  normalizeQueueSelection,
  pushGameToQueue,
  removeGameFromQueue,
  reorderQueue,
  resolveGameFromState,
} from './queue-operations';
// Backward-compat re-exports — symbols moved to ./recovery-state (batch 2 of candidate #1).
// External callers should import directly from ./recovery-state; these re-exports are
// temporary scaffold that a later batch will remove once all import sites are updated.
export {
  applyStopState,
  clearRecoveryState,
  clearStopState,
  enterPersistentRecovery,
} from './recovery-state';
// Backward-compat re-exports — symbols moved to ./streamer-acquisition (batch 3 of candidate #1).
// External callers should import directly from ./streamer-acquisition; these re-exports are
// temporary scaffold that a later batch will remove once all import sites are updated.
export {
  acquireStreamerForSelectedGame,
  openBestStreamerForSelectedGame,
  rotateStreamer,
  rotateStreamerIfInvalid,
} from './streamer-acquisition';

// ============================================================================
// Helper Functions (internal)
// ============================================================================

function resetNoProgressRotationAttempts(state: ServiceWorkerState) {
  state.noProgressRotationAttempts = 0;
}

function selectedGameMarkedCompleted(state: ServiceWorkerState): boolean {
  const selectedGame = state.appState.selectedGame;
  if (!selectedGame) {
    return false;
  }
  if (selectedGame.allDropsCompleted === true) {
    return true;
  }
  return findMatchingGame(selectedGame, state.appState.availableGames)?.allDropsCompleted === true;
}

export function resetStreamTrackingState(state: ServiceWorkerState) {
  state.invalidStreamChecks = 0;
  state.lastStreamRotationAt = 0;
  state.streamValidationGraceUntil = 0;
  state.lastTrackedProgress = -1;
  state.lastTrackedMinutes = -1;
  state.lastTrackedDropKey = null;
  state.lastProgressAdvanceAt = 0;
  state.offlineChecks = 0;
  state.avoidStreamerName = null;
  resetNoProgressRotationAttempts(state);
  state.playbackAttentionWarningSent = false;
  clearRecoveryState(state);
}

export async function stopFarmingSession(
  state: ServiceWorkerState,
  opts?: {
    notification?: { title: string; message: string };
    stopReason?: string;
    stopMessage?: string | null;
    onStopMonitoring?: () => void;
    onCloseManagedTab?: (tabId: number | null) => Promise<void>;
    onClearRotationMetadata?: (appState: ServiceWorkerState['appState']) => ServiceWorkerState['appState'];
    onApplyStopState?: (state: ServiceWorkerState, reason: string, message: string | null) => void;
    onNotify?: (title: string, message: string) => Promise<void>;
    onSaveState?: () => Promise<void>;
    onSaveTimingState?: (state: ServiceWorkerState) => Promise<void>;
  },
) {
  if (opts?.onStopMonitoring) {
    opts.onStopMonitoring();
  }
  resetStreamTrackingState(state);
  state.dropClaimRetryAtById.clear();
  state.dropClaimInFlight = false;
  state.monitorTickInFlight = false;
  state.tickGeneration += 1;

  if (opts?.onCloseManagedTab) {
    await opts.onCloseManagedTab(state.appState.tabId);
  }

  if (opts?.onClearRotationMetadata) {
    state.appState = {
      ...opts.onClearRotationMetadata(state.appState),
      isRunning: false,
      isPaused: false,
      activeStreamer: null,
      tabId: null,
      completionNotified: false,
    };
  } else {
    state.appState = {
      ...state.appState,
      isRunning: false,
      isPaused: false,
      activeStreamer: null,
      tabId: null,
      completionNotified: false,
    };
  }

  if (opts?.stopReason && opts?.onApplyStopState) {
    opts.onApplyStopState(state, opts.stopReason, opts.stopMessage ?? opts.notification?.message ?? null);
  }

  if (opts?.notification && opts?.onNotify) {
    await opts.onNotify(opts.notification.title, opts.notification.message);
  }

  if (opts?.onSaveState) {
    await opts.onSaveState();
  }
  if (opts?.onSaveTimingState) {
    await opts.onSaveTimingState(state);
  } else {
    saveTimingStateExt(state).catch(() => undefined);
  }
}

export async function advanceQueueIfCompleted(
  state: ServiceWorkerState,
  opts?: {
    onOpenStreamer?: () => Promise<boolean>;
    onEnsureWorkspace?: () => Promise<void>;
    onSendAlert?: (kind: 'drop-complete' | 'all-complete', msg: string) => Promise<void>;
    onStopMonitoring?: () => void;
    onCloseManagedTabIfSafe?: (tabId: number | null) => Promise<boolean>;
    onClearManagedTabOwnership?: () => void;
    onApplyStopState?: (state: ServiceWorkerState, reason: string, message: string | null) => void;
    onNotify?: (title: string, message: string) => Promise<void>;
    onRefreshDropsData?: (options: {
      includeCampaignFetch: boolean;
      includeInventoryFetch: boolean;
      suppressNotifications: boolean;
    }) => Promise<void>;
    onSaveState?: () => Promise<void>;
    onSaveTimingState?: (state: ServiceWorkerState) => Promise<void>;
  },
): Promise<boolean> {
  if (!state.appState.isRunning || state.appState.isPaused) {
    return false;
  }

  const hasFarmablePending = state.appState.pendingDrops.some((d) => d.dropType !== 'event-based');
  const selectedMarkedCompleted = selectedGameMarkedCompleted(state);
  const knownCompletedCurrent =
    (state.appState.allDrops.length > 0 || selectedMarkedCompleted) &&
    !hasFarmablePending &&
    state.appState.currentDrop === null;
  const campaignExpiredOrVanished = haveAllDropsExpiredOrVanished(
    state.appState.allDrops,
    state.previousAllDropsCount,
  );
  logDebug('advanceQueueIfCompleted result', {
    knownCompletedCurrent,
    selectedMarkedCompleted,
    campaignExpiredOrVanished,
    shouldAdvance: knownCompletedCurrent || campaignExpiredOrVanished,
  });
  if (!knownCompletedCurrent && !campaignExpiredOrVanished) {
    return true;
  }
  if (campaignExpiredOrVanished && !knownCompletedCurrent) {
    logInfo('Campaign expired or vanished mid-farming — advancing queue', {
      selectedGame: state.appState.selectedGame ? getGameDisplayLabel(state.appState.selectedGame) : null,
      allDropsCount: state.appState.allDrops.length,
      previousAllDropsCount: state.previousAllDropsCount,
      queueLength: state.appState.queue.length,
    });
  }

  const completedWhileNoStreamers = state.appState.recoveryReason === 'no-streamers';
  const completedGameName = state.appState.selectedGame
    ? getGameDisplayLabel(state.appState.selectedGame)
    : 'current game';

  if (state.appState.selectedGame) {
    removeQueueEntriesForGame(state, state.appState.selectedGame);
  }

  while (state.appState.queue.length > 0) {
    const nextGame = promoteQueueHead(state);
    if (!nextGame) {
      break;
    }
    state.appState.completionNotified = false;
    state.invalidStreamChecks = 0;
    state.lastTrackedProgress = -1;
    state.lastTrackedMinutes = -1;
    state.lastTrackedDropKey = null;
    state.lastProgressAdvanceAt = 0;
    state.previousAllDropsCount = 0;
    resetNoProgressRotationAttempts(state);

    if (opts?.onSaveTimingState) {
      await opts.onSaveTimingState(state);
    } else {
      saveTimingStateExt(state).catch(() => undefined);
    }

    if (opts?.onEnsureWorkspace) {
      await opts.onEnsureWorkspace();
    }
    if (opts?.onRefreshDropsData) {
      await opts.onRefreshDropsData({
        includeCampaignFetch: true,
        includeInventoryFetch: true,
        suppressNotifications: true,
      });
    }

    const hasFarmablePendingNext = state.appState.pendingDrops.some((d) => d.dropType !== 'event-based');
    const nextMarkedCompleted = selectedGameMarkedCompleted(state);
    const knownCompletedNext =
      (state.appState.allDrops.length > 0 || nextMarkedCompleted) &&
      !hasFarmablePendingNext &&
      state.appState.currentDrop === null;
    const campaignExpiredNext = haveAllDropsExpiredOrVanished(
      state.appState.allDrops,
      state.previousAllDropsCount,
    );
    if (knownCompletedNext || campaignExpiredNext) {
      state.previousAllDropsCount = 0;
      removeQueueEntriesForHeadGame(state, nextGame);
      continue;
    }

    if (opts?.onOpenStreamer) {
      await opts.onOpenStreamer();
    }
    if (opts?.onSaveState) {
      await opts.onSaveState();
    }
    return true;
  }

  if (opts?.onCloseManagedTabIfSafe) {
    await opts.onCloseManagedTabIfSafe(state.appState.tabId);
  }
  if (opts?.onClearManagedTabOwnership) {
    opts.onClearManagedTabOwnership();
  }
  state.appState.isRunning = false;
  state.appState.isPaused = false;
  state.appState.selectedGame = null;
  state.appState.completionNotified = false;
  state.appState.lastRotationReason = null;
  state.appState.lastRotationAt = null;
  const queueCompleteMessage = completedWhileNoStreamers
    ? `Queue completed. No live streamers found for ${completedGameName}.`
    : 'Queue completed. No pending rewards left.';
  const queueCompleteNotificationMessage = completedWhileNoStreamers
    ? `No live streamers found for ${completedGameName}. DropHunter has stopped.`
    : queueCompleteMessage;
  if (opts?.onApplyStopState) {
    opts.onApplyStopState(state, 'queue-complete', queueCompleteMessage);
  }
  if (opts?.onStopMonitoring) {
    opts.onStopMonitoring();
  }
  if (completedWhileNoStreamers && opts?.onNotify) {
    await opts.onNotify('Queue completed', queueCompleteNotificationMessage);
  } else if (opts?.onSendAlert) {
    await opts.onSendAlert('all-complete', queueCompleteMessage);
  }
  if (opts?.onSaveState) {
    await opts.onSaveState();
  }
  return false;
}

export type QueueSkipReason = 'stalled-progress' | 'no-streamers';

function queueSkipCopy(reason: QueueSkipReason, gameName: string) {
  if (reason === 'no-streamers') {
    return {
      logMessage: 'Skipping game because no live streamers were found',
      skipNotificationTitle: 'Game skipped: no live streamers',
      skipMessage: `Skipped ${gameName} — no live streamers were found.`,
      terminalNotificationTitle: 'Queue completed',
      terminalMessage: `Queue completed. No live streamers found for ${gameName}.`,
      terminalNotificationMessage: `No live streamers found for ${gameName}. DropHunter has stopped.`,
      stopReason: 'queue-complete',
    } as const;
  }

  return {
    logMessage: 'Giving up on game after stalled drop progress',
    skipNotificationTitle: 'Game skipped: no drop progress',
    skipMessage: `Skipped ${gameName} — stream opened but drop progress did not resume.`,
    terminalNotificationTitle: 'Farming stopped: no drop progress',
    terminalMessage: `Farming stopped — ${gameName} opened a stream but drop progress did not resume and no other games are queued.`,
    terminalNotificationMessage: `${gameName} opened a stream but drop progress did not resume. DropHunter has stopped.`,
    stopReason: 'stall-skipped',
  } as const;
}

export async function skipCurrentGameAndAdvanceQueue(
  state: ServiceWorkerState,
  reason: QueueSkipReason = 'stalled-progress',
  opts?: {
    onEnsureWorkspace?: () => Promise<void>;
    onRefreshDropsData?: (options: {
      includeCampaignFetch: boolean;
      includeInventoryFetch: boolean;
      suppressNotifications: boolean;
    }) => Promise<void>;
    onOpenStreamer?: () => Promise<boolean>;
    onSaveState?: () => Promise<void>;
    onSaveTimingState?: (state: ServiceWorkerState) => Promise<void>;
    onStopFarmingSession?: (opts: {
      stopReason: string;
      stopMessage: string;
      notification: { title: string; message: string };
    }) => Promise<void>;
    onNotify?: (title: string, message: string, priority?: number) => Promise<void>;
  },
) {
  const skippedGame = state.appState.selectedGame;
  const gameName = skippedGame ? getGameDisplayLabel(skippedGame) : 'current game';
  const copy = queueSkipCopy(reason, gameName);

  logWarn(copy.logMessage, {
    game: gameName,
    reason,
    stalledRecoveryAttempts: state.stalledRecoveryAttempts,
  });

  if (skippedGame) {
    removeQueueEntriesForGame(state, skippedGame);
  }

  resetStreamTrackingState(state);

  while (state.appState.queue.length > 0) {
    const nextGame = promoteQueueHead(state);
    if (!nextGame) {
      break;
    }
    state.appState.completionNotified = false;
    state.invalidStreamChecks = 0;
    state.lastTrackedProgress = -1;
    state.lastTrackedMinutes = -1;
    state.lastTrackedDropKey = null;
    state.lastProgressAdvanceAt = 0;
    resetNoProgressRotationAttempts(state);

    if (opts?.onSaveTimingState) {
      await opts.onSaveTimingState(state);
    } else {
      saveTimingStateExt(state).catch(() => undefined);
    }

    if (opts?.onEnsureWorkspace) {
      await opts.onEnsureWorkspace();
    }
    if (opts?.onRefreshDropsData) {
      await opts.onRefreshDropsData({
        includeCampaignFetch: true,
        includeInventoryFetch: true,
        suppressNotifications: true,
      });
    }

    const hasFarmablePendingNext = state.appState.pendingDrops.some((d) => d.dropType !== 'event-based');
    const knownCompletedNext =
      state.appState.allDrops.length > 0 && !hasFarmablePendingNext && state.appState.currentDrop === null;
    if (knownCompletedNext) {
      removeQueueEntriesForHeadGame(state, nextGame);
      continue;
    }

    if (opts?.onOpenStreamer) {
      await opts.onOpenStreamer();
    }
    await opts?.onNotify?.(
      copy.skipNotificationTitle,
      `${copy.skipMessage} Now farming ${getGameDisplayLabel(nextGame)}.`,
    );
    if (opts?.onSaveState) {
      await opts.onSaveState();
    }
    return;
  }

  state.appState.selectedGame = null;
  if (opts?.onStopFarmingSession) {
    await opts.onStopFarmingSession({
      stopReason: copy.stopReason,
      stopMessage: copy.terminalMessage,
      notification: {
        title: copy.terminalNotificationTitle,
        message: copy.terminalNotificationMessage,
      },
    });
  }
}

export async function skipCurrentGameDueToStall(
  state: ServiceWorkerState,
  opts?: Parameters<typeof skipCurrentGameAndAdvanceQueue>[2],
) {
  return skipCurrentGameAndAdvanceQueue(state, 'stalled-progress', opts);
}

export async function handleStartFarming(
  state: ServiceWorkerState,
  payload: { game?: TwitchGame },
  opts?: {
    onEnsureWorkspace?: () => Promise<void>;
    onRefreshDropsData?: (options: {
      includeCampaignFetch: boolean;
      includeInventoryFetch: boolean;
      suppressNotifications: boolean;
    }) => Promise<void>;
    onOpenStreamer?: () => Promise<boolean>;
    onSaveState?: () => Promise<void>;
    onSaveTimingState?: (state: ServiceWorkerState) => Promise<void>;
    onBroadcastStateUpdate?: () => void;
    onStartMonitoring?: () => void;
    onOpenMonitorDashboard?: (opts: { toggle: boolean }) => Promise<void>;
    onStopMonitoring?: () => void;
    onTrackActivity?: (reason: string) => Promise<void>;
    onApplyStopState?: (state: ServiceWorkerState, reason: string, message: string | null) => void;
  },
): Promise<{ success: boolean; error?: string }> {
  if (opts?.onTrackActivity) {
    await opts.onTrackActivity('start-farming');
  }
  if (!payload?.game) {
    return { success: false, error: 'No game selected.' };
  }

  const requestedGame = resolveGameFromState(state, payload.game);
  removeQueueEntriesForGame(state, requestedGame);
  state.appState.queue = [requestedGame, ...state.appState.queue];
  normalizeQueueSelection(state, state.appState.availableGames);
  state.appState.selectedGame = state.appState.queue[0] ?? requestedGame;
  state.appState.isRunning = true;
  state.appState.isPaused = false;
  state.appState.completionNotified = false;
  clearStopState(state);
  clearRecoveryState(state);
  state.appState.lastRotationReason = null;
  state.appState.lastRotationAt = null;
  resetStreamTrackingState(state);
  state.dropClaimRetryAtById.clear();
  state.dropClaimInFlight = false;
  state.monitorTickInFlight = false;
  state.tickGeneration += 1;

  if (opts?.onEnsureWorkspace) {
    await opts.onEnsureWorkspace();
  }
  if (opts?.onRefreshDropsData) {
    await opts.onRefreshDropsData({
      includeCampaignFetch: true,
      includeInventoryFetch: true,
      suppressNotifications: true,
    });
  }

  const hasFarmablePendingNow = state.appState.pendingDrops.some((d) => d.dropType !== 'event-based');
  if (!hasFarmablePendingNow && state.appState.currentDrop === null) {
    removeGameFromQueue(state, requestedGame);
    state.appState.isRunning = false;
    state.appState.isPaused = false;
    state.appState.selectedGame = null;
    if (opts?.onStopMonitoring) {
      opts.onStopMonitoring();
    }
    if (opts?.onSaveState) {
      await opts.onSaveState();
    }
    if (opts?.onBroadcastStateUpdate) {
      opts.onBroadcastStateUpdate();
    }
    return { success: false, error: 'No farmable drops for this game.' };
  }

  if (opts?.onSaveState) {
    await opts.onSaveState();
  }

  return { success: true };
}
