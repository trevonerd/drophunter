// Owns the per-tick drop-progress checks, inventory/campaign refresh, and
// runtime message handlers that mutate the drops/queue view (select/set-game,
// add/remove/reorder queue). Free functions taking explicit `state` +
// callbacks/deps — they do NOT close over any adapter factory and have no
// shared mutable state.
import { browser } from '../shared/browser-api.ts';
import { gameKey } from '../shared/game-selection';
import type { AddToQueueReason } from '../shared/messages.ts';
import { DropsSnapshot, TwitchDrop, TwitchGame } from '../types';
import { detectNewlyClaimedDrops, recordClaimedDrops } from './claim-log.ts';
import {
  CRASH_RECOVERY_GRACE_MS,
  FULL_REFRESH_INTERVAL_MS,
  STREAM_VALIDATION_GRACE_MS,
  TICK_WATCHDOG_TIMEOUT_MS,
} from './constants';
import { completedDropKeys, type DropsSnapshotProvenance } from './drops-projection.ts';
import { rememberInspectedCampaignSummary } from './drops-projection-semantics.ts';
import { logDebug, logWarn } from './logging';
import {
  markQueueEntryManual,
  queueContainsGame,
  queueEntryMatchesGame,
  reorderQueue,
} from './queue-operations';
import type { ServiceWorkerState } from './service-worker';

