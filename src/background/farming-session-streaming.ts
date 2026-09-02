import { gameKey, getGameDisplayLabel } from '../shared/game-selection.ts';
import { isRewardFarmableNow } from '../shared/reward-scheduling.ts';
import { isRewardAcquired } from '../shared/reward-semantics.ts';
import {
  dropMatchesSelectedGame,
  markDropUnverifiable,
  recomputeSelectedCampaignSummaryAfterLocalMarker,
} from './drops-projection.ts';
import type { RefreshDropsOutcome } from './drops-tick-refresh.ts';
import type { FarmingSessionContext, RefreshDropsOptions } from './farming-session-context.ts';
import { enterPersistentRecovery } from './recovery-state.ts';
import {
  resetStreamTrackingState,
  skipCurrentGameAndAdvanceQueue,
  skipCurrentGameDueToStall,
} from './session-lifecycle.ts';
import type { StopFarmingSessionRequest } from './session-lifecycle-types.ts';
import {
  recoverStalledProgress as recoverStalledProgressOperation,
  type StalledProgressRecoveryResult,
  type StalledProgressSource,
} from './stalled-progress-recovery.ts';
import { MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS } from './stream-rotation.ts';
import {
  acquireStreamerForSelectedGame as acquireStreamer,
  openBestStreamerForSelectedGame as openBestStreamer,
  rotateStreamerIfInvalid as rotateInvalidStreamer,
  rotateStreamer,
} from './streamer-acquisition.ts';
import { normalizePreferredStreamerLanguage, pickStreamerForPreferences } from './streamer-selection.ts';

type FarmingSessionStreamingDependencies = {
  readonly onRefreshDropsData: (options?: RefreshDropsOptions) => Promise<RefreshDropsOutcome>;
  readonly onStopFarmingSession: (options: StopFarmingSessionRequest) => Promise<void>;
  readonly onAdvanceQueueIfCompleted: () => Promise<boolean>;
};

export type FarmingSessionStreaming = {
  readonly acquireStreamerForSelectedGame: () => Promise<boolean>;
  readonly ensureWorkspaceForSelectedGame: () => Promise<void>;
  readonly handleAuthoritativeCampaignUnavailable: (
    game: import('../types/index.ts').TwitchGame,
  ) => Promise<void>;
  readonly handleRecoverySkip: () => Promise<void>;
  readonly recoverStalledProgress: (source: StalledProgressSource) => Promise<StalledProgressRecoveryResult>;
  readonly rotateStreamerIfInvalid: () => Promise<void>;
};

