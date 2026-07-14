import { browser } from '../shared/browser-api.ts';
import { haveAllDropsExpiredOrVanished } from '../shared/drops';
import { findMatchingGame, gameKey, getGameDisplayLabel } from '../shared/game-selection';
import { DropsSnapshot, TwitchDrop, TwitchGame } from '../types';
import { detectNewlyClaimedDrops, recordClaimedDrops } from './claim-log.ts';
import {
  CRASH_RECOVERY_GRACE_MS,
  FULL_REFRESH_INTERVAL_MS,
  STREAM_VALIDATION_GRACE_MS,
  TICK_WATCHDOG_TIMEOUT_MS,
} from './constants';
import { completedDropKeys } from './drops-projection.ts';
import { logDebug, logInfo, logWarn } from './logging';
import {
  normalizeQueueSelection,
  promoteQueueHead,
  queueContainsGame,
  queueEntryMatchesGame,
  removeGameFromQueue,
  removeQueueEntriesForGame,
  removeQueueEntriesForHeadGame,
  reorderQueue,
  resolveGameFromState,
} from './queue-operations';
import { clearRecoveryState, clearStopState } from './recovery-state';
import type { ServiceWorkerState } from './service-worker';
import { saveTimingState as saveTimingStateExt } from './state-persistence';

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

export interface CheckDropProgressCallbacks {
  onEnforcePlaybackPolicy: () => Promise<void>;
  onRotateStreamerIfInvalid: () => Promise<void>;
  onAcquireStreamerForSelectedGame: () => Promise<boolean>;
  onAttemptAutoClaimChannelPointsBonus: () => Promise<boolean>;
  onRefreshDropsData: (opts?: {
    includeCampaignFetch?: boolean;
    includeInventoryFetch?: boolean;
    forceInventoryFetch?: boolean;
  }) => Promise<void>;
  onAutoClaimClaimableDrops: () => Promise<boolean>;
  onAdvanceQueueIfCompleted: () => Promise<boolean>;
  onSaveTimingState: (state: ServiceWorkerState) => Promise<void>;
}

