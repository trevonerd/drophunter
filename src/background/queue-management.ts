import { haveAllDropsExpiredOrVanished } from '../shared/drops';
import {
  compareGamesForDisplayOrder,
  findMatchingGame,
  gameKey,
  getGameDisplayLabel,
  isSameGame,
} from '../shared/game-selection';
import { normalizeToken } from '../shared/matching';
import {
  applyRecoveryStatus,
  applyTerminalStopStatus,
  clearRecoveryStatus,
  clearTerminalStopStatus,
} from '../shared/runtime-status';
import { isExpiredGame } from '../shared/utils';
import { DropsSnapshot, TwitchDrop, TwitchGame, TwitchStreamer } from '../types';
import { CRASH_RECOVERY_GRACE_MS, STREAM_VALIDATION_GRACE_MS } from './constants';
import { logDebug, logInfo, logWarn } from './logging';
import type { ServiceWorkerState } from './service-worker';
import { saveTimingState as saveTimingStateExt } from './state-persistence';
import {
  classifyStreamHealth,
  computeEffectiveStallThreshold,
  computeRecoveryBackoffMs,
  MAX_NO_PROGRESS_ROTATION_ATTEMPTS,
  MAX_PERSISTENT_RECOVERY_CYCLES,
  nextNoProgressRotationAttempts,
  PROGRESS_STALL_THRESHOLD_MS,
  StreamRotationReason,
  shouldIncrementNoProgressRotationAttempts,
} from './stream-rotation';
import { PickStreamerResult, StreamerSelectionPreferences } from './streamer-selection';

// Constants needed from service-worker
const INVALID_STREAM_THRESHOLD = 8;
const STREAM_ROTATE_COOLDOWN_MS = 5 * 60_000;

// ============================================================================
// Helper Functions (internal)
// ============================================================================

function queueContainsGame(state: ServiceWorkerState, game: TwitchGame): boolean {
  return state.appState.queue.some((queuedGame) => isSameGame(queuedGame, game));
}

async function notify(title: string, message: string, priority = 2) {
  await chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
    priority,
  });
}

function resetNoProgressRotationAttempts(state: ServiceWorkerState) {
  state.noProgressRotationAttempts = 0;
}

function clearRecoveryState(state: ServiceWorkerState) {
  state.recoveryBackoffUntil = 0;
  state.lastRecoveryAttemptAt = 0;
  state.stalledRecoveryAttempts = 0;
  state.recoveryNotificationSent = false;
  state.appState = clearRecoveryStatus(state.appState);
}

function clearStopState(state: ServiceWorkerState) {
  state.appState = clearTerminalStopStatus(state.appState);
}

function applyRecoveryState(state: ServiceWorkerState, reason: StreamRotationReason, retryAt: number) {
  state.appState = applyRecoveryStatus(state.appState, {
    reason,
    retryAt,
    attempts: state.stalledRecoveryAttempts,
  });
}

// ============================================================================
// Main Exported Functions
// ============================================================================

export function normalizeQueueSelection(
  state: ServiceWorkerState,
  games: TwitchGame[],
  dropVanished = false,
) {
  if (!Array.isArray(state.appState.queue) || state.appState.queue.length === 0) {
    state.appState.queue = [];
    return;
  }

  const normalized: TwitchGame[] = [];
  const seen = new Set<string>();
  state.appState.queue.forEach((queuedGame) => {
    const resolved = findMatchingGame(queuedGame, games);
    if (!resolved && dropVanished && queuedGame.campaignId) {
      return;
    }
    const game = resolved ?? queuedGame;
    if (isExpiredGame(game)) {
      return;
    }
    const key = gameKey(game);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    normalized.push(game);
  });

  state.appState.queue = normalized;
}

export function removeGameFromQueue(state: ServiceWorkerState, game: TwitchGame) {
  state.appState.queue = state.appState.queue.filter((queuedGame) => !isSameGame(queuedGame, game));
}

