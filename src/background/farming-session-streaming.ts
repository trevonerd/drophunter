import { gameKey, getGameDisplayLabel } from '../shared/game-selection.ts';
import { isRewardAcquired } from '../shared/reward-semantics.ts';
import {
  dropMatchesSelectedGame,
  markDropUnverifiable,
  projectDropsSnapshot,
  recomputeSelectedCampaignSummaryAfterLocalMarker,
} from './drops-projection.ts';
import type { RefreshDropsOutcome } from './drops-tick-refresh.ts';
import type { FarmingSessionContext, RefreshDropsOptions } from './farming-session-context.ts';
import { createFarmingSessionStallRecovery } from './farming-session-stall-recovery.ts';
import { createPersistentRecoveryHandler } from './persistent-recovery-notification.ts';
import { skipCurrentGameAndAdvanceQueue, skipCurrentGameDueToStall } from './session-lifecycle.ts';
import { resetStreamTrackingState } from './session-lifecycle-stop.ts';
import type { StopFarmingSessionRequest } from './session-lifecycle-types.ts';
import { blockSelectedCampaignForStall } from './stalled-campaign-blocking.ts';
import type { StalledProgressRecoveryResult, StalledProgressSource } from './stalled-progress-recovery.ts';
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
  readonly onStopMonitoring: () => void;
};

export type FarmingSessionStreaming = {
  readonly acquireStreamerForSelectedGame: (isCurrent?: () => boolean) => Promise<boolean>;
  readonly ensureWorkspaceForSelectedGame: (isCurrent?: () => boolean) => Promise<void>;
  readonly handleAuthoritativeCampaignUnavailable: (
    game: import('../types/index.ts').TwitchGame,
  ) => Promise<void>;
  readonly handleRecoverySkip: () => Promise<void>;
  readonly recoverStalledProgress: (
    source: StalledProgressSource,
    isCurrent?: () => boolean,
  ) => Promise<StalledProgressRecoveryResult>;
  readonly rotateStreamerIfInvalid: (isCurrent?: () => boolean) => Promise<void>;
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
            await adapters.openForegroundChannel(streamer);
            return isCurrent();
          }
          const health = await adapters.watchTransport.start(streamer, isCurrent);
          if (!isCurrent()) {
            return false;
          }
          state.appState.watchTransportMode = health.mode;
          state.appState.watchHealth = health;
          return !['failed', 'stopped', 'disabled', 'not-started'].includes(health.status);
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

  async function skipCurrentGameDueToNoStreamers(
    reason: 'no-streamers' | 'directory-unavailable' = 'no-streamers',
    isCurrent?: () => boolean,
  ): Promise<void> {
    await skipCurrentGameAndAdvanceQueue(state, reason, {
      isCurrent,
      onEnsureWorkspace: ensureWorkspaceForSelectedGame,
      onRefreshDropsData: async (options) => {
        await dependencies.onRefreshDropsData(options);
      },
      onOpenStreamer: acquireStreamerForSelectedGame,
      onSaveState: () => adapters.saveState(state),
      onSaveTimingState: adapters.saveTimingState,
      onStopMonitoring: async () => {
        dependencies.onStopMonitoring();
        await adapters.watchTransport?.stop();
      },
      onCloseManagedTabIfSafe: adapters.closeManagedTabIfSafe,
      onStopFarmingSession: dependencies.onStopFarmingSession,
      onNotify: adapters.notify,
    });
  }

  async function acquireStreamerForSelectedGame(isCurrent: () => boolean = () => true): Promise<boolean> {
    return acquireStreamer(state, {
      onOpenStreamer: (current) => openBestStreamerForSelectedGame(current),
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
    const stalledDrop = state.appState.currentDrop;
    if (exhaustedStalledRecovery && stalledDrop && markDropUnverifiable(state, stalledDrop, context.now())) {
      projectDropsSnapshot(
        state,
        {
          games: state.appState.availableGames,
          drops: state.cachedDropsSnapshot,
          updatedAt: context.now(),
        },
        'cached',
      );
      recomputeSelectedCampaignSummaryAfterLocalMarker(state);
      resetStreamTrackingState(state);
      await adapters.saveTimingState(state);
      await dependencies.onAdvanceQueueIfCompleted();
      await adapters.saveState(state);
      return;
    }
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

  const recoverStalledProgress = createFarmingSessionStallRecovery(context, {
    onRefreshDropsData: dependencies.onRefreshDropsData,
    onAdvanceQueueIfCompleted: dependencies.onAdvanceQueueIfCompleted,
    onAcquireStreamer: acquireStreamerForSelectedGame,
    onSkipCurrentGame: handleRecoverySkip,
    onEnterPersistentRecovery: enterPersistentRecovery,
  });

  async function rotateStreamerIfInvalid(isCurrent?: () => boolean): Promise<void> {
    await rotateInvalidStreamer(state, {
      isCurrent,
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
      onForceRefreshDropsData: (current = isCurrent) =>
        dependencies.onRefreshDropsData({
          includeCampaignFetch: true,
          includeInventoryFetch: true,
          sessionRecoveryMode: 'background-tab',
          isCurrent: current,
        }),
      onTablessWatchActive: () =>
        context.manualWatchTransportSuspended ||
        (state.appState.activeStreamer !== null &&
          state.appState.watchTransportMode === 'tabless' &&
          !['not-started', 'stopped'].includes(state.appState.watchHealth?.status ?? '') &&
          !state.appState.watchHealth?.shouldFallback),
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