export async function checkDropProgress(
  state: ServiceWorkerState,
  callbacks: CheckDropProgressCallbacks,
): Promise<void> {
  if (!state.appState.isRunning || state.appState.isPaused) {
    return;
  }

  state.lastHeartbeatAt = Date.now();

  logDebug('Tick entry', {
    isRunning: state.appState.isRunning,
    isPaused: state.appState.isPaused,
    monitorTickInFlight: state.monitorTickInFlight,
    apiBackoffActive: state.apiBackoffUntil > Date.now(),
  });

  if (state.monitorTickInFlight) {
    logDebug('Tick skipped — monitorTickInFlight already true');
    return;
  }
  state.monitorTickInFlight = true;
  const myTickGeneration = state.tickGeneration;
  const isStaleTick = () => {
    if (state.tickGeneration !== myTickGeneration) {
      logDebug('Tick generation stale (session stopped/restarted mid-tick) — aborting');
      return true;
    }
    return false;
  };

  const tickWatchdogTimer = setTimeout(() => {
    if (state.monitorTickInFlight) {
      logWarn('Monitoring tick watchdog fired — resetting stuck monitorTickInFlight flag', {
        timeoutMs: TICK_WATCHDOG_TIMEOUT_MS,
      });
      state.monitorTickInFlight = false;
    }
  }, TICK_WATCHDOG_TIMEOUT_MS);

  try {
    if (state.apiBackoffUntil > 0 && Date.now() < state.apiBackoffUntil) {
      logDebug('API backoff active, skipping network refresh work', {
        remainingMs: state.apiBackoffUntil - Date.now(),
      });
      return;
    }

    const noStreamersRecoveryActive = state.appState.recoveryReason === 'no-streamers';
    if (noStreamersRecoveryActive) {
      if (Date.now() >= state.recoveryBackoffUntil) {
        await callbacks.onAcquireStreamerForSelectedGame();
      }
      return;
    }

    if (state.appState.tabId) {
      const streamTab = await browser.tabs.get(state.appState.tabId).catch(() => null);
      if (isStaleTick()) return;
      if (!streamTab) {
        state.appState.tabId = null;
        state.appState.activeStreamer = null;
      }
    }
    await callbacks.onEnforcePlaybackPolicy();
    if (isStaleTick()) return;

    const isFullTick = Date.now() - state.lastFullRefreshAt >= FULL_REFRESH_INTERVAL_MS;
    if (isFullTick) {
      await callbacks.onRefreshDropsData({ includeCampaignFetch: true, includeInventoryFetch: true });
      if (isStaleTick()) return;
      state.lastFullRefreshAt = Date.now();
    } else {
      await callbacks.onRefreshDropsData();
      if (isStaleTick()) return;
    }

    const selectedBeforeAdvance = state.appState.selectedGame ? gameKey(state.appState.selectedGame) : null;
    const advancedBeforeValidation = await callbacks.onAdvanceQueueIfCompleted();
    if (isStaleTick()) return;
    if (!advancedBeforeValidation || !state.appState.isRunning || state.appState.isPaused) {
      return;
    }
    const selectedAfterAdvance = state.appState.selectedGame ? gameKey(state.appState.selectedGame) : null;
    if (selectedBeforeAdvance !== selectedAfterAdvance) {
      return;
    }

    const inCrashGrace =
      state.appState.resumedFromCrash != null &&
      Date.now() - state.appState.resumedFromCrash < CRASH_RECOVERY_GRACE_MS;
    if (inCrashGrace) {
      state.streamValidationGraceUntil = Date.now() + STREAM_VALIDATION_GRACE_MS;
    } else {
      if (state.appState.resumedFromCrash != null) {
        state.appState.resumedFromCrash = null;
      }
      await callbacks.onRotateStreamerIfInvalid();
      if (isStaleTick()) return;
      if (!state.appState.isRunning || state.appState.isPaused) {
        return;
      }
    }
    await callbacks.onAttemptAutoClaimChannelPointsBonus();
    if (isStaleTick()) return;

    const claimedAny = await callbacks.onAutoClaimClaimableDrops();
    if (isStaleTick()) return;
    // Skip the post-claim reconciliation fetch if this tick already did a full
    // campaign+inventory refresh moments ago (isFullTick above) — that data is
    // still fresh and autoClaim already applied the claim locally.
    if (claimedAny && !isFullTick) {
      await callbacks.onRefreshDropsData({
        includeCampaignFetch: true,
        includeInventoryFetch: true,
        forceInventoryFetch: true,
      });
      if (isStaleTick()) return;
      state.lastFullRefreshAt = Date.now();
    }
    await callbacks.onAdvanceQueueIfCompleted();
  } finally {
    clearTimeout(tickWatchdogTimer);
    state.monitorTickInFlight = false;
    await callbacks.onSaveTimingState(state);
  }
}

export interface RefreshDropsDataCallbacks {
  onFetchDropsSnapshotFromApi: (force?: boolean) => Promise<DropsSnapshot | null>;
  onFetchInventorySnapshotFromApi?: (
    baseDrops: TwitchDrop[],
    force?: boolean,
  ) => Promise<DropsSnapshot | null>;
  onEvaluateDropTransitions: (previousCompletedKeys: Set<string>) => Promise<void>;
  onSaveState: (state: ServiceWorkerState) => Promise<void>;
}

export interface RefreshDropsDataDeps {
  replaceAvailableGames: (games: TwitchGame[]) => TwitchGame[];
  getGameDisplayLabel: (game: TwitchGame) => string;
  projectDropsSnapshot: (state: ServiceWorkerState, snapshot: DropsSnapshot) => void;
  normalizeQueueSelection: (state: ServiceWorkerState, games: TwitchGame[], dropVanished?: boolean) => void;
}