export function resolveGameFromState(state: ServiceWorkerState, game: TwitchGame): TwitchGame {
  const resolved = findMatchingGame(game, state.appState.availableGames);
  if (resolved) {
    if (resolved.id !== game.id || resolved.campaignId !== game.campaignId) {
      logDebug('Resolved selected game to canonical campaign', {
        inputId: game.id,
        inputCampaignId: game.campaignId ?? null,
        inputName: getGameDisplayLabel(game),
        resolvedId: resolved.id,
        resolvedCampaignId: resolved.campaignId ?? null,
        resolvedName: getGameDisplayLabel(resolved),
      });
    }
    return resolved;
  }

  const byNameCandidates = state.appState.availableGames
    .filter((candidate) => normalizeToken(candidate.name) === normalizeToken(game.name))
    .sort((left, right) => {
      if (Boolean(left.campaignId) !== Boolean(right.campaignId)) {
        return left.campaignId ? 1 : -1;
      }
      return compareGamesForDisplayOrder(left, right);
    });
  const byNamePreferred = byNameCandidates[0];
  if (byNamePreferred) {
    logDebug('Resolved selected game by exact name fallback', {
      inputId: game.id,
      inputCampaignId: game.campaignId ?? null,
      resolvedId: byNamePreferred.id,
      resolvedCampaignId: byNamePreferred.campaignId ?? null,
      name: game.name,
    });
    return byNamePreferred;
  }

  return game;
}

export function pushGameToQueue(state: ServiceWorkerState, game: TwitchGame) {
  if (queueContainsGame(state, game)) {
    return;
  }
  state.appState.queue = [...state.appState.queue, game];
}

