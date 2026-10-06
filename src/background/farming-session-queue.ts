import { campaignRejectionReason } from '../shared/campaign-eligibility.ts';
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
import { parkCampaignForStreamerRetry } from './session-lifecycle-queue-parking.ts';

type FarmingSessionQueueDependencies = {
  readonly onEnsureWorkspace: (isCurrent?: () => boolean) => Promise<void>;
  readonly onRefreshDropsData: (options?: RefreshDropsOptions) => Promise<unknown>;
  readonly onAcquireStreamer: (isCurrent?: () => boolean) => Promise<boolean>;
};

type RemoveQueuePayload = {
  readonly game?: TwitchGame;
  readonly gameId?: string;
  readonly campaignId?: string;
};

export type FarmingSessionQueue = {
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
  return { allDrops, pendingDrops, hasFarmableDrops: pendingDrops.some((drop) => isRewardFarmableNow(drop)) };
}

export function createFarmingSessionQueue(
  context: FarmingSessionContext,
  dependencies: FarmingSessionQueueDependencies,
): FarmingSessionQueue {
  const { state, adapters } = context;

  async function selectGame(payload: { readonly game: TwitchGame }) {
    if (context.transitionCampaign && state.appState.isRunning && !state.appState.isPaused) {
      await adapters.trackActivity('set-selected-game');
      const candidate = resolveGameFromState(state, payload.game);
      if (!candidate || campaignRejectionReason(candidate)) {
        return { success: false, error: 'Campaign is no longer available.' };
      }
      const result = await context.transitionCampaign(candidate);
      if (result.kind === 'failed') {
        parkCampaignForStreamerRetry(state, candidate, result.reason, true);
        try {
          await adapters.saveState(state);
        } catch {
          return { success: false, error: 'Unable to save the campaign change.' };
        }
      }
      return result.kind === 'started'
        ? { success: true }
        : {
            success: false,
            error:
              result.kind === 'failed'
                ? result.error
                : 'Campaign change was superseded or is no longer farmable.',
          };
    }
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
    state.appState.queueAcquisitionRound = null;
    state.appState.queueResumeOnAvailability = false;
    state.appState.forcedCampaignKey = null;
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
    handleAddToQueue,
    handleClearQueue,
    handleRemoveFromQueue,
    handleReorderQueue,
    handleSetSelectedGame,
  };
}