export async function refreshDropsData(
  state: ServiceWorkerState,
  options: {
    includeCampaignFetch?: boolean;
    includeInventoryFetch?: boolean;
    forceInventoryFetch?: boolean;
    suppressNotifications?: boolean;
  },
  callbacks: RefreshDropsDataCallbacks,
  deps: RefreshDropsDataDeps,
): Promise<void> {
  const includeCampaignFetch = options.includeCampaignFetch ?? false;
  const includeInventoryFetch = options.includeInventoryFetch ?? state.appState.isRunning;
  const previousCompletedKeys = completedDropKeys(state.appState.completedDrops);
  const previousSnapshotForClaims =
    state.cachedDropsSnapshot.length > 0 ? state.cachedDropsSnapshot : state.appState.allDrops;
  let games = state.appState.availableGames;
  let drops = state.cachedDropsSnapshot.length > 0 ? state.cachedDropsSnapshot : state.appState.allDrops;
  let apiSnapshotUsed = false;

  if (includeCampaignFetch) {
    const apiSnapshot = await callbacks.onFetchDropsSnapshotFromApi();
    if (apiSnapshot) {
      state.lastFullRefreshAt = Date.now();
      games =
        apiSnapshot.games.length > 0
          ? deps.replaceAvailableGames(apiSnapshot.games)
          : state.appState.availableGames;
      drops = apiSnapshot.drops;
      if (apiSnapshot.drops.length > 0) {
        state.cachedDropsSnapshot = apiSnapshot.drops;
      } else if (apiSnapshot.games.length === 0) {
        state.cachedDropsSnapshot = [];
      } else if (state.cachedDropsSnapshot.length > 0) {
        drops = state.cachedDropsSnapshot;
      }
      if (apiSnapshot.campaignChannelsMap) {
        state.cachedCampaignChannelsMap = apiSnapshot.campaignChannelsMap;
      }
      apiSnapshotUsed = true;
    }
  } else if (includeInventoryFetch && callbacks.onFetchInventorySnapshotFromApi) {
    const baseDrops = state.cachedDropsSnapshot.length > 0 ? state.cachedDropsSnapshot : drops;
    if (baseDrops.length > 0) {
      const inventorySnapshot = await callbacks.onFetchInventorySnapshotFromApi(
        baseDrops,
        options.forceInventoryFetch,
      );
      if (inventorySnapshot?.drops.length) {
        drops = inventorySnapshot.drops;
        state.cachedDropsSnapshot = inventorySnapshot.drops;
        apiSnapshotUsed = true;
      }
    }
  }

  if (
    !includeCampaignFetch &&
    !includeInventoryFetch &&
    drops.length === 0 &&
    state.appState.allDrops.length > 0
  ) {
    drops = state.appState.allDrops;
  }

  if (includeCampaignFetch && !apiSnapshotUsed && state.cachedDropsSnapshot.length > 0) {
    drops = state.cachedDropsSnapshot;
  }

  if (drops.length === 0 && state.appState.allDrops.length > 0 && !apiSnapshotUsed) {
    drops = state.appState.allDrops;
  }

  deps.projectDropsSnapshot(state, {
    games,
    drops,
    updatedAt: Date.now(),
  });
  deps.normalizeQueueSelection(state, state.appState.availableGames);

  const newlyClaimed = detectNewlyClaimedDrops(drops, previousSnapshotForClaims);
  if (newlyClaimed.length > 0) {
    await recordClaimedDrops(state, newlyClaimed);
  }

  if (!options.suppressNotifications) {
    await callbacks.onEvaluateDropTransitions(previousCompletedKeys);
  }
  await callbacks.onSaveState(state);
}

export interface HandleSetSelectedGameCallbacks {
  onTrackActivity: (reason: string) => Promise<void>;
  onEnsureWorkspace: () => Promise<void>;
  onRefreshDropsData: (opts?: {
    includeCampaignFetch?: boolean;
    includeInventoryFetch?: boolean;
    forceInventoryFetch?: boolean;
    suppressNotifications?: boolean;
  }) => Promise<void>;
  onOpenBestStreamer: () => Promise<boolean>;
  onSaveState: (state: ServiceWorkerState) => Promise<void>;
  onSaveTimingState: (state: ServiceWorkerState) => Promise<void>;
}

