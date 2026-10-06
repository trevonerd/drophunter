import { gameKey, getGameDisplayLabel } from '../shared/game-selection.ts';
import { isRewardAcquired } from '../shared/reward-semantics.ts';
import {
  dropMatchesSelectedGame,
  markDropUnverifiable,
  projectDropsSnapshot,
  recomputeSelectedCampaignSummaryAfterLocalMarker,
} from './drops-projection.ts';
import type { RefreshDropsOutcome } from './drops-tick-refresh.ts';
import { EligibleStreamerDiscoveryUnavailableError } from './eligible-streamer-discovery.ts';
import type { FarmingSessionContext, RefreshDropsOptions } from './farming-session-context.ts';
import { currentFarmingSessionEpoch } from './farming-session-revision.ts';
import { createFarmingSessionStallRecovery } from './farming-session-stall-recovery.ts';
import { createPersistentRecoveryHandler } from './persistent-recovery-notification.ts';
import { clearRecoveryState } from './recovery-state.ts';
import { skipCurrentGameAndAdvanceQueue, skipCurrentGameDueToStall } from './session-lifecycle.ts';
import { queueWaitingNotification } from './session-lifecycle-queue-parking.ts';
import { progressFarmingQueue } from './session-lifecycle-queue-progression.ts';
import { isAutomaticFavoriteSession } from './session-lifecycle-queue-selection.ts';
import { resetStreamTrackingState } from './session-lifecycle-stop.ts';
import type { StopFarmingSessionRequest } from './session-lifecycle-types.ts';
import { blockSelectedCampaignForStall } from './stalled-campaign-blocking.ts';
import type { StalledProgressRecoveryResult, StalledProgressSource } from './stalled-progress-recovery.ts';
import type { StreamRotationReason } from './stream-rotation.ts';
import { MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS } from './stream-rotation.ts';
import {
  acquireStreamerForSelectedGame as acquireStreamer,
  openBestStreamerForSelectedGame as openBestStreamer,
  rotateStreamerIfInvalid as rotateInvalidStreamer,
  rotateStreamer,
} from './streamer-acquisition.ts';
import { normalizePreferredStreamerLanguage, pickStreamerForPreferences } from './streamer-selection.ts';
import { NoEligibleStreamerError, WatchPlaybackUnavailableError } from './streamer-selection-flow.ts';

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
  readonly handleRecoverySkip: (
    verifiedAlternativesExhausted?: boolean,
    isCurrent?: () => boolean,
  ) => Promise<void>;
  readonly recoverStalledProgress: (
    source: StalledProgressSource,
    isCurrent?: () => boolean,
  ) => Promise<StalledProgressRecoveryResult>;
  readonly rotateStreamerIfInvalid: (isCurrent?: () => boolean) => Promise<void>;
  readonly rotateStreamerForTransportFailure: (
    reason: StreamRotationReason,
    isCurrent?: () => boolean,
  ) => Promise<void>;
};

