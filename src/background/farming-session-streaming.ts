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
import type { FarmingQueueProgression } from './farming-queue-progression.ts';
import type { FarmingSessionContext, RefreshDropsOptions } from './farming-session-context.ts';
import { createFarmingSessionStallRecovery } from './farming-session-stall-recovery.ts';
import { createPersistentRecoveryHandler } from './persistent-recovery-notification.ts';
import { clearRecoveryState } from './recovery-state.ts';
import { resetStreamTrackingState } from './session-lifecycle-stop.ts';
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
  readonly queueProgression: Pick<FarmingQueueProgression, 'skipCurrent' | 'retryWaitingQueue'>;
  readonly onAdvanceQueueIfCompleted: () => Promise<boolean>;
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
    await dependencies.queueProgression.skipCurrent(reason, isCurrent);
  }

  async function acquireStreamerForSelectedGame(isCurrent: () => boolean = () => true): Promise<boolean> {
    const authorized = () =>
      isCurrent() &&
      state.appState.isRunning &&
      !state.appState.isPaused &&
      state.appState.lastStopReason !== 'user-stop';
    if (!authorized()) return false;
    if (state.appState.queueAcquisitionRound?.nextRoundAt != null) {
      return dependencies.queueProgression.retryWaitingQueue(authorized);
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

    await dependencies.queueProgression.skipCurrent('stalled-progress', isCurrent);
  }

  async function handleAuthoritativeCampaignUnavailable(
    game: import('../types/index.ts').TwitchGame,
  ): Promise<void> {
    if (!state.appState.selectedGame || gameKey(state.appState.selectedGame) !== gameKey(game)) {
      return;
    }
    await adapters.notifyCampaignUnavailable?.(game);
    await dependencies.queueProgression.skipCurrent('unfarmable');
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