export interface HandleSetSelectedGameDeps {
  resolveGameFromState: (state: ServiceWorkerState, game: TwitchGame) => TwitchGame;
  removeGameFromQueue: (state: ServiceWorkerState, game: TwitchGame) => void;
  splitDropsForSelectedGame: (state: ServiceWorkerState, allDrops: TwitchDrop[]) => void;
  getGameDisplayLabel: (game: TwitchGame) => string;
  logDebug: (message: string, context?: unknown) => void;
  logWarn: (message: string, context?: unknown) => void;
}

export async function handleSetSelectedGame(
  state: ServiceWorkerState,
  payload: { game: TwitchGame },
  callbacks: HandleSetSelectedGameCallbacks,
  deps: HandleSetSelectedGameDeps,
): Promise<{ success: boolean }> {
  await callbacks.onTrackActivity('set-selected-game');
  const selectedGame = deps.resolveGameFromState(state, payload.game);
  deps.logDebug('Selected game changed', {
    payloadGameId: payload.game.id,
    payloadCampaignId: payload.game.campaignId ?? null,
    payloadGameName: deps.getGameDisplayLabel(payload.game),
    gameId: selectedGame.id,
    campaignId: selectedGame.campaignId ?? null,
    gameName: deps.getGameDisplayLabel(selectedGame),
    running: state.appState.isRunning,
    availableGames: state.appState.availableGames.length,
  });
  state.appState.selectedGame = selectedGame;
  state.appState.completionNotified = false;
  state.invalidStreamChecks = 0;
  state.lastTrackedProgress = -1;
  state.lastTrackedMinutes = -1;
  state.lastTrackedDropKey = null;
  state.lastProgressAdvanceAt = 0;
  state.noProgressRotationAttempts = 0;
  if (state.appState.isRunning && !state.appState.isPaused) {
    deps.removeGameFromQueue(state, selectedGame);
    state.appState.queue = [selectedGame, ...state.appState.queue];
  }
  if (state.appState.isRunning && !state.appState.isPaused) {
    await callbacks.onEnsureWorkspace();
  }
  await callbacks.onRefreshDropsData({
    includeCampaignFetch: true,
    includeInventoryFetch: true,
    forceInventoryFetch: true,
    suppressNotifications: true,
  });
  if (state.appState.selectedGame) {
    const canonicalSelected = deps.resolveGameFromState(state, state.appState.selectedGame);
    if (
      canonicalSelected.id !== state.appState.selectedGame.id ||
      canonicalSelected.campaignId !== state.appState.selectedGame.campaignId
    ) {
      deps.logDebug('Selected game canonicalized after refresh', {
        previousId: state.appState.selectedGame.id,
        previousCampaignId: state.appState.selectedGame.campaignId ?? null,
        nextId: canonicalSelected.id,
        nextCampaignId: canonicalSelected.campaignId ?? null,
        name: deps.getGameDisplayLabel(canonicalSelected),
      });
      state.appState.selectedGame = canonicalSelected;
      deps.splitDropsForSelectedGame(
        state,
        state.cachedDropsSnapshot.length > 0 ? state.cachedDropsSnapshot : state.appState.allDrops,
      );
    }
  }
  if (state.appState.pendingDrops.length === 0 && state.appState.completedDrops.length === 0) {
    deps.logWarn('No rewards found after selected game refresh', {
      selectedGame: state.appState.selectedGame
        ? deps.getGameDisplayLabel(state.appState.selectedGame)
        : null,
      cachedDrops: state.cachedDropsSnapshot.length,
    });
  }
  if (state.appState.isRunning && !state.appState.isPaused) {
    state.appState.activeStreamer = null;
    await callbacks.onOpenBestStreamer();
  }
  await callbacks.onSaveState(state);
  await callbacks.onSaveTimingState(state);
  return { success: true };
}

export interface HandleAddToQueueDeps {
  resolveGameFromState: (state: ServiceWorkerState, game: TwitchGame) => TwitchGame;
  evaluateDropsForGame: (
    game: TwitchGame,
    drops: TwitchDrop[],
  ) => { allDrops: TwitchDrop[]; hasFarmableDrops: boolean };
  getGameDisplayLabel: (game: TwitchGame) => string;
}

