import { gameKey, getGameDisplayLabel } from '../shared/game-selection.ts';
import { isRewardAcquired } from '../shared/reward-semantics.ts';
import { dropMatchesSelectedGame } from './drops-projection.ts';
import type { RefreshDropsOutcome } from './drops-tick-refresh.ts';
import type { FarmingSessionContext, RefreshDropsOptions } from './farming-session-context.ts';
import { createPersistentRecoveryHandler } from './persistent-recovery-notification.ts';
import { skipCurrentGameAndAdvanceQueue, skipCurrentGameDueToStall } from './session-lifecycle.ts';
import type { StopFarmingSessionRequest } from './session-lifecycle-types.ts';
import { blockSelectedCampaignForStall } from './stalled-campaign-blocking.ts';
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
  readonly acquireStreamerForSelectedGame: (isCurrent?: () => boolean) => Promise<boolean>;
  readonly ensureWorkspaceForSelectedGame: (isCurrent?: () => boolean) => Promise<void>;
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
  const enterPersistentRecovery = createPersistentRecoveryHandler({
    automationNotify: adapters.automationNotify,
    notify: adapters.notify,
    telegramSystemAlert: adapters.telegramSystemAlert,
  });

  async function openBestStreamerForSelectedGame(isCurrent: () => boolean = () => true): Promise<boolean> {
    return openBestStreamer(
      state,
      {
        onFetchDirectoryStreamersFromApi: adapters.fetchDirectoryStreamersFromApi,
        onOpenForegroundChannel: adapters.openForegroundChannel,
        onOpenWatchTransport: async (streamer) => {
          if (!isCurrent()) return false;
          if (!adapters.watchTransport) {
            if (!isCurrent()) return false;
            await adapters.openForegroundChannel(streamer);
            return isCurrent();
          }
          const health = await adapters.watchTransport.start(streamer, isCurrent);
          if (!isCurrent()) {
            return false;
          }
          state.appState.watchTransportMode = health.mode;
          state.appState.watchHealth = health;
          return health.mode === 'tabless' || health.status !== 'failed';
        },
        isCurrent,
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

  async function acquireStreamerForSelectedGame(isCurrent: () => boolean = () => true): Promise<boolean> {
    return acquireStreamer(state, {
      onOpenStreamer: () => openBestStreamerForSelectedGame(isCurrent),
      onSkipCurrentGame: skipCurrentGameDueToNoStreamers,
      onSaveState: () => adapters.saveState(state),
      onSaveTimingState: adapters.saveTimingState,
      isCurrent,
    });
  }

  async function ensureWorkspaceForSelectedGame(isCurrent: () => boolean = () => true): Promise<void> {
    const selectedGame = state.appState.selectedGame;
    if (!selectedGame || !isCurrent()) {
      return;
    }
    const resolvedSlug = await adapters.resolveCategorySlug(selectedGame);
    if (!isCurrent() || state.appState.selectedGame !== selectedGame) return;
    state.appState.selectedGame = {
      ...selectedGame,
      categorySlug: resolvedSlug,
    };
  }

  async function handleRecoverySkip(): Promise<void> {
    const exhaustedStalledRecovery =
      state.appState.recoveryReason === 'stalled-progress' &&
      state.stalledRecoveryAttempts >= MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS;
    if (exhaustedStalledRecovery) {
      await blockSelectedCampaignForStall({
        state,
        now: context.now,
        fetchDirectoryStreamers: adapters.fetchDirectoryStreamersFromApi,
        notify: adapters.automationNotify,
      });
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
    const result = await recoverStalledProgressOperation(state, source, {
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
          onEnterPersistentRecovery: enterPersistentRecovery,
        });
      },
      onSkipCurrentGame: handleRecoverySkip,
      onSaveState: () => adapters.saveState(state),
      onSaveTimingState: adapters.saveTimingState,
    });
    if (result.kind === 'retry-scheduled' && result.started && state.appState.selectedGame) {
      const selectedGame = state.appState.selectedGame;
      await adapters.automationNotify?.({
        transitionId: `stall-recovery:${gameKey(selectedGame)}:${result.attempt}:${result.retryAt}`,
        event: 'recovery',
        campaignId: selectedGame.campaignId ?? selectedGame.id,
        title: 'Checking stalled Drop progress',
        message: `DropHunter is verifying progress for ${getGameDisplayLabel(selectedGame)} before changing streamer.`,
        priority: 1,
        telegramReason: 'recovery',
      });
    }
    return result;
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
      onEnterPersistentRecovery: enterPersistentRecovery,
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
