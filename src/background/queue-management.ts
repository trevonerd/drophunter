import { browser } from '../shared/browser-api.ts';
import { haveAllDropsExpiredOrVanished } from '../shared/drops';
import { findMatchingGame, gameKey, getGameDisplayLabel } from '../shared/game-selection';
import { normalizeToken } from '../shared/matching';
import {
  applyRecoveryStatus,
  applyTerminalStopStatus,
  clearRecoveryStatus,
  clearTerminalStopStatus,
} from '../shared/runtime-status';
import { DropsSnapshot, TwitchDrop, TwitchGame, TwitchStreamer } from '../types';
import { detectNewlyClaimedDrops, recordClaimedDrops } from './claim-log.ts';
import {
  CRASH_RECOVERY_GRACE_MS,
  FULL_REFRESH_INTERVAL_MS,
  INVALID_STREAM_THRESHOLD,
  STREAM_ROTATE_COOLDOWN_MS,
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
import type { ServiceWorkerState } from './service-worker';
import { saveTimingState as saveTimingStateExt } from './state-persistence';
import {
  classifyStreamHealth,
  computeEffectiveStallThreshold,
  computeRecoveryBackoffMs,
  MAX_NO_STREAMERS_RETRIES,
  MAX_PERSISTENT_RECOVERY_CYCLES,
  MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS,
  NO_DROPS_SIGNAL_STALL_THRESHOLD_MS,
  NO_STREAMERS_RETRY_MS,
  nextNoProgressRotationAttempts,
  OFFLINE_CONFIRMATION_CHECKS,
  STALLED_PROGRESS_RETRY_MS,
  StreamRotationReason,
} from './stream-rotation';
import { PickStreamerResult, StreamerSelectionPreferences } from './streamer-selection';

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

// ============================================================================
// Helper Functions (internal)
// ============================================================================

function resetNoProgressRotationAttempts(state: ServiceWorkerState) {
  state.noProgressRotationAttempts = 0;
}

export function clearRecoveryState(state: ServiceWorkerState) {
  state.recoveryBackoffUntil = 0;
  state.lastRecoveryAttemptAt = 0;
  state.stalledRecoveryAttempts = 0;
  state.recoveryNotificationSent = false;
  state.appState = clearRecoveryStatus(state.appState);
}

export function clearStopState(state: ServiceWorkerState) {
  state.appState = clearTerminalStopStatus(state.appState);
}

function applyRecoveryState(state: ServiceWorkerState, reason: StreamRotationReason, retryAt: number | null) {
  state.appState = applyRecoveryStatus(state.appState, {
    reason,
    retryAt,
    attempts: state.stalledRecoveryAttempts,
  });
}

function clearNoStreamersRecoveryState(state: ServiceWorkerState) {
  if (state.appState.recoveryReason !== 'no-streamers') {
    return;
  }
  state.recoveryBackoffUntil = 0;
  state.lastRecoveryAttemptAt = 0;
  state.appState = clearRecoveryStatus(state.appState);
}

function applyNoStreamersRecoveryState(state: ServiceWorkerState, retryAt: number, attempts: number) {
  state.recoveryBackoffUntil = retryAt;
  state.lastRecoveryAttemptAt = Date.now();
  state.appState = applyRecoveryStatus(state.appState, {
    reason: 'no-streamers',
    retryAt,
    attempts,
  });
}

function shouldKeepStreamerWhileDropProgresses(input: {
  currentDrop: TwitchDrop | null;
  lastProgressAdvanceAt: number;
  now: number;
  effectiveThresholdMs: number;
  reason: StreamRotationReason | null;
}): boolean {
  const fatalReason =
    input.reason === 'offline' ||
    input.reason === 'navigated-away' ||
    input.reason === 'open-failed' ||
    input.reason === 'no-streamers' ||
    input.reason === 'stalled-progress';
  return (
    !fatalReason &&
    input.currentDrop != null &&
    input.lastProgressAdvanceAt > 0 &&
    input.now - input.lastProgressAdvanceAt < input.effectiveThresholdMs
  );
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

export function applyStopState(state: ServiceWorkerState, reason: string, message: string | null) {
  clearRecoveryState(state);
  state.appState = applyTerminalStopStatus(state.appState, { reason, message });
}

export async function enterPersistentRecovery(
  state: ServiceWorkerState,
  reason: StreamRotationReason,
  message: string,
  opts?: {
    onSkipCurrentGame?: () => Promise<void>;
    onNotify?: (title: string, message: string, priority?: number) => Promise<void>;
  },
) {
  state.stalledRecoveryAttempts += 1;

  if (state.stalledRecoveryAttempts > MAX_PERSISTENT_RECOVERY_CYCLES) {
    if (opts?.onSkipCurrentGame) {
      await opts.onSkipCurrentGame();
    }
    return;
  }

  const backoffMs = computeRecoveryBackoffMs(state.stalledRecoveryAttempts);
  state.recoveryBackoffUntil = Date.now() + backoffMs;
  state.lastRecoveryAttemptAt = Date.now();
  applyRecoveryState(state, reason, state.recoveryBackoffUntil);
  logWarn('Entering persistent recovery mode', {
    reason,
    stalledRecoveryAttempts: state.stalledRecoveryAttempts,
    backoffMs,
    retryAt: state.recoveryBackoffUntil,
  });
  if (!state.recoveryNotificationSent) {
    state.recoveryNotificationSent = true;
    await opts?.onNotify?.('DropHunter is still recovering', message, 1);
  }
}

export async function acquireStreamerForSelectedGame(
  state: ServiceWorkerState,
  opts?: {
    onOpenStreamer?: () => Promise<boolean>;
    onSkipCurrentGame?: () => Promise<void>;
    onSaveState?: () => Promise<void>;
    onSaveTimingState?: (state: ServiceWorkerState) => Promise<void>;
  },
): Promise<boolean> {
  if (!state.appState.selectedGame) {
    return false;
  }

  const now = Date.now();
  const isNoStreamersRecovery = state.appState.recoveryReason === 'no-streamers';
  if (isNoStreamersRecovery && state.recoveryBackoffUntil > now) {
    return false;
  }

  const opened = opts?.onOpenStreamer ? await opts.onOpenStreamer() : false;
  if (opened) {
    clearNoStreamersRecoveryState(state);
    if (opts?.onSaveState) {
      await opts.onSaveState();
    }
    if (opts?.onSaveTimingState) {
      await opts.onSaveTimingState(state);
    }
    return true;
  }

  const previousAttempts = isNoStreamersRecovery ? Math.max(0, state.appState.recoveryAttempts ?? 0) : 0;
  if (previousAttempts >= MAX_NO_STREAMERS_RETRIES) {
    if (opts?.onSkipCurrentGame) {
      await opts.onSkipCurrentGame();
    }
    if (opts?.onSaveState) {
      await opts.onSaveState();
    }
    if (opts?.onSaveTimingState) {
      await opts.onSaveTimingState(state);
    }
    return false;
  }

  const retryAt = now + NO_STREAMERS_RETRY_MS;
  applyNoStreamersRecoveryState(state, retryAt, previousAttempts + 1);
  logWarn('No live streamers found; scheduling one retry', {
    game: getGameDisplayLabel(state.appState.selectedGame),
    retryAt,
    attempts: previousAttempts + 1,
  });
  if (opts?.onSaveState) {
    await opts.onSaveState();
  }
  if (opts?.onSaveTimingState) {
    await opts.onSaveTimingState(state);
  }
  return false;
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

export async function rotateStreamer(
  state: ServiceWorkerState,
  reason: StreamRotationReason,
  opts?: {
    onOpenStreamer?: () => Promise<boolean>;
    onSaveState?: () => Promise<void>;
    onSaveTimingState?: (state: ServiceWorkerState) => Promise<void>;
    onEnterPersistentRecovery?: (
      state: ServiceWorkerState,
      reason: StreamRotationReason,
      message: string,
      opts?: {
        onSkipCurrentGame?: () => Promise<void>;
        onNotify?: (title: string, message: string, priority?: number) => Promise<void>;
      },
    ) => Promise<void>;
    onSkipCurrentGame?: () => Promise<void>;
  },
): Promise<boolean> {
  state.noProgressRotationAttempts = nextNoProgressRotationAttempts(state.noProgressRotationAttempts, reason);

  state.appState.lastRotationReason = reason;
  state.appState.lastRotationAt = Date.now();
  state.lastStreamRotationAt = Date.now();
  // Give the next streamer a fresh stall window so it is not judged against the old timeline.
  state.lastProgressAdvanceAt = Date.now();
  state.offlineChecks = 0;
  // Remember the channel we are leaving so the next selection picks a different one.
  if (state.appState.activeStreamer?.name) {
    state.avoidStreamerName = state.appState.activeStreamer.name;
  }
  state.appState.activeStreamer = null;

  let opened = false;
  if (opts?.onOpenStreamer) {
    opened = await opts.onOpenStreamer();
  }
  if (!opened && reason === 'stalled-progress' && opts?.onSkipCurrentGame) {
    await opts.onSkipCurrentGame();
  }

  if (opts?.onSaveState) {
    await opts.onSaveState();
  }
  if (opts?.onSaveTimingState) {
    await opts.onSaveTimingState(state);
  }
  return opened;
}

export async function rotateStreamerIfInvalid(
  state: ServiceWorkerState,
  opts?: {
    onFetchStreamContext?: (tabId: number) => Promise<{
      channelName: string;
      categorySlug: string;
      categoryLabel: string;
      streamTitle: string;
      titleContainsDrops: boolean;
      hasDropsSignal: boolean;
      isLive: boolean;
      pageUrl: string;
    } | null>;
    onResolveCategorySlug?: (game: TwitchGame) => Promise<string>;
    onAttemptPlaybackSelfHeal?: (tabId: number) => Promise<void>;
    onSaveState?: () => Promise<void>;
    onSaveTimingState?: (state: ServiceWorkerState) => Promise<void>;
    onRotateStreamer?: (
      state: ServiceWorkerState,
      reason: StreamRotationReason,
      opts?: {
        onOpenStreamer?: () => Promise<boolean>;
        onSaveState?: () => Promise<void>;
        onSaveTimingState?: (state: ServiceWorkerState) => Promise<void>;
        onEnterPersistentRecovery?: (
          state: ServiceWorkerState,
          reason: StreamRotationReason,
          message: string,
          opts?: {
            onSkipCurrentGame?: () => Promise<void>;
            onNotify?: (title: string, message: string, priority?: number) => Promise<void>;
          },
        ) => Promise<void>;
        onSkipCurrentGame?: () => Promise<void>;
      },
    ) => Promise<boolean>;
    onOpenStreamer?: () => Promise<boolean>;
    onEnterPersistentRecovery?: (
      state: ServiceWorkerState,
      reason: StreamRotationReason,
      message: string,
      opts?: {
        onSkipCurrentGame?: () => Promise<void>;
        onNotify?: (title: string, message: string, priority?: number) => Promise<void>;
      },
    ) => Promise<void>;
    onSkipCurrentGame?: () => Promise<void>;
    onForceRefreshDropsData?: () => Promise<void>;
  },
) {
  if (!state.appState.selectedGame) {
    return;
  }

  if (!state.appState.tabId) {
    if (
      state.recoveryBackoffUntil > 0 &&
      Date.now() < state.recoveryBackoffUntil &&
      (state.appState.recoveryReason === 'open-failed' || state.appState.recoveryReason === 'no-streamers')
    ) {
      return;
    }
    if (opts?.onRotateStreamer) {
      await opts.onRotateStreamer(state, 'open-failed', {
        onOpenStreamer: opts?.onOpenStreamer,
        onSaveState: opts?.onSaveState,
        onSaveTimingState: opts?.onSaveTimingState,
        onEnterPersistentRecovery: opts?.onEnterPersistentRecovery,
        onSkipCurrentGame: opts?.onSkipCurrentGame,
      });
    }
    return;
  }

  const tab = await browser.tabs.get(state.appState.tabId).catch(() => null);
  if (!tab?.id) {
    state.appState.tabId = null;
    state.appState.activeStreamer = null;
    if (
      state.recoveryBackoffUntil > 0 &&
      Date.now() < state.recoveryBackoffUntil &&
      (state.appState.recoveryReason === 'open-failed' || state.appState.recoveryReason === 'no-streamers')
    ) {
      return;
    }
    if (opts?.onRotateStreamer) {
      await opts.onRotateStreamer(state, 'open-failed', {
        onOpenStreamer: opts?.onOpenStreamer,
        onSaveState: opts?.onSaveState,
        onSaveTimingState: opts?.onSaveTimingState,
        onEnterPersistentRecovery: opts?.onEnterPersistentRecovery,
        onSkipCurrentGame: opts?.onSkipCurrentGame,
      });
    }
    return;
  }

  const context = opts?.onFetchStreamContext ? await opts.onFetchStreamContext(tab.id) : null;

  const now = Date.now();
  if (now < state.streamValidationGraceUntil) {
    return;
  }
  const effectiveThreshold = computeEffectiveStallThreshold(state.appState.currentDrop?.requiredMinutes);

  if (!context) {
    const tabUrl = tab.url ?? '';
    const isStillOnTwitch = /^https?:\/\/([^/]*\.)?twitch\.tv\//i.test(tabUrl);
    if (!isStillOnTwitch) {
      logInfo('Managed tab navigated away from Twitch', { tabUrl });
      state.invalidStreamChecks = INVALID_STREAM_THRESHOLD;
    } else if (
      shouldKeepStreamerWhileDropProgresses({
        currentDrop: state.appState.currentDrop,
        lastProgressAdvanceAt: state.lastProgressAdvanceAt,
        now,
        effectiveThresholdMs: effectiveThreshold,
        reason: 'missing-context',
      })
    ) {
      logDebug('Stream context missing but drop progress is recent; keeping current streamer', {
        tabUrl,
        lastProgressAdvanceAt: state.lastProgressAdvanceAt,
        effectiveThresholdMs: effectiveThreshold,
      });
      state.invalidStreamChecks = 0;
      return;
    } else {
      state.invalidStreamChecks += 1;
    }
    if (state.invalidStreamChecks >= INVALID_STREAM_THRESHOLD) {
      if (now - state.lastStreamRotationAt < STREAM_ROTATE_COOLDOWN_MS) {
        return;
      }
      state.invalidStreamChecks = 0;
      if (opts?.onRotateStreamer) {
        await opts.onRotateStreamer(state, isStillOnTwitch ? 'missing-context' : 'navigated-away', {
          onOpenStreamer: opts?.onOpenStreamer,
          onSaveState: opts?.onSaveState,
          onSaveTimingState: opts?.onSaveTimingState,
          onEnterPersistentRecovery: opts?.onEnterPersistentRecovery,
          onSkipCurrentGame: opts?.onSkipCurrentGame,
        });
      }
    }
    return;
  }

  const sameChannel =
    !state.appState.activeStreamer || context.channelName === state.appState.activeStreamer.name;
  const hasDropsSignal = context.titleContainsDrops || context.hasDropsSignal;
  const selectedCategorySlug = opts?.onResolveCategorySlug
    ? normalizeToken(await opts.onResolveCategorySlug(state.appState.selectedGame))
    : '';
  const contextCategorySlug = normalizeToken(context.categorySlug);
  const sameGame =
    selectedCategorySlug.length === 0 || contextCategorySlug.length === 0
      ? true
      : selectedCategorySlug === contextCategorySlug;
  const campaignGone = haveAllDropsExpiredOrVanished(state.appState.allDrops, state.previousAllDropsCount);
  const expectsDropsSignal =
    state.appState.currentDrop != null ||
    state.appState.pendingDrops.some((drop) => drop.dropType !== 'event-based') ||
    campaignGone;

  logDebug('Stream health inputs', {
    expectsDropsSignal,
    hasDropsSignal,
    campaignGone,
    currentDrop: !!state.appState.currentDrop,
    farmablePending: state.appState.pendingDrops.some((d) => d.dropType !== 'event-based'),
  });

  // A stream that expects but shows no Drops signal is likely the wrong channel; shorten its
  // stall window so we abandon it sooner instead of wasting the full threshold on it.
  const noDropsSignal = expectsDropsSignal && !hasDropsSignal;
  const stallThreshold = noDropsSignal
    ? Math.min(effectiveThreshold, NO_DROPS_SIGNAL_STALL_THRESHOLD_MS)
    : effectiveThreshold;
  const progressStalled =
    state.lastProgressAdvanceAt > 0 &&
    state.appState.currentDrop != null &&
    now - state.lastProgressAdvanceAt >= stallThreshold;

  const health = classifyStreamHealth({
    isLive: context.isLive,
    sameChannel,
    sameGame,
    hasDropsSignal,
    progressStalled,
    expectsDropsSignal,
  });

  // A live reading clears any pending offline confirmation streak.
  if (context.isLive) {
    state.offlineChecks = 0;
  }

  if (health.isHealthy) {
    state.invalidStreamChecks = 0;
    return;
  }

  if (health.forceImmediateRotation && health.reason === 'offline') {
    // Require consecutive offline readings before reloading — a single one is usually a
    // transient ad break or player re-render, not a real outage. Reloading then would be
    // the "tab reloads for no reason while the drop is still advancing" bug.
    state.offlineChecks += 1;
    if (state.offlineChecks < OFFLINE_CONFIRMATION_CHECKS) {
      logDebug('Offline reading not yet confirmed; keeping current streamer', {
        offlineChecks: state.offlineChecks,
        required: OFFLINE_CONFIRMATION_CHECKS,
        channel: state.appState.activeStreamer?.name ?? context.channelName,
      });
      return;
    }
    if (state.appState.recoveryReason === 'stalled-progress') {
      clearRecoveryState(state);
    }
    // Respect backoff when already in offline/open-failed recovery — prevents a
    // fast rotation loop when no replacement streamer is available (e.g. event-only
    // drops with no live channels).
    if (
      state.recoveryBackoffUntil > 0 &&
      now < state.recoveryBackoffUntil &&
      (state.appState.recoveryReason === 'offline' ||
        state.appState.recoveryReason === 'open-failed' ||
        state.appState.recoveryReason === 'no-streamers')
    ) {
      logDebug('Offline detected but in recovery backoff, skipping rotation', {
        recoveryReason: state.appState.recoveryReason,
        backoffRemainingMs: state.recoveryBackoffUntil - now,
      });
      return;
    }
    // If persistent recovery cycles are exhausted, skip the game rather than
    // looping forever — handles the case where no replacement streamer exists.
    if (state.stalledRecoveryAttempts > MAX_PERSISTENT_RECOVERY_CYCLES) {
      logWarn('Offline recovery exhausted — skipping game', {
        stalledRecoveryAttempts: state.stalledRecoveryAttempts,
        channel: state.appState.activeStreamer?.name ?? context.channelName,
      });
      if (opts?.onSkipCurrentGame) {
        await opts.onSkipCurrentGame();
      }
      return;
    }
    state.invalidStreamChecks = 0;
    logInfo('Offline stream detected, rotating immediately', {
      channel: state.appState.activeStreamer?.name ?? context.channelName,
      pageUrl: context.pageUrl,
    });
    if (opts?.onRotateStreamer) {
      await opts.onRotateStreamer(state, 'offline', {
        onOpenStreamer: opts?.onOpenStreamer,
        onSaveState: opts?.onSaveState,
        onSaveTimingState: opts?.onSaveTimingState,
        onEnterPersistentRecovery: opts?.onEnterPersistentRecovery,
        onSkipCurrentGame: opts?.onSkipCurrentGame,
      });
    }
    return;
  }

  if (
    shouldKeepStreamerWhileDropProgresses({
      currentDrop: state.appState.currentDrop,
      lastProgressAdvanceAt: state.lastProgressAdvanceAt,
      now,
      effectiveThresholdMs: effectiveThreshold,
      reason: health.reason,
    })
  ) {
    logDebug('Stream validation failed but drop progress is active; keeping current streamer', {
      reason: health.reason,
      lastProgressAdvanceAt: state.lastProgressAdvanceAt,
      effectiveThresholdMs: effectiveThreshold,
      progress: state.appState.currentDrop?.progress ?? null,
      currentMinutes: state.appState.currentDrop?.currentMinutes ?? null,
      requiredMinutes: state.appState.currentDrop?.requiredMinutes ?? null,
    });
    state.invalidStreamChecks = 0;
    return;
  }

  if (health.reason === 'stalled-progress') {
    if (state.stalledRecoveryAttempts >= MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS) {
      logWarn('Stalled progress recovery exhausted — skipping game', {
        stalledRecoveryAttempts: state.stalledRecoveryAttempts,
        maxAttempts: MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS,
        progress: state.appState.currentDrop?.progress ?? null,
        currentMinutes: state.appState.currentDrop?.currentMinutes ?? null,
      });
      if (opts?.onSkipCurrentGame) {
        await opts.onSkipCurrentGame();
      }
      return;
    }
    if (
      state.recoveryBackoffUntil > 0 &&
      now < state.recoveryBackoffUntil &&
      state.appState.recoveryReason === 'stalled-progress'
    ) {
      return;
    }
    if (state.stalledRecoveryAttempts === 0) {
      // Attempt 1: in-place playback self-heal before giving up the streamer (handles a
      // stuck player or ad without losing a good Drops channel).
      state.stalledRecoveryAttempts = 1;
      state.lastRecoveryAttemptAt = now;
      state.recoveryBackoffUntil = now + STALLED_PROGRESS_RETRY_MS;
      applyRecoveryState(state, 'stalled-progress', state.recoveryBackoffUntil);
      logInfo('Attempting in-place playback self-heal before rotating', {
        stalledRecoveryAttempts: state.stalledRecoveryAttempts,
        maxAttempts: MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS,
        recoveryBackoffUntil: state.recoveryBackoffUntil,
      });
      if (opts?.onAttemptPlaybackSelfHeal && tab.id) {
        await opts.onAttemptPlaybackSelfHeal(tab.id);
      }
      if (opts?.onSaveState) {
        await opts.onSaveState();
      }
      if (opts?.onSaveTimingState) {
        await opts.onSaveTimingState(state);
      }
      return;
    }
    // Attempts 2+: self-heal did not help. Before rotating, force a fresh campaign+inventory
    // poll — Twitch's claimed-rewards backend can lag behind its own notification/badge grant,
    // so a stale cached drop can look stalled when it is already done. If the refresh proves
    // progress (via detectRecoveryProof clearing stalledRecoveryAttempts) or the drop is gone,
    // skip rotating a perfectly good streamer for nothing.
    if (opts?.onForceRefreshDropsData) {
      await opts.onForceRefreshDropsData();
      if (state.stalledRecoveryAttempts === 0 || state.appState.currentDrop == null) {
        return;
      }
    }
    // Rotate to a DIFFERENT streamer. The stall threshold plus the self-heal backoff already
    // rate-limit this, so the generic rotation cooldown does not apply; advance the attempt
    // counter only when we actually rotate.
    state.stalledRecoveryAttempts = Math.min(
      MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS,
      state.stalledRecoveryAttempts + 1,
    );
    state.lastRecoveryAttemptAt = now;
    state.recoveryBackoffUntil = 0;
    state.invalidStreamChecks = 0;
    applyRecoveryState(state, 'stalled-progress', null);
    logInfo('Drop progress stalled, rotating to a different streamer', {
      stalledRecoveryAttempts: state.stalledRecoveryAttempts,
      maxAttempts: MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS,
      progress: state.appState.currentDrop?.progress ?? null,
      currentMinutes: state.appState.currentDrop?.currentMinutes ?? null,
      requiredMinutes: state.appState.currentDrop?.requiredMinutes ?? null,
      effectiveThresholdMs: stallThreshold,
      stalledForMs: now - state.lastProgressAdvanceAt,
    });
    if (opts?.onRotateStreamer) {
      await opts.onRotateStreamer(state, 'stalled-progress', {
        onOpenStreamer: opts?.onOpenStreamer,
        onSaveState: opts?.onSaveState,
        onSaveTimingState: opts?.onSaveTimingState,
        onEnterPersistentRecovery: opts?.onEnterPersistentRecovery,
        onSkipCurrentGame: opts?.onSkipCurrentGame,
      });
    }
    return;
  } else {
    state.invalidStreamChecks += health.invalidIncrement;
  }
  if (state.invalidStreamChecks < INVALID_STREAM_THRESHOLD) {
    return;
  }

  if (now - state.lastStreamRotationAt < STREAM_ROTATE_COOLDOWN_MS) {
    return;
  }

  state.invalidStreamChecks = 0;
  if (opts?.onRotateStreamer && health.reason) {
    await opts.onRotateStreamer(state, health.reason, {
      onOpenStreamer: opts?.onOpenStreamer,
      onSaveState: opts?.onSaveState,
      onSaveTimingState: opts?.onSaveTimingState,
      onEnterPersistentRecovery: opts?.onEnterPersistentRecovery,
      onSkipCurrentGame: opts?.onSkipCurrentGame,
    });
  }
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

export interface OpenBestStreamerCallbacks {
  onFetchDirectoryStreamersFromApi: (
    game: TwitchGame,
    forceRefresh?: boolean,
    language?: string,
  ) => Promise<TwitchStreamer[] & { languageFilterApplied: boolean }>;
  onOpenForegroundChannel: (streamer: TwitchStreamer) => Promise<void>;
}

function filterStreamersByAllowedChannels(
  streamers: TwitchStreamer[],
  allowed: string[] | null,
): TwitchStreamer[] {
  if (allowed == null || allowed.length === 0) {
    return streamers;
  }
  const allowedSet = new Set(allowed.map((channel) => channel.toLowerCase()));
  return streamers.filter((streamer) => allowedSet.has(streamer.name.toLowerCase()));
}

export async function openBestStreamerForSelectedGame(
  state: ServiceWorkerState,
  callbacks: OpenBestStreamerCallbacks,
  deps: {
    dropMatchesSelectedGame: (drop: TwitchDrop, selected: TwitchGame) => boolean;
    isDropCompleted: (drop: TwitchDrop) => boolean;
    getGameDisplayLabel: (game: TwitchGame) => string;
    resolveCategorySlug: (game: TwitchGame) => Promise<string>;
    pickStreamerForPreferences: (
      candidates: TwitchStreamer[],
      prefs: StreamerSelectionPreferences,
      randomFn: () => number,
      filterApplied: boolean,
    ) => PickStreamerResult;
    normalizePreferredStreamerLanguage: (lang?: string | null) => string | null | undefined;
  },
): Promise<boolean> {
  if (!state.appState.selectedGame) {
    logWarn('Unable to open streamer: no selected game');
    return false;
  }

  // Pre-farming guard — skip streamer search if all drops for this game are completed
  const dropsForGame = state.cachedDropsSnapshot.filter((drop) =>
    deps.dropMatchesSelectedGame(drop, state.appState.selectedGame!),
  );
  if (dropsForGame.length > 0 && dropsForGame.every((d) => deps.isDropCompleted(d))) {
    logInfo('Skipping streamer: all drops completed', {
      game: deps.getGameDisplayLabel(state.appState.selectedGame),
    });
    return false;
  }

  const resolvedSlug = await deps.resolveCategorySlug(state.appState.selectedGame);
  state.appState.selectedGame = {
    ...state.appState.selectedGame,
    categorySlug: resolvedSlug,
  };

  const streamers = await callbacks.onFetchDirectoryStreamersFromApi(
    state.appState.selectedGame,
    false,
    state.appState.preferredStreamerLanguage ?? '',
  );
  logDebug('Language filter applied to directory query', {
    language: state.appState.preferredStreamerLanguage ?? '',
    resultCount: streamers.length,
    filterApplied: streamers.languageFilterApplied,
  });
  if (!streamers.languageFilterApplied && state.appState.preferredStreamerLanguage) {
    logDebug('Language filter fallback: server-side filter returned 0 results, using unfiltered', {
      language: state.appState.preferredStreamerLanguage,
    });
  }

  // Per-campaign channel filtering — only use allowedChannels from PENDING campaigns
  const pendingDropsForGame = dropsForGame.filter((d) => !deps.isDropCompleted(d));
  const pendingCampaignIds = new Set(
    pendingDropsForGame.map((d) => d.campaignId).filter((id): id is string => Boolean(id)),
  );
  let allowed: string[] | null = null;
  let hasUnrestrictedCampaign = false;
  const restrictedChannels: string[] = [];
  pendingCampaignIds.forEach((cId) => {
    const channels = state.cachedCampaignChannelsMap[cId];
    if (channels == null) {
      hasUnrestrictedCampaign = true;
    } else {
      restrictedChannels.push(...channels);
    }
  });
  if (!hasUnrestrictedCampaign && restrictedChannels.length > 0) {
    allowed = [...new Set(restrictedChannels)];
  }
  // Fallback to game-level allowedChannels if no campaign mapping is available
  if (pendingCampaignIds.size === 0) {
    allowed = state.appState.selectedGame.allowedChannels ?? null;
  }

  logDebug('Streamer selection debug', {
    game: deps.getGameDisplayLabel(state.appState.selectedGame),
    pendingCampaignIds: Array.from(pendingCampaignIds),
    allowedChannels: allowed ?? 'null (any channel)',
    directoryStreamers: streamers.map((s) => s.name),
    directoryCount: streamers.length,
  });
  let candidates = filterStreamersByAllowedChannels(streamers, allowed);
  let selectionLanguageFilterApplied = streamers.languageFilterApplied;
  let selectionPreferences: StreamerSelectionPreferences = {
    mode: state.appState.streamerSelectionMode,
    preferredLanguage: state.appState.preferredStreamerLanguage,
  };
  let totalStreamersForNoAllowedWarning = streamers.length;
  if (allowed != null && allowed.length > 0) {
    const allowedSet = new Set(allowed.map((channel) => channel.toLowerCase()));
    logDebug('Filtered streamers by allowedChannels', {
      game: deps.getGameDisplayLabel(state.appState.selectedGame),
      beforeFilter: streamers.length,
      afterFilter: candidates.length,
      candidateNames: candidates.map((s) => s.name),
      rejected: streamers.filter((s) => !allowedSet.has(s.name.toLowerCase())).map((s) => s.name),
    });
  }

  if (candidates.length === 0 && allowed != null && allowed.length > 0 && streamers.languageFilterApplied) {
    const unfilteredStreamers = await callbacks.onFetchDirectoryStreamersFromApi(
      state.appState.selectedGame,
      false,
      '',
    );
    const unfilteredCandidates = filterStreamersByAllowedChannels(unfilteredStreamers, allowed);
    logDebug('Retrying streamer selection without preferred language', {
      game: deps.getGameDisplayLabel(state.appState.selectedGame),
      preferredLanguage: state.appState.preferredStreamerLanguage,
      beforeFilter: unfilteredStreamers.length,
      afterFilter: unfilteredCandidates.length,
      candidateNames: unfilteredCandidates.map((s) => s.name),
    });
    candidates = unfilteredCandidates;
    selectionLanguageFilterApplied = unfilteredStreamers.languageFilterApplied;
    totalStreamersForNoAllowedWarning = unfilteredStreamers.length;
    if (candidates.length > 0) {
      selectionPreferences = {
        mode: 'random',
        preferredLanguage: null,
      };
    }
  }

  if (candidates.length === 0 && allowed != null && allowed.length > 0 && streamers.length > 0) {
    logWarn('No allowed streamers are live for selected game', {
      game: deps.getGameDisplayLabel(state.appState.selectedGame),
      allowedChannels: allowed.length,
      totalStreamers: totalStreamersForNoAllowedWarning,
    });
  }
  // Skip the channel we just rotated away from, so a rotation actually changes streamer
  // instead of re-opening the same failing one. Never empty the pool over it. Only cleared
  // once a streamer is actually opened below, so a retry after an empty candidate pool
  // still avoids the same channel.
  const avoidName = state.avoidStreamerName;
  if (avoidName) {
    const withoutAvoided = candidates.filter(
      (candidate) => candidate.name.toLowerCase() !== avoidName.toLowerCase(),
    );
    if (withoutAvoided.length > 0 && withoutAvoided.length < candidates.length) {
      logDebug('Excluding previously failing streamer from selection', {
        avoid: avoidName,
        before: candidates.length,
        after: withoutAvoided.length,
      });
      candidates = withoutAvoided;
    }
  }
  const selection = deps.pickStreamerForPreferences(
    candidates,
    selectionPreferences,
    Math.random,
    selectionLanguageFilterApplied,
  );
  const streamer = selection.streamer;
  if (streamer) {
    logInfo('Opening selected streamer', {
      game: deps.getGameDisplayLabel(state.appState.selectedGame),
      selectionMode: selectionPreferences.mode,
      preferredLanguage: deps.normalizePreferredStreamerLanguage(selectionPreferences.preferredLanguage),
      preferredLanguageApplied: selection.preferredLanguageApplied,
      preferredLanguageMatches: selection.preferredLanguageMatches,
      activePoolSize: selection.activePoolSize,
      serverLanguageFilterApplied: selectionLanguageFilterApplied,
      streamer: streamer.name,
      viewers: streamer.viewerCount ?? null,
      broadcasterLanguage: streamer.broadcasterLanguage ?? null,
      candidates: candidates.length,
    });
    state.avoidStreamerName = null;
    await callbacks.onOpenForegroundChannel(streamer);
    return true;
  }

  logWarn('No streamer found for selected game', {
    game: deps.getGameDisplayLabel(state.appState.selectedGame),
    categorySlug: state.appState.selectedGame.categorySlug ?? null,
  });
  state.appState.activeStreamer = null;
  return false;
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