export async function handleAddToQueue(
  state: ServiceWorkerState,
  payload: { game?: TwitchGame },
  callbacks: {
    onTrackActivity: (reason: string) => Promise<void>;
    onSaveState: (state: ServiceWorkerState) => Promise<void>;
  },
  deps: HandleAddToQueueDeps,
): Promise<{
  success: boolean;
  added?: boolean;
  reason?: string;
  game?: TwitchGame;
  queueLength?: number;
  error?: string;
}> {
  await callbacks.onTrackActivity('add-to-queue');
  if (!payload?.game) {
    return { success: false, error: 'No game provided.' };
  }

  const targetGame = deps.resolveGameFromState(state, payload.game);
  if (queueContainsGame(state, targetGame)) {
    return { success: true, added: false, reason: 'already-queued', game: targetGame };
  }

  const { allDrops, hasFarmableDrops } = deps.evaluateDropsForGame(targetGame, state.cachedDropsSnapshot);
  if (allDrops.length > 0 && !hasFarmableDrops) {
    await callbacks.onSaveState(state);
    return { success: true, added: false, reason: 'already-completed', game: targetGame };
  }

  state.appState.queue.push(targetGame);
  await callbacks.onSaveState(state);
  return { success: true, added: true, game: targetGame, queueLength: state.appState.queue.length };
}

export async function handleRemoveFromQueue(
  state: ServiceWorkerState,
  payload: { game?: TwitchGame; gameId?: string; campaignId?: string },
  callbacks: {
    onTrackActivity: (reason: string) => Promise<void>;
    onSaveState: (state: ServiceWorkerState) => Promise<void>;
  },
  deps: {
    removeGameFromQueue: (state: ServiceWorkerState, game: TwitchGame) => void;
    sameCampaignId: (left?: string | null, right?: string | null) => boolean;
  },
): Promise<{ success: boolean; removed: number; queueLength: number }> {
  await callbacks.onTrackActivity('remove-from-queue');
  const before = state.appState.queue.length;

  if (payload?.game) {
    deps.removeGameFromQueue(state, payload.game);
  } else {
    const targetGameId = payload?.gameId;
    const targetCampaignId = payload?.campaignId;
    state.appState.queue = state.appState.queue.filter((game) => {
      if (targetGameId && game.id === targetGameId) return false;
      if (targetCampaignId && deps.sameCampaignId(game.campaignId, targetCampaignId)) return false;
      return true;
    });
  }

  const removed = Math.max(0, before - state.appState.queue.length);

  if (
    state.appState.selectedGame &&
    !state.appState.isRunning &&
    !state.appState.queue.some((g) => queueEntryMatchesGame(state, g, state.appState.selectedGame!))
  ) {
    state.appState.selectedGame = state.appState.queue[0] ?? null;
  }

  await callbacks.onSaveState(state);
  return { success: true, removed, queueLength: state.appState.queue.length };
}

export async function handleReorderQueue(
  state: ServiceWorkerState,
  payload: { fromIndex?: number; toIndex?: number },
  callbacks: {
    onTrackActivity: (reason: string) => Promise<void>;
    onSaveState: (state: ServiceWorkerState) => Promise<void>;
  },
): Promise<{ success: boolean; reordered?: boolean; error?: string; queueLength?: number }> {
  await callbacks.onTrackActivity('reorder-queue');

  if (state.appState.isRunning) {
    return { success: false, error: 'Cannot reorder queue while farming is active.' };
  }

  const fromIndex = payload?.fromIndex;
  const toIndex = payload?.toIndex;
  if (
    typeof fromIndex !== 'number' ||
    typeof toIndex !== 'number' ||
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex)
  ) {
    return { success: false, error: 'Invalid queue indices.' };
  }

  const reordered = reorderQueue(state, fromIndex, toIndex);
  if (!reordered) {
    return { success: false, error: 'Invalid queue indices.' };
  }

  await callbacks.onSaveState(state);
  return { success: true, reordered: true, queueLength: state.appState.queue.length };
}