function assertNever(value: never): never {
  throw new TypeError(`Unhandled add-to-queue completion: ${String(value)}`);
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
  onWatchTransportTick?: () => Promise<boolean | undefined>;
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

    const transportAdvancedQueue = await callbacks.onWatchTransportTick?.();
    if (isStaleTick()) return;
    if (transportAdvancedQueue) return;

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
  projectDropsSnapshot: (
    state: ServiceWorkerState,
    snapshot: DropsSnapshot,
    provenance: DropsSnapshotProvenance,
  ) => void;
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
  let provenance: DropsSnapshotProvenance = 'cached';

  if (includeCampaignFetch) {
    const apiSnapshot = await callbacks.onFetchDropsSnapshotFromApi();
    if (apiSnapshot) {
      state.lastFullRefreshAt = Date.now();
      const hasAuthoritativeEmptyRewardSet =
        apiSnapshot.drops.length === 0 &&
        (apiSnapshot.games.length === 0 || apiSnapshot.games.every((game) => game.dropCount === 0));
      games =
        apiSnapshot.games.length > 0
          ? deps.replaceAvailableGames(apiSnapshot.games)
          : apiSnapshot.drops.length === 0
            ? []
            : state.appState.availableGames;
      drops = apiSnapshot.drops;
      if (apiSnapshot.drops.length > 0) {
        state.cachedDropsSnapshot = apiSnapshot.drops;
        provenance = 'campaign-authoritative';
      } else if (hasAuthoritativeEmptyRewardSet) {
        state.cachedDropsSnapshot = [];
        provenance = 'campaign-authoritative';
      } else if (state.cachedDropsSnapshot.length > 0) {
        drops = state.cachedDropsSnapshot;
      } else {
        provenance = 'campaign-authoritative';
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
        provenance = 'inventory-partial';
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

  const isAuthoritativeEmptyCampaign =
    apiSnapshotUsed && provenance === 'campaign-authoritative' && games.length === 0 && drops.length === 0;
  if (isAuthoritativeEmptyCampaign) {
    state.appState.availableGames = [];
  }

  deps.projectDropsSnapshot(
    state,
    {
      games,
      drops,
      updatedAt: Date.now(),
    },
    provenance,
  );
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
  resolveGameFromState: (state: ServiceWorkerState, game: TwitchGame) => TwitchGame | null;
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
): Promise<{ success: boolean; error?: string }> {
  await callbacks.onTrackActivity('set-selected-game');
  const selectedGame = deps.resolveGameFromState(state, payload.game);
  if (!selectedGame) {
    return { success: false, error: 'Campaign is no longer available.' };
  }
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
  rememberInspectedCampaignSummary(state);
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
    markQueueEntryManual(state, selectedGame);
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
  rememberInspectedCampaignSummary(state);
  if (state.appState.selectedGame) {
    const canonicalSelected = deps.resolveGameFromState(state, state.appState.selectedGame);
    if (
      canonicalSelected &&
      (canonicalSelected.id !== state.appState.selectedGame.id ||
        canonicalSelected.campaignId !== state.appState.selectedGame.campaignId)
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
  resolveGameFromState: (state: ServiceWorkerState, game: TwitchGame) => TwitchGame | null;
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
  reason?: AddToQueueReason;
  game?: TwitchGame;
  queueLength?: number;
  error?: string;
}> {
  await callbacks.onTrackActivity('add-to-queue');
  if (!payload?.game) {
    return { success: false, error: 'No game provided.' };
  }

  const requestedGame = payload.game;
  if (queueContainsGame(state, requestedGame)) {
    return { success: true, added: false, reason: 'already-queued', game: requestedGame };
  }
  const requestedCampaignId = requestedGame.campaignId?.trim() ?? '';
  const canonicalGame = state.appState.availableGames.find(
    (candidate) => gameKey(candidate) === gameKey(requestedGame),
  );
  if (!canonicalGame && requestedCampaignId.length > 0) {
    return { success: false, error: 'Campaign is no longer available.' };
  }
  const targetGame = canonicalGame ?? deps.resolveGameFromState(state, requestedGame);
  if (!targetGame) {
    return { success: false, error: 'Campaign is no longer available.' };
  }
  if (queueContainsGame(state, targetGame)) {
    return { success: true, added: false, reason: 'already-queued', game: targetGame };
  }

  const completion = targetGame.rewardSummary?.completion;
  switch (completion) {
    case 'all-acquired':
      return { success: true, added: false, reason: 'already-completed', game: targetGame };
    case 'farming-complete':
      return { success: true, added: false, reason: 'farming-complete', game: targetGame };
    case 'farmable':
    case undefined:
      break;
    default:
      return assertNever(completion);
  }

  state.appState.queue.push(targetGame);
  markQueueEntryManual(state, targetGame);
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
): Promise<{ success: boolean; removed: number; queueLength: number; error?: string }> {
  await callbacks.onTrackActivity('remove-from-queue');
  const before = state.appState.queue.length;

  const runningGame = state.appState.isRunning ? state.appState.selectedGame : null;
  const targetsRunningGame = runningGame
    ? payload?.game
      ? queueEntryMatchesGame(state, payload.game, runningGame)
      : state.appState.queue.some((queuedGame) => {
          const matchesTarget =
            (payload?.gameId !== undefined && queuedGame.id === payload.gameId) ||
            (payload?.campaignId !== undefined &&
              deps.sameCampaignId(queuedGame.campaignId, payload.campaignId));
          return matchesTarget && queueEntryMatchesGame(state, queuedGame, runningGame);
        })
    : false;

  if (targetsRunningGame) {
    return {
      success: false,
      removed: 0,
      queueLength: before,
      error: 'Cannot remove the running campaign.',
    };
  }

  if (payload?.game) {
    deps.removeGameFromQueue(state, payload.game);
  } else {
    const targetGameId = payload?.gameId;
    const targetCampaignId = payload?.campaignId;
    const removedGames = state.appState.queue.filter((game) => {
      if (targetGameId && game.id === targetGameId) return true;
      if (targetCampaignId && deps.sameCampaignId(game.campaignId, targetCampaignId)) return true;
      return false;
    });
    state.appState.queue = state.appState.queue.filter((game) => {
      if (targetGameId && game.id === targetGameId) return false;
      if (targetCampaignId && deps.sameCampaignId(game.campaignId, targetCampaignId)) return false;
      return true;
    });
    for (const game of removedGames) {
      delete state.appState.queueEntryMetadataByKey[gameKey(game)];
    }
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

  const queueLength = state.appState.queue.length;
  if (fromIndex >= queueLength || toIndex >= queueLength) {
    return { success: false, error: 'Invalid queue indices.' };
  }

  const runningGame = state.appState.isRunning ? state.appState.selectedGame : null;
  if (runningGame) {
    const runningIndex = state.appState.queue.findIndex((game) =>
      queueEntryMatchesGame(state, game, runningGame),
    );
    if (runningIndex >= 0 && (fromIndex <= runningIndex || toIndex <= runningIndex)) {
      return { success: false, error: 'Cannot reorder the running campaign.' };
    }
  }

  const reordered = reorderQueue(state, fromIndex, toIndex);
  if (!reordered) {
    return { success: false, error: 'Invalid queue indices.' };
  }

  state.appState.campaignPriorityMode = 'priority-list-only';

  await callbacks.onSaveState(state);
  return { success: true, reordered: true, queueLength: state.appState.queue.length };
}
