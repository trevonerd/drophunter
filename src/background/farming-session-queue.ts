import { getGameDisplayLabel, sameCampaignId } from '../shared/game-selection.ts';
import { isRewardFarmableNow } from '../shared/reward-scheduling.ts';
import { isRewardAcquired } from '../shared/reward-semantics.ts';
import type { TwitchDrop, TwitchGame } from '../types/index.ts';
import { dropMatchesSelectedGame, splitDropsForSelectedGame } from './drops-projection.ts';
import {
  handleAddToQueue as addToQueue,
  handleRemoveFromQueue as removeFromQueue,
  handleReorderQueue as reorderQueue,
  handleSetSelectedGame as setSelectedGame,
} from './drops-tick.ts';
import type { FarmingSessionContext, RefreshDropsOptions } from './farming-session-context.ts';
import { runFarmingSessionMutation } from './farming-session-revision.ts';
import { logDebug, logWarn } from './logging.ts';
import { removeGameFromQueue, resolveGameFromState } from './queue-operations.ts';
import { applyStopState } from './recovery-state.ts';
import { advanceQueueIfCompleted as advanceQueue } from './session-lifecycle.ts';

type FarmingSessionQueueDependencies = {
  readonly onEnsureWorkspace: () => Promise<void>;
  readonly onRefreshDropsData: (options?: RefreshDropsOptions) => Promise<void>;
  readonly onAcquireStreamer: () => Promise<boolean>;
  readonly onStopMonitoring: () => void;
};

type RemoveQueuePayload = {
  readonly game?: TwitchGame;
  readonly gameId?: string;
  readonly campaignId?: string;
};

export type FarmingSessionQueue = {
  readonly advanceQueueIfCompleted: () => Promise<boolean>;
  readonly handleAddToQueue: (payload: { readonly game?: TwitchGame }) => ReturnType<typeof addToQueue>;
  readonly handleClearQueue: () => Promise<{ readonly success: true; readonly queueLength: number }>;
  readonly handleRemoveFromQueue: (payload: RemoveQueuePayload) => ReturnType<typeof removeFromQueue>;
  readonly handleReorderQueue: (payload: {
    readonly fromIndex?: number;
    readonly toIndex?: number;
  }) => ReturnType<typeof reorderQueue>;
  readonly handleSetSelectedGame: (payload: {
    readonly game: TwitchGame;
  }) => ReturnType<typeof setSelectedGame>;
};

function evaluateDropsForGame(
  game: TwitchGame,
  drops: TwitchDrop[],
): {
  readonly allDrops: TwitchDrop[];
  readonly pendingDrops: TwitchDrop[];
  readonly hasFarmableDrops: boolean;
} {
  const allDrops = drops.filter((drop) => dropMatchesSelectedGame(drop, game));
  const pendingDrops = allDrops.filter((drop) => !isRewardAcquired(drop));
  return { allDrops, pendingDrops, hasFarmableDrops: pendingDrops.some(isRewardFarmableNow) };
}

export function createFarmingSessionQueue(
  context: FarmingSessionContext,
  dependencies: FarmingSessionQueueDependencies,
): FarmingSessionQueue {
  const { state, adapters } = context;

  async function advanceQueueIfCompleted(): Promise<boolean> {
    return advanceQueue(state, {
      onOpenStreamer: dependencies.onAcquireStreamer,
      onEnsureWorkspace: dependencies.onEnsureWorkspace,
      onSendAlert: adapters.sendAlert,
      onStopMonitoring: () => {
        dependencies.onStopMonitoring();
        context.manualWatchTransportSuspended = false;
        void adapters.watchTransport?.stop();
      },
      onCloseManagedTabIfSafe: adapters.closeManagedTabIfSafe,
      onClearManagedTabOwnership: adapters.clearManagedTabOwnership,
      onApplyStopState: applyStopState,
      onNotify: async (title, message) => {
        await adapters.notify(title, message);
      },
      onRefreshDropsData: dependencies.onRefreshDropsData,
      onSaveState: () => adapters.saveState(state),
      onSaveTimingState: adapters.saveTimingState,
    });
  }

  async function selectGame(payload: { readonly game: TwitchGame }) {
    return setSelectedGame(
      state,
      payload,
      {
        onTrackActivity: adapters.trackActivity,
        onEnsureWorkspace: dependencies.onEnsureWorkspace,
        onRefreshDropsData: dependencies.onRefreshDropsData,
        onOpenBestStreamer: dependencies.onAcquireStreamer,
        onSaveState: adapters.saveState,
        onSaveTimingState: adapters.saveTimingState,
      },
      {
        resolveGameFromState,
        removeGameFromQueue,
        splitDropsForSelectedGame,
        getGameDisplayLabel,
        logDebug,
        logWarn,
      },
    );
  }

  function handleSetSelectedGame(payload: { readonly game: TwitchGame }) {
    return runFarmingSessionMutation(state, () => selectGame(payload));
  }

  async function addQueueEntry(payload: { readonly game?: TwitchGame }) {
    return addToQueue(
      state,
      payload,
      { onTrackActivity: adapters.trackActivity, onSaveState: adapters.saveState },
      { resolveGameFromState, evaluateDropsForGame, getGameDisplayLabel },
    );
  }

  function handleAddToQueue(payload: { readonly game?: TwitchGame }) {
    return runFarmingSessionMutation(state, () => addQueueEntry(payload));
  }

  async function removeQueueEntry(payload: RemoveQueuePayload) {
    return removeFromQueue(
      state,
      payload,
      { onTrackActivity: adapters.trackActivity, onSaveState: adapters.saveState },
      { removeGameFromQueue, sameCampaignId },
    );
  }

  function handleRemoveFromQueue(payload: RemoveQueuePayload) {
    return runFarmingSessionMutation(state, () => removeQueueEntry(payload));
  }

  async function reorderQueueEntries(payload: { readonly fromIndex?: number; readonly toIndex?: number }) {
    return reorderQueue(state, payload, {
      onTrackActivity: adapters.trackActivity,
      onSaveState: adapters.saveState,
    });
  }

  function handleReorderQueue(payload: { readonly fromIndex?: number; readonly toIndex?: number }) {
    return runFarmingSessionMutation(state, () => reorderQueueEntries(payload));
  }

  async function clearQueue(): Promise<{ readonly success: true; readonly queueLength: number }> {
    await adapters.trackActivity('clear-queue');
    state.appState.queue = [];
    state.appState.queueEntryMetadataByKey = {};
    if (!state.appState.isRunning) {
      state.appState.selectedGame = null;
      state.appState.currentDrop = null;
      state.appState.completionNotified = false;
    }
    await adapters.saveState(state);
    return { success: true, queueLength: 0 };
  }

  function handleClearQueue() {
    return runFarmingSessionMutation(state, clearQueue);
  }

  return {
    advanceQueueIfCompleted,
    handleAddToQueue,
    handleClearQueue,
    handleRemoveFromQueue,
    handleReorderQueue,
    handleSetSelectedGame,
  };
}