export function createFarmingSessionStreaming(
  context: FarmingSessionContext,
  dependencies: FarmingSessionStreamingDependencies,
): FarmingSessionStreaming {
  const { state, adapters } = context;

  async function openBestStreamerForSelectedGame(): Promise<boolean> {
    return openBestStreamer(
      state,
      {
        onFetchDirectoryStreamersFromApi: adapters.fetchDirectoryStreamersFromApi,
        onOpenForegroundChannel: adapters.openForegroundChannel,
        onOpenWatchTransport: async (streamer) => {
          if (!adapters.watchTransport) {
            await adapters.openForegroundChannel(streamer);
            return true;
          }
          const health = await adapters.watchTransport.start(streamer);
          state.appState.watchTransportMode = health.mode;
          state.appState.watchHealth = health;
          return health.mode === 'tabless' || health.status !== 'failed';
        },
      },
      {
        dropMatchesSelectedGame,
        isRewardAcquired,
        getGameDisplayLabel,
        resolveCategorySlug: adapters.resolveCategorySlug,
        pickStreamerForPreferences,
        normalizePreferredStreamerLanguage,
      },
    );
  }

  async function skipCurrentGameDueToNoStreamers(): Promise<void> {
    if (state.appState.selectedGame) {
      await adapters.suppressCampaignUntilRefresh?.(gameKey(state.appState.selectedGame));
    }
    await skipCurrentGameAndAdvanceQueue(state, 'no-streamers', {
      onEnsureWorkspace: ensureWorkspaceForSelectedGame,
      onRefreshDropsData: async (options) => {
        await dependencies.onRefreshDropsData(options);
      },
      onOpenStreamer: acquireStreamerForSelectedGame,
      onSaveState: () => adapters.saveState(state),
      onSaveTimingState: adapters.saveTimingState,
      onStopFarmingSession: dependencies.onStopFarmingSession,
      onNotify: adapters.notify,
    });
  }

  async function acquireStreamerForSelectedGame(): Promise<boolean> {
    return acquireStreamer(state, {
      onOpenStreamer: openBestStreamerForSelectedGame,
      onSkipCurrentGame: skipCurrentGameDueToNoStreamers,
      onSaveState: () => adapters.saveState(state),
      onSaveTimingState: adapters.saveTimingState,
    });
  }

  async function ensureWorkspaceForSelectedGame(): Promise<void> {
    if (!state.appState.selectedGame) {
      return;
    }
    const resolvedSlug = await adapters.resolveCategorySlug(state.appState.selectedGame);
    state.appState.selectedGame = {
      ...state.appState.selectedGame,
      categorySlug: resolvedSlug,
    };
  }

  async function handleRecoverySkip(): Promise<void> {
    const currentDrop = state.appState.currentDrop;
    const exhaustedStalledRecovery =
      state.appState.recoveryReason === 'stalled-progress' &&
      state.stalledRecoveryAttempts >= MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS;
    const markedUnverifiable =
      exhaustedStalledRecovery && currentDrop ? markDropUnverifiable(state, currentDrop) : false;

    if (!markedUnverifiable) {
      if (state.appState.selectedGame) {
        await adapters.suppressCampaignUntilRefresh?.(gameKey(state.appState.selectedGame));
      }
      await skipCurrentGameDueToStall(state, {
        onEnsureWorkspace: ensureWorkspaceForSelectedGame,
        onRefreshDropsData: async (options) => {
          await dependencies.onRefreshDropsData(options);
        },
        onOpenStreamer: acquireStreamerForSelectedGame,
        onSaveState: () => adapters.saveState(state),
        onSaveTimingState: adapters.saveTimingState,
        onStopFarmingSession: dependencies.onStopFarmingSession,
        onNotify: adapters.notify,
      });
      return;
    }

    await adapters.saveTimingState(state);
    await dependencies.onRefreshDropsData({
      includeCampaignFetch: false,
      includeInventoryFetch: false,
      suppressNotifications: true,
    });

    const selectedFarmingComplete = recomputeSelectedCampaignSummaryAfterLocalMarker(state);
    if (
      !selectedFarmingComplete ||
      state.appState.currentDrop !== null ||
      state.appState.pendingDrops.some(isRewardFarmableNow)
    ) {
      resetStreamTrackingState(state);
      await acquireStreamerForSelectedGame();
      return;
    }

    if (state.appState.selectedGame) {
      await adapters.suppressCampaignUntilRefresh?.(gameKey(state.appState.selectedGame));
    }
    await skipCurrentGameAndAdvanceQueue(state, 'unverifiable-twitch', {
      onEnsureWorkspace: ensureWorkspaceForSelectedGame,
      onRefreshDropsData: async (options) => {
        await dependencies.onRefreshDropsData(options);
      },
      onOpenStreamer: acquireStreamerForSelectedGame,
      onSaveState: () => adapters.saveState(state),
      onSaveTimingState: adapters.saveTimingState,
      onStopFarmingSession: dependencies.onStopFarmingSession,
      onNotify: adapters.notify,
    });
  }

  async function handleAuthoritativeCampaignUnavailable(
    game: import('../types/index.ts').TwitchGame,
  ): Promise<void> {
    if (!state.appState.selectedGame || gameKey(state.appState.selectedGame) !== gameKey(game)) {
      return;
    }
    await adapters.notifyCampaignUnavailable?.(game);
    await skipCurrentGameAndAdvanceQueue(state, 'unfarmable', {
      onEnsureWorkspace: ensureWorkspaceForSelectedGame,
      onRefreshDropsData: async (options) => {
        await dependencies.onRefreshDropsData(options);
      },
      onOpenStreamer: acquireStreamerForSelectedGame,
      onSaveState: () => adapters.saveState(state),
      onSaveTimingState: adapters.saveTimingState,
      onStopFarmingSession: (options) =>
        dependencies.onStopFarmingSession({ ...options, suppressNotifications: true }),
    });
  }

  async function recoverStalledProgress(
    source: StalledProgressSource,
  ): Promise<StalledProgressRecoveryResult> {
    return recoverStalledProgressOperation(state, source, {
      now: context.now,
      onCampaignRefresh: () =>
        dependencies.onRefreshDropsData({
          includeCampaignFetch: true,
          includeInventoryFetch: false,
          sessionRecoveryMode: 'background-tab',
          suppressNotifications: true,
        }),
      onInventoryRefresh: () =>
        dependencies.onRefreshDropsData({
          includeCampaignFetch: false,
          includeInventoryFetch: true,
          sessionRecoveryMode: 'background-tab',
          suppressNotifications: true,
        }),
      onAdvanceQueueIfCompleted: dependencies.onAdvanceQueueIfCompleted,
      onAttemptPlaybackSelfHeal: adapters.attemptPlaybackSelfHeal,
      onRestartTablessWatcher: async () => {
        const activeStreamer = state.appState.activeStreamer;
        if (activeStreamer && adapters.watchTransport) {
          await adapters.watchTransport.start(activeStreamer);
          return;
        }
        await acquireStreamerForSelectedGame();
      },
      onRotateManagedStreamer: async () => {
        await rotateStreamer(state, 'stalled-progress', {
          onOpenStreamer: acquireStreamerForSelectedGame,
          onSaveState: () => adapters.saveState(state),
          onSaveTimingState: adapters.saveTimingState,
          onEnterPersistentRecovery: async (nextState, reason, message, recoveryOptions) =>
            enterPersistentRecovery(nextState, reason, message, {
              ...recoveryOptions,
              onNotify: adapters.notify,
              onSystemAlert: adapters.telegramSystemAlert,
            }),
        });
      },
      onSkipCurrentGame: handleRecoverySkip,
      onSaveState: () => adapters.saveState(state),
      onSaveTimingState: adapters.saveTimingState,
    });
  }

  async function rotateStreamerIfInvalid(): Promise<void> {
    await rotateInvalidStreamer(state, {
      onFetchStreamContext: adapters.fetchStreamContext,
      onResolveCategorySlug: adapters.resolveCategorySlug,
      onAttemptPlaybackSelfHeal: adapters.attemptPlaybackSelfHeal,
      onSaveState: () => adapters.saveState(state),
      onSaveTimingState: adapters.saveTimingState,
      onRotateStreamer: rotateStreamer,
      onOpenStreamer: acquireStreamerForSelectedGame,
      onEnterPersistentRecovery: async (nextState, reason, message, recoveryOptions) =>
        enterPersistentRecovery(nextState, reason, message, {
          ...recoveryOptions,
          onNotify: adapters.notify,
          onSystemAlert: adapters.telegramSystemAlert,
        }),
      onSkipCurrentGame: handleRecoverySkip,
      onRecoverStalledProgress: recoverStalledProgress,
      onForceRefreshDropsData: () =>
        dependencies.onRefreshDropsData({
          includeCampaignFetch: true,
          includeInventoryFetch: true,
          sessionRecoveryMode: 'background-tab',
        }),
      onTablessWatchActive: () =>
        context.manualWatchTransportSuspended ||
        (state.appState.watchTransportMode === 'tabless' && !state.appState.watchHealth?.shouldFallback),
    });
  }

  return {
    acquireStreamerForSelectedGame,
    ensureWorkspaceForSelectedGame,
    handleAuthoritativeCampaignUnavailable,
    handleRecoverySkip,
    recoverStalledProgress,
    rotateStreamerIfInvalid,
  };
}