export function createFarmingSessionStreaming(
  context: FarmingSessionContext,
  dependencies: FarmingSessionStreamingDependencies,
): FarmingSessionStreaming {
  const { state, adapters } = context;
  const onQueueWaiting = async (transitionAt: number): Promise<void> => {
    await adapters.automationNotify?.(queueWaitingNotification(transitionAt));
  };
  const enterPersistentRecovery = createPersistentRecoveryHandler({
    automationNotify: adapters.automationNotify,
    notify: adapters.notify,
    telegramSystemAlert: adapters.telegramSystemAlert,
  });

  async function openBestStreamerForSelectedGame(isCurrent: () => boolean = () => true): Promise<boolean> {
    if (context.transitionCampaign && state.appState.selectedGame) {
      const result = await context.transitionCampaign(state.appState.selectedGame, isCurrent);
      if (result.kind === 'started') return true;
      if (result.kind !== 'failed') return false;
      if (result.alternativesExhausted) throw new NoEligibleStreamerError();
      if (result.reason === 'open-failed') throw new WatchPlaybackUnavailableError(null);
      if (result.reason === 'directory-unavailable') throw new EligibleStreamerDiscoveryUnavailableError();
      return false;
    }
    return openBestStreamer(
      state,
      {
        onFetchDirectoryStreamersFromApi: adapters.fetchDirectoryStreamersFromApi,
        probeStreamInfo: adapters.probeStreamInfo,
        onRefreshVerifiedGame: adapters.refreshVerifiedGame,
        onOpenForegroundChannel: adapters.openForegroundChannel,
        onOpenWatchTransport: async (streamer) => {
          if (!isCurrent()) return { kind: 'cancelled' } as const;
          if (!adapters.watchTransport) {
            await adapters.openForegroundChannel(streamer);
            return isCurrent()
              ? ({ kind: 'started', health: null } as const)
              : ({ kind: 'cancelled' } as const);
          }
          const result = await adapters.watchTransport.start(streamer, isCurrent);
          if (!isCurrent()) {
            return { kind: 'cancelled' } as const;
          }
          return result;
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
    reason: 'no-streamers' | 'directory-unavailable' | 'open-failed' = 'no-streamers',
    isCurrent?: () => boolean,
  ): Promise<void> {
    await skipCurrentGameAndAdvanceQueue(state, reason, {
      onTransitionToCampaign: context.transitionCampaign,
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
      onQueueWaiting,
      onStopFarmingSession: dependencies.onStopFarmingSession,
      onNotify: adapters.notify,
    });
  }

  async function acquireStreamerForSelectedGame(isCurrent: () => boolean = () => true): Promise<boolean> {
    const authorized = () =>
      isCurrent() &&
      state.appState.isRunning &&
      !state.appState.isPaused &&
      state.appState.lastStopReason !== 'user-stop';
    if (!authorized()) return false;
    if (context.transitionCampaign && state.appState.queueAcquisitionRound?.nextRoundAt != null) {
      if (state.appState.queueAcquisitionRound.nextRoundAt > context.now()) return false;
      const result = await progressFarmingQueue(state, {
        restrictUnauthorizedManualContinuation: isAutomaticFavoriteSession(
          state,
          state.appState.selectedGame,
        ),
        terminalFarmingCompleteGame: null,
        options: {
          isCurrent: authorized,
          onTransitionToCampaign: context.transitionCampaign,
          onSaveState: () => adapters.saveState(state),
          onSaveTimingState: adapters.saveTimingState,
          onQueueWaiting,
        },
      });
      return result.kind === 'advanced' && result.opened;
    }
    return acquireStreamer(state, {
      onOpenStreamer: (current) => openBestStreamerForSelectedGame(current),
      onSkipCurrentGame: (reason, current) =>
        reason === 'stalled-progress'
          ? handleRecoverySkip(true, current)
          : skipCurrentGameDueToNoStreamers(reason, current),
      onSaveState: () => adapters.saveState(state),
      onSaveTimingState: adapters.saveTimingState,
      isCurrent: authorized,
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

  async function handleRecoverySkip(
    verifiedAlternativesExhausted = false,
    isCurrent: () => boolean = () => true,
  ): Promise<void> {
    if (!isCurrent() || !state.appState.isRunning || state.appState.isPaused) return;
    const exhaustedStalledRecovery =
      verifiedAlternativesExhausted ||
      (state.appState.queueEntryMetadataByKey[
        state.appState.selectedGame ? gameKey(state.appState.selectedGame) : ''
      ]?.stalledStreamerNames?.length ?? 0) >=
        MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS + 1;
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
      if (!isCurrent() || !state.appState.isRunning || state.appState.isPaused) return;
      await dependencies.onAdvanceQueueIfCompleted();
      if (!isCurrent() || !state.appState.isRunning || state.appState.isPaused) return;
      await adapters.saveState(state);
      return;
    }
    if (exhaustedStalledRecovery) {
      try {
        const blocked = await blockSelectedCampaignForStall({
          state,
          now: context.now,
          isCurrent: () => isCurrent() && state.appState.isRunning && !state.appState.isPaused,
          fetchDirectoryStreamers: adapters.fetchDirectoryStreamersFromApi,
          notify: adapters.automationNotify,
        });
        if (!blocked) return;
      } catch {
        // A directory outage cannot erase the confirmed failed-name history or prevent queue progress.
      }
      if (!isCurrent() || !state.appState.isRunning || state.appState.isPaused) return;
    }

    const queueAdvanceEpoch = currentFarmingSessionEpoch(state);
    const queueAdvanceGeneration = state.tickGeneration;
    await skipCurrentGameDueToStall(state, {
      onTransitionToCampaign: context.transitionCampaign,
      isCurrent,
      isCurrentAfterQueueAdvance: (game) =>
        currentFarmingSessionEpoch(state) === queueAdvanceEpoch &&
        state.tickGeneration === queueAdvanceGeneration &&
        state.appState.isRunning &&
        !state.appState.isPaused &&
        state.appState.selectedGame !== null &&
        gameKey(state.appState.selectedGame) === gameKey(game),
      onEnsureWorkspace: ensureWorkspaceForSelectedGame,
      onRefreshDropsData: async (options) => {
        await dependencies.onRefreshDropsData(options);
      },
      onOpenStreamer: acquireStreamerForSelectedGame,
      onSaveState: () => adapters.saveState(state),
      onSaveTimingState: adapters.saveTimingState,
      onStopFarmingSession: dependencies.onStopFarmingSession,
      onQueueWaiting,
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
      onTransitionToCampaign: context.transitionCampaign,
      onEnsureWorkspace: ensureWorkspaceForSelectedGame,
      onRefreshDropsData: async (options) => {
        await dependencies.onRefreshDropsData(options);
      },
      onOpenStreamer: acquireStreamerForSelectedGame,
      onSaveState: () => adapters.saveState(state),
      onSaveTimingState: adapters.saveTimingState,
      onStopFarmingSession: (options) =>
        dependencies.onStopFarmingSession({ ...options, suppressNotifications: true }),
      onQueueWaiting,
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

  async function rotateStreamerForTransportFailure(
    reason: StreamRotationReason,
    isCurrent: () => boolean = () => true,
  ): Promise<void> {
    if (!isCurrent()) return;
    if (state.appState.recoveryReason === 'stalled-progress') clearRecoveryState(state);
    await rotateStreamer(state, reason, {
      isCurrent,
      onOpenStreamer: acquireStreamerForSelectedGame,
      onSaveState: () => adapters.saveState(state),
      onSaveTimingState: adapters.saveTimingState,
      onEnterPersistentRecovery: enterPersistentRecovery,
      onSkipCurrentGame: handleRecoverySkip,
    });
  }

  return {
    acquireStreamerForSelectedGame,
    ensureWorkspaceForSelectedGame,
    handleAuthoritativeCampaignUnavailable,
    handleRecoverySkip,
    recoverStalledProgress,
    rotateStreamerIfInvalid,
    rotateStreamerForTransportFailure,
  };
}