export function resetStreamTrackingState(state: ServiceWorkerState) {
  state.invalidStreamChecks = 0;
  state.lastStreamRotationAt = 0;
  state.streamValidationGraceUntil = 0;
  state.lastTrackedProgress = -1;
  state.lastTrackedMinutes = -1;
  state.lastTrackedDropKey = null;
  state.lastProgressAdvanceAt = 0;
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
    await notify('DropHunter is still recovering', message, 1);
  }
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
  const knownCompletedCurrent =
    state.appState.allDrops.length > 0 && !hasFarmablePending && state.appState.currentDrop === null;
  const campaignExpiredOrVanished = haveAllDropsExpiredOrVanished(
    state.appState.allDrops,
    state.previousAllDropsCount,
  );
  logDebug('advanceQueueIfCompleted result', {
    knownCompletedCurrent,
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

  if (state.appState.selectedGame) {
    removeGameFromQueue(state, state.appState.selectedGame);
  }

  while (state.appState.queue.length > 0) {
    const nextGame = resolveGameFromState(state, state.appState.queue[0]);
    state.appState.selectedGame = nextGame;
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
    const knownCompletedNext =
      state.appState.allDrops.length > 0 && !hasFarmablePendingNext && state.appState.currentDrop === null;
    const campaignExpiredNext = haveAllDropsExpiredOrVanished(
      state.appState.allDrops,
      state.previousAllDropsCount,
    );
    if (knownCompletedNext || campaignExpiredNext) {
      state.previousAllDropsCount = 0;
      removeGameFromQueue(state, nextGame);
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
  if (opts?.onApplyStopState) {
    opts.onApplyStopState(state, 'queue-complete', 'Queue completed. No pending rewards left.');
  }
  if (opts?.onStopMonitoring) {
    opts.onStopMonitoring();
  }
  if (opts?.onSendAlert) {
    await opts.onSendAlert('all-complete', 'Queue completed. No pending rewards left.');
  }
  if (opts?.onSaveState) {
    await opts.onSaveState();
  }
  return false;
}

export async function skipCurrentGameDueToStall(
  state: ServiceWorkerState,
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
  },
) {
  const skippedGame = state.appState.selectedGame;
  const gameName = skippedGame ? getGameDisplayLabel(skippedGame) : 'current game';

  logWarn('Giving up on game after persistent recovery exhaustion', {
    game: gameName,
    stalledRecoveryAttempts: state.stalledRecoveryAttempts,
  });

  if (skippedGame) {
    removeGameFromQueue(state, skippedGame);
  }

  resetStreamTrackingState(state);

  while (state.appState.queue.length > 0) {
    const nextGame = resolveGameFromState(state, state.appState.queue[0]);
    state.appState.selectedGame = nextGame;
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
      removeGameFromQueue(state, nextGame);
      continue;
    }

    if (opts?.onOpenStreamer) {
      await opts.onOpenStreamer();
    }
    await notify(
      'Game skipped',
      `Skipped ${gameName} — no progress after repeated attempts. Now farming ${getGameDisplayLabel(nextGame)}.`,
    );
    if (opts?.onSaveState) {
      await opts.onSaveState();
    }
    return;
  }

  if (opts?.onStopFarmingSession) {
    await opts.onStopFarmingSession({
      stopReason: 'stall-skipped',
      stopMessage: `Farming stopped — ${gameName} made no progress and no other games are queued.`,
      notification: {
        title: 'Farming stopped',
        message: `${gameName} made no progress after repeated recovery attempts.`,
      },
    });
  }
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
  removeGameFromQueue(state, requestedGame);
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
      opts?: { onSkipCurrentGame?: () => Promise<void> },
    ) => Promise<void>;
    onSkipCurrentGame?: () => Promise<void>;
  },
): Promise<boolean> {
  state.noProgressRotationAttempts = nextNoProgressRotationAttempts(state.noProgressRotationAttempts, reason);
  if (state.noProgressRotationAttempts >= MAX_NO_PROGRESS_ROTATION_ATTEMPTS) {
    if (opts?.onEnterPersistentRecovery) {
      await opts.onEnterPersistentRecovery(
        state,
        reason,
        "DropHunter hasn't resumed progress yet, but it will keep retrying automatically.",
        { onSkipCurrentGame: opts.onSkipCurrentGame },
      );
    }
    if (opts?.onSaveState) {
      await opts.onSaveState();
    }
    if (opts?.onSaveTimingState) {
      await opts.onSaveTimingState(state);
    }
    return false;
  }

  state.appState.lastRotationReason = reason;
  state.appState.lastRotationAt = Date.now();
  state.lastStreamRotationAt = Date.now();
  state.lastProgressAdvanceAt = Date.now();
  state.appState.activeStreamer = null;

  let opened = false;
  if (opts?.onOpenStreamer) {
    opened = await opts.onOpenStreamer();
  }
  if (!opened && !shouldIncrementNoProgressRotationAttempts(reason)) {
    state.noProgressRotationAttempts = nextNoProgressRotationAttempts(
      state.noProgressRotationAttempts,
      'open-failed',
    );
    if (state.noProgressRotationAttempts >= MAX_NO_PROGRESS_ROTATION_ATTEMPTS) {
      if (opts?.onEnterPersistentRecovery) {
        await opts.onEnterPersistentRecovery(
          state,
          'open-failed',
          'DropHunter could not reopen a working stream yet, but it will keep retrying automatically.',
          { onSkipCurrentGame: opts.onSkipCurrentGame },
        );
      }
      if (opts?.onSaveState) {
        await opts.onSaveState();
      }
      if (opts?.onSaveTimingState) {
        await opts.onSaveTimingState(state);
      }
      return false;
    }
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
          opts?: { onSkipCurrentGame?: () => Promise<void> },
        ) => Promise<void>;
        onSkipCurrentGame?: () => Promise<void>;
      },
    ) => Promise<boolean>;
    onOpenStreamer?: () => Promise<boolean>;
    onEnterPersistentRecovery?: (
      state: ServiceWorkerState,
      reason: StreamRotationReason,
      message: string,
      opts?: { onSkipCurrentGame?: () => Promise<void> },
    ) => Promise<void>;
    onSkipCurrentGame?: () => Promise<void>;
  },
) {
  if (!state.appState.selectedGame) {
    return;
  }

  if (!state.appState.tabId) {
    if (
      state.recoveryBackoffUntil > 0 &&
      Date.now() < state.recoveryBackoffUntil &&
      state.appState.recoveryReason === 'open-failed'
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

  const tab = await chrome.tabs.get(state.appState.tabId).catch(() => null);
  if (!tab?.id) {
    state.appState.tabId = null;
    state.appState.activeStreamer = null;
    if (
      state.recoveryBackoffUntil > 0 &&
      Date.now() < state.recoveryBackoffUntil &&
      state.appState.recoveryReason === 'open-failed'
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
  const progressIsRecentlyAdvancing =
    state.lastProgressAdvanceAt > 0 && now - state.lastProgressAdvanceAt < effectiveThreshold;

  if (!context) {
    const tabUrl = tab.url ?? '';
    const isStillOnTwitch = /^https?:\/\/([^/]*\.)?twitch\.tv\//i.test(tabUrl);
    if (!isStillOnTwitch) {
      logInfo('Managed tab navigated away from Twitch', { tabUrl });
      state.invalidStreamChecks = INVALID_STREAM_THRESHOLD;
    } else if (progressIsRecentlyAdvancing) {
      logDebug('Stream context missing but drop progress is recent; keeping current streamer', {
        tabUrl,
        lastProgressAdvanceAt: state.lastProgressAdvanceAt,
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

  const progressStalled =
    state.lastProgressAdvanceAt > 0 &&
    state.appState.currentDrop != null &&
    now - state.lastProgressAdvanceAt >= effectiveThreshold;

  const health = classifyStreamHealth({
    isLive: context.isLive,
    sameChannel,
    sameGame,
    hasDropsSignal,
    progressStalled,
    expectsDropsSignal,
  });

  if (health.isHealthy) {
    state.invalidStreamChecks = 0;
    return;
  }

  if (health.forceImmediateRotation && health.reason === 'offline') {
    if (state.appState.recoveryReason === 'stalled-progress') {
      clearRecoveryState(state);
    }
    // Respect backoff when already in offline/open-failed recovery — prevents a
    // fast rotation loop when no replacement streamer is available (e.g. event-only
    // drops with no live channels).
    if (
      state.recoveryBackoffUntil > 0 &&
      now < state.recoveryBackoffUntil &&
      (state.appState.recoveryReason === 'offline' || state.appState.recoveryReason === 'open-failed')
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

  if (health.reason === 'stalled-progress') {
    if (state.stalledRecoveryAttempts > MAX_PERSISTENT_RECOVERY_CYCLES) {
      logWarn('Stalled progress recovery exhausted — skipping game', {
        stalledRecoveryAttempts: state.stalledRecoveryAttempts,
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
    if (state.lastRecoveryAttemptAt < state.lastProgressAdvanceAt || state.stalledRecoveryAttempts === 0) {
      state.stalledRecoveryAttempts = Math.max(1, state.stalledRecoveryAttempts + 1);
      state.lastRecoveryAttemptAt = now;
      state.recoveryBackoffUntil = now + computeRecoveryBackoffMs(state.stalledRecoveryAttempts);
      applyRecoveryState(state, 'stalled-progress', state.recoveryBackoffUntil);
      logInfo('Attempting in-place playback self-heal before rotating', {
        stalledRecoveryAttempts: state.stalledRecoveryAttempts,
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
    logInfo('Drop progress stalled, triggering stream rotation', {
      progress: state.appState.currentDrop?.progress ?? null,
      currentMinutes: state.appState.currentDrop?.currentMinutes ?? null,
      requiredMinutes: state.appState.currentDrop?.requiredMinutes ?? null,
      effectiveThresholdMs: effectiveThreshold,
      stalledForMs: now - state.lastProgressAdvanceAt,
    });
    state.invalidStreamChecks = INVALID_STREAM_THRESHOLD;
  } else {
    const progressIsLive =
      state.lastProgressAdvanceAt > 0 && now - state.lastProgressAdvanceAt < PROGRESS_STALL_THRESHOLD_MS;
    const isWeakSignal = health.reason === 'drops-inactive' || health.reason === 'missing-context';
    if (progressIsLive && isWeakSignal) {
      state.invalidStreamChecks = 0;
      return;
    }
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
  const FULL_REFRESH_INTERVAL_MS = 2 * 60_000;
  const TICK_WATCHDOG_TIMEOUT_MS = 60_000;

  if (!state.appState.isRunning || state.appState.isPaused) {
    return;
  }

  if (state.apiBackoffUntil > 0 && Date.now() < state.apiBackoffUntil) {
    logDebug('API backoff active, skipping tick', { remainingMs: state.apiBackoffUntil - Date.now() });
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

  const tickWatchdogTimer = setTimeout(() => {
    if (state.monitorTickInFlight) {
      logWarn('Monitoring tick watchdog fired — resetting stuck monitorTickInFlight flag', {
        timeoutMs: TICK_WATCHDOG_TIMEOUT_MS,
      });
      state.monitorTickInFlight = false;
    }
  }, TICK_WATCHDOG_TIMEOUT_MS);

  try {
    if (state.appState.tabId) {
      const streamTab = await chrome.tabs.get(state.appState.tabId).catch(() => null);
      if (!streamTab) {
        state.appState.tabId = null;
        state.appState.activeStreamer = null;
      }
    }
    await callbacks.onEnforcePlaybackPolicy();

    const isFullTick = Date.now() - state.lastFullRefreshAt >= FULL_REFRESH_INTERVAL_MS;
    if (isFullTick) {
      await callbacks.onRefreshDropsData({ includeCampaignFetch: true, includeInventoryFetch: true });
      state.lastFullRefreshAt = Date.now();
    } else {
      await callbacks.onRefreshDropsData();
    }

    const inCrashGrace =
      state.appState.resumedFromCrash != null &&
      Date.now() - state.appState.resumedFromCrash < CRASH_RECOVERY_GRACE_MS;
    if (inCrashGrace) {
      state.streamValidationGraceUntil = Date.now() + STREAM_VALIDATION_GRACE_MS;
    } else {
      await callbacks.onRotateStreamerIfInvalid();
    }
    await callbacks.onAttemptAutoClaimChannelPointsBonus();

    const claimedAny = await callbacks.onAutoClaimClaimableDrops();
    if (claimedAny) {
      await callbacks.onRefreshDropsData({
        includeCampaignFetch: true,
        includeInventoryFetch: true,
        forceInventoryFetch: true,
      });
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
  const candidates =
    allowed != null && allowed.length > 0
      ? streamers.filter((s) => allowed!.includes(s.name.toLowerCase()))
      : streamers;
  if (allowed != null && allowed.length > 0) {
    logDebug('Filtered streamers by allowedChannels', {
      game: deps.getGameDisplayLabel(state.appState.selectedGame),
      beforeFilter: streamers.length,
      afterFilter: candidates.length,
      candidateNames: candidates.map((s) => s.name),
      rejected: streamers.filter((s) => !allowed!.includes(s.name.toLowerCase())).map((s) => s.name),
    });
  }
  const selection = deps.pickStreamerForPreferences(
    candidates,
    {
      mode: state.appState.streamerSelectionMode,
      preferredLanguage: state.appState.preferredStreamerLanguage,
    },
    Math.random,
    streamers.languageFilterApplied,
  );
  const streamer = selection.streamer;
  if (streamer) {
    logInfo('Opening selected streamer', {
      game: deps.getGameDisplayLabel(state.appState.selectedGame),
      selectionMode: state.appState.streamerSelectionMode,
      preferredLanguage: deps.normalizePreferredStreamerLanguage(state.appState.preferredStreamerLanguage),
      preferredLanguageApplied: selection.preferredLanguageApplied,
      preferredLanguageMatches: selection.preferredLanguageMatches,
      activePoolSize: selection.activePoolSize,
      serverLanguageFilterApplied: streamers.languageFilterApplied,
      streamer: streamer.name,
      viewers: streamer.viewerCount ?? null,
      broadcasterLanguage: streamer.broadcasterLanguage ?? null,
      candidates: candidates.length,
    });
    await callbacks.onOpenForegroundChannel(streamer);
    return true;
  }

  logWarn('No streamer found for selected game', {
    game: deps.getGameDisplayLabel(state.appState.selectedGame),
    categorySlug: state.appState.selectedGame.categorySlug ?? null,
  });
  state.appState.tabId = null;
  state.appState.activeStreamer = null;
  return false;
}

export interface RefreshDropsDataCallbacks {
  onFetchDropsSnapshotFromApi: (force?: boolean) => Promise<DropsSnapshot | null>;
  onEvaluateDropTransitions: (previousCompletedIds: Set<string>) => Promise<void>;
  onSaveState: (state: ServiceWorkerState) => Promise<void>;
}

export interface RefreshDropsDataDeps {
  replaceAvailableGames: (games: TwitchGame[]) => TwitchGame[];
  getGameDisplayLabel: (game: TwitchGame) => string;
  updateStateFromSnapshot: (state: ServiceWorkerState, snapshot: DropsSnapshot) => void;
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
  const previousCompletedIds = new Set(state.appState.completedDrops.map((drop) => drop.id));
  let games = state.appState.availableGames;
  let drops = includeCampaignFetch
    ? state.cachedDropsSnapshot.length > 0
      ? state.cachedDropsSnapshot
      : state.appState.allDrops
    : state.appState.allDrops;
  let apiSnapshotUsed = false;

  if (includeCampaignFetch || includeInventoryFetch) {
    const apiSnapshot = await callbacks.onFetchDropsSnapshotFromApi();
    if (apiSnapshot) {
      games =
        apiSnapshot.games.length > 0
          ? deps.replaceAvailableGames(apiSnapshot.games)
          : state.appState.availableGames;
      drops = apiSnapshot.drops;
      if (apiSnapshot.drops.length > 0) {
        state.cachedDropsSnapshot = apiSnapshot.drops;
      } else if (state.cachedDropsSnapshot.length > 0) {
        drops = state.cachedDropsSnapshot;
      }
      if (apiSnapshot.campaignChannelsMap) {
        state.cachedCampaignChannelsMap = apiSnapshot.campaignChannelsMap;
      }
      apiSnapshotUsed = true;
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

  if (drops.length === 0 && state.appState.allDrops.length > 0) {
    drops = state.appState.allDrops;
  }

  deps.updateStateFromSnapshot(state, {
    games,
    drops,
    updatedAt: Date.now(),
  });
  deps.normalizeQueueSelection(state, state.appState.availableGames);

  if (!options.suppressNotifications) {
    await callbacks.onEvaluateDropTransitions(previousCompletedIds);
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
  if (state.appState.queue.some((g) => g.id === targetGame.id)) {
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
    !state.appState.queue.some((g) => g.id === state.appState.selectedGame?.id)
  ) {
    state.appState.selectedGame = state.appState.queue[0] ?? null;
  }

  await callbacks.onSaveState(state);
  return { success: true, removed, queueLength: state.appState.queue.length };
}
