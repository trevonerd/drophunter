import { gameKey, getGameDisplayLabel } from '../shared/game-selection.ts';
import { isRewardAcquired } from '../shared/reward-semantics.ts';
import { dropMatchesSelectedGame } from './drops-projection.ts';
import type { RefreshDropsOutcome } from './drops-tick-refresh.ts';
import { EligibleStreamerDiscoveryUnavailableError } from './eligible-streamer-discovery.ts';
import type { FarmingQueueProgression } from './farming-queue-progression.ts';
import type { FarmingSessionContext, RefreshDropsOptions } from './farming-session-context.ts';
import { currentFarmingSessionEpoch } from './farming-session-revision.ts';
import { createFarmingSessionStallRecovery } from './farming-session-stall-recovery.ts';
import { applyRecoveryState, clearRecoveryState } from './recovery-state.ts';
import type { StalledProgressRecoveryResult, StalledProgressSource } from './stalled-progress-recovery.ts';
import type { StreamRotationReason } from './stream-rotation.ts';
import {
  acquireStreamerForSelectedGame as acquireStreamer,
  openBestStreamerForSelectedGame as openBestStreamer,
  rotateStreamerIfInvalid as rotateInvalidStreamer,
  rotateStreamer,
} from './streamer-acquisition.ts';
import { handleOfflineStream } from './streamer-recovery-handlers.ts';
import { normalizePreferredStreamerLanguage, pickStreamerForPreferences } from './streamer-selection.ts';
import { NoEligibleStreamerError, WatchPlaybackUnavailableError } from './streamer-selection-flow.ts';
import { beginStreamerWatchAttempt } from './streamer-watch-attempt.ts';

type FarmingSessionStreamingDependencies = {
  readonly onRefreshDropsData: (options?: RefreshDropsOptions) => Promise<RefreshDropsOutcome>;
  readonly queueProgression: Pick<FarmingQueueProgression, 'skipCurrent' | 'retryWaitingQueue'>;
  readonly onAdvanceQueueIfCompleted: () => Promise<boolean>;
  readonly onWakeMonitoring: (isCurrent: () => boolean) => void;
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

  async function openBestStreamerForSelectedGame(
    isCurrent: () => boolean = () => true,
  ): Promise<boolean | 'cancelled' | 'preparing'> {
    if (context.transitionCampaign && state.appState.selectedGame) {
      const result = await context.transitionCampaign(state.appState.selectedGame, isCurrent);
      if (result.kind === 'started') return true;
      if (result.kind === 'cancelled') return 'cancelled';
      if (result.kind === 'preparing') {
        state.recoveryBackoffUntil = result.retryAt;
        applyRecoveryState(state, 'open-failed', result.retryAt);
        return 'preparing';
      }
      if (result.kind === 'waiting' && !state.appState.recoveryReason) return true;
      if (result.kind !== 'failed') return false;
      if (result.reason === 'open-failed')
        throw new WatchPlaybackUnavailableError(
          null,
          result.failedStreamerName,
          result.alternativesExhausted,
        );
      if (result.alternativesExhausted) throw new NoEligibleStreamerError();
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
        onAttemptStreamer: async (game, name) => {
          if (!isCurrent() || !beginStreamerWatchAttempt(state, game, name)) return false;
          await adapters.saveState(state);
          return isCurrent();
        },
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
    const epoch = currentFarmingSessionEpoch(state);
    const authorized = () =>
      isCurrent() &&
      currentFarmingSessionEpoch(state) === epoch &&
      state.appState.isRunning &&
      !state.appState.isPaused &&
      state.appState.lastStopReason !== 'user-stop';
    if (!authorized()) return false;
    if (state.appState.queueAcquisitionRound?.nextRoundAt != null) {
      return dependencies.queueProgression.retryWaitingQueue(authorized);
    }
    const attempt: { cancelled: (() => boolean) | null } = { cancelled: null };
    const acquired = await acquireStreamer(state, {
      onOpenStreamer: async (current) => {
        const result = await openBestStreamerForSelectedGame(current);
        if (result === 'cancelled') attempt.cancelled = current;
        return result;
      },
      onSkipCurrentGame: async (reason, current) => {
        if (reason === 'stalled-progress') await handleRecoverySkip(true, current);
        else await skipCurrentGameDueToNoStreamers(reason, current);
      },
      onSaveState: () => adapters.saveState(state),
      onSaveTimingState: adapters.saveTimingState,
      isCurrent: authorized,
    });
    const cancelled = attempt.cancelled;
    if (cancelled) {
      dependencies.onWakeMonitoring(
        () =>
          cancelled() &&
          authorized() &&
          state.apiBackoffUntil <= context.now() &&
          state.appState.queueAcquisitionRound?.nextRoundAt == null,
      );
    }
    return acquired;
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
    _verifiedAlternativesExhausted = false,
    isCurrent: () => boolean = () => true,
  ): Promise<void> {
    if (!isCurrent() || !state.appState.isRunning || state.appState.isPaused) return;
    await dependencies.queueProgression.skipCurrent('stalled-progress', isCurrent);
  }

  async function handleAuthoritativeCampaignUnavailable(
    game: import('../types/index.ts').TwitchGame,
  ): Promise<void> {
    if (!state.appState.selectedGame || gameKey(state.appState.selectedGame) !== gameKey(game)) {
      return;
    }
    await dependencies.queueProgression.skipCurrent('unfarmable');
  }

  const recoverStalledProgress = createFarmingSessionStallRecovery(context, {
    onRefreshDropsData: dependencies.onRefreshDropsData,
    onAdvanceQueueIfCompleted: dependencies.onAdvanceQueueIfCompleted,
    onAcquireStreamer: acquireStreamerForSelectedGame,
    onSkipCurrentGame: handleRecoverySkip,
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
    if (reason === 'offline') {
      const channel = state.appState.activeStreamer?.name;
      if (!channel) return;
      await handleOfflineStream(
        state,
        { channelName: channel, pageUrl: `https://www.twitch.tv/${channel}` },
        {
          isCurrent,
          onRotateStreamer: rotateStreamer,
          onOpenStreamer: acquireStreamerForSelectedGame,
          onSaveState: () => adapters.saveState(state),
          onSaveTimingState: adapters.saveTimingState,
        },
        context.now(),
      );
      return;
    }
    if (state.appState.recoveryReason === 'stalled-progress') clearRecoveryState(state);
    await rotateStreamer(state, reason, {
      isCurrent,
      onOpenStreamer: acquireStreamerForSelectedGame,
      onSaveState: () => adapters.saveState(state),
      onSaveTimingState: adapters.saveTimingState,
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
