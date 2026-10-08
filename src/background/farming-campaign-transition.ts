import { campaignRejectionReason, isCampaignAcquired } from '../shared/campaign-eligibility.ts';
import { gameKey, getGameDisplayLabel } from '../shared/game-selection.ts';
import { isRewardFarmableNow, isRewardScheduledForFuture } from '../shared/reward-scheduling.ts';
import { isRewardAcquired } from '../shared/reward-semantics.ts';
import { isExpiredGame } from '../shared/utils.ts';
import type { TwitchDrop, TwitchGame } from '../types/index.ts';
import { hasCompleteIdentifiedRewardSet } from './campaign-reward-identity.ts';
import { STREAM_VALIDATION_GRACE_MS } from './constants.ts';
import {
  dropMatchesSelectedGame,
  projectDropsSnapshot,
  splitDropsForSelectedGame,
} from './drops-projection.ts';
import type { RefreshDropsOutcome } from './drops-tick-refresh.ts';
import { EligibleStreamerDiscoveryUnavailableError } from './eligible-streamer-discovery.ts';
import {
  farmingAutomationCompletionFingerprint,
  reconcileFarmingAutomationSnapshot,
} from './farming-automation-reconciliation.ts';
import type { FarmingSessionContext } from './farming-session-context.ts';
import { currentFarmingSessionEpoch } from './farming-session-revision.ts';
import { logWarn } from './logging.ts';
import { retainPendingStreamerPreparation } from './pending-streamer-preparation.ts';
import { clearRecoveryState } from './recovery-state.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { hasCompletedCampaignWatchTime } from './session-lifecycle-completion.ts';
import { resetStreamTrackingState } from './session-lifecycle-stop.ts';
import { computeEffectiveStallThreshold } from './stream-rotation.ts';
import { normalizePreferredStreamerLanguage, pickStreamerForPreferences } from './streamer-selection.ts';
import {
  NoEligibleStreamerError,
  openBestStreamerForSelectedGame,
  WatchPlaybackUnavailableError,
} from './streamer-selection-flow.ts';
import { beginStreamerWatchAttempt } from './streamer-watch-attempt.ts';
import { createFarmingTarget } from './watch-transport-state.ts';
import type { PreparedWatch } from './watch-transport-transition.ts';

export type CampaignTransitionResult =
  | { readonly kind: 'started' }
  | { readonly kind: 'waiting' }
  | { readonly kind: 'preparing'; readonly retryAt: number }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'completed'; readonly game?: TwitchGame }
  | {
      readonly kind: 'failed';
      readonly reason: 'no-streamers' | 'directory-unavailable' | 'open-failed';
      readonly error: string;
      readonly alternativesExhausted?: boolean;
      readonly failedStreamerName?: string;
    };

function campaignPresentationState(state: ServiceWorkerState, next: ServiceWorkerState = state) {
  // Sync bookkeeping can settle during publication without invalidating playback.
  const {
    monitorWindowId,
    dismissedFarmingMessageIds,
    lastDropsPageRefreshCompletedAt,
    lastDropsPageRefreshNoticeSeenAt,
    campaignSyncState,
    lastDropsPageRefreshAttemptAt,
  } = state.appState;
  return {
    monitorWindowId,
    dismissedFarmingMessageIds,
    lastDropsPageRefreshCompletedAt,
    lastDropsPageRefreshNoticeSeenAt,
    campaignSyncState,
    lastDropsPageRefreshAttemptAt,
    lastSuccessfulRefreshAt:
      Math.max(state.appState.lastSuccessfulRefreshAt ?? 0, next.appState.lastSuccessfulRefreshAt ?? 0) ||
      null,
  };
}

function campaignPublicationFingerprint(state: ServiceWorkerState): string {
  const data = { ...state.appState };
  for (const key of Object.keys(campaignPresentationState(state))) Reflect.deleteProperty(data, key);
  return JSON.stringify(data);
}

export function cloneCampaignWorkingState(state: ServiceWorkerState): ServiceWorkerState {
  return {
    ...state,
    appState: structuredClone(state.appState),
    cachedDropsSnapshot: structuredClone(state.cachedDropsSnapshot),
    cachedCampaignChannelsMap: structuredClone(state.cachedCampaignChannelsMap),
    dropClaimRetryAtById: new Map(state.dropClaimRetryAtById),
    unverifiableRewardsByKey: structuredClone(state.unverifiableRewardsByKey),
  };
}

export function createFarmingCampaignTransition(
  context: FarmingSessionContext,
  refresh: (working: ServiceWorkerState, isCurrent: () => boolean) => Promise<RefreshDropsOutcome>,
) {
  const { state, adapters } = context;
  return async (
    candidate: TwitchGame,
    externalIsCurrent: () => boolean = () => true,
  ): Promise<CampaignTransitionResult> => {
    const prepare = adapters.watchTransport?.prepare;
    if (!prepare)
      return { kind: 'failed', reason: 'open-failed', error: 'Watch preparation is unavailable.' };
    const epoch = currentFarmingSessionEpoch(state);
    const generation = state.tickGeneration;
    const acquisitionGeneration = state.streamerAcquisitionGeneration;
    const preference = state.appState.watchTransportPreference;
    const language = state.appState.preferredStreamerLanguage;
    const selectionMode = state.appState.streamerSelectionMode;
    const isCurrent = () =>
      externalIsCurrent() &&
      currentFarmingSessionEpoch(state) === epoch &&
      state.tickGeneration === generation &&
      state.appState.isRunning &&
      !state.appState.isPaused &&
      state.appState.watchTransportPreference === preference &&
      state.appState.preferredStreamerLanguage === language &&
      state.appState.streamerSelectionMode === selectionMode;
    if (!isCurrent()) return { kind: 'cancelled' };
    const sameCampaign =
      state.appState.selectedGame !== null && gameKey(state.appState.selectedGame) === gameKey(candidate);
    const continuingStall = sameCampaign && state.appState.recoveryReason === 'stalled-progress';
    const working = cloneCampaignWorkingState(state);
    working.appState.selectedGame = candidate;
    working.appState.activeStreamer = null;
    working.appState.currentDrop = null;
    splitDropsForSelectedGame(working, working.cachedDropsSnapshot);
    resetStreamTrackingState(working, continuingStall);
    working.hasCurrentGenerationCampaignValidation = state.hasCurrentGenerationCampaignValidation;
    working.avoidStreamerName = state.avoidStreamerName;
    working.offlineChecks = sameCampaign ? state.offlineChecks : 0;
    const retainInitialWait = async (): Promise<CampaignTransitionResult> => {
      if (!sameCampaign || state.appState.activeStreamer) return { kind: 'waiting' };
      if (!isCurrent()) return { kind: 'cancelled' };
      const key = gameKey(candidate);
      const next: ServiceWorkerState = {
        ...state,
        appState: {
          ...state.appState,
          availableGames: working.appState.availableGames,
          campaignDropsByKey: working.appState.campaignDropsByKey,
          allDrops: working.appState.allDrops,
          pendingDrops: working.appState.pendingDrops,
          completedDrops: working.appState.completedDrops,
          currentDrop: working.appState.currentDrop,
          lastSuccessfulRefreshAt: working.appState.lastSuccessfulRefreshAt,
          queueEntryMetadataByKey: { ...state.appState.queueEntryMetadataByKey },
          isRunning: true,
          isPaused: false,
          selectedGame: working.appState.selectedGame ?? candidate,
          queue: [candidate, ...state.appState.queue.filter((game) => gameKey(game) !== key)],
          queueResumeOnAvailability: false,
          activeStreamer: null,
          tabId: null,
          watchHealth: null,
        },
        cachedDropsSnapshot: working.cachedDropsSnapshot,
        cachedCampaignChannelsMap: working.cachedCampaignChannelsMap,
      };
      clearRecoveryState(next);
      const beforeSave = campaignPublicationFingerprint(state);
      const evidenceBeforeSave = farmingAutomationCompletionFingerprint(state);
      try {
        await adapters.saveState(next, { deferPublicEffects: true, transactionOwner: state });
        if (
          !isCurrent() ||
          campaignPublicationFingerprint(state) !== beforeSave ||
          farmingAutomationCompletionFingerprint(state) !== evidenceBeforeSave
        ) {
          await adapters.saveState(state);
          return { kind: 'cancelled' };
        }
      } catch {
        return { kind: 'failed', reason: 'open-failed', error: 'Unable to save the farming start.' };
      }
      Object.assign(next.appState, campaignPresentationState(state, next));
      Object.assign(state, next);
      await adapters.saveTimingState(state);
      adapters.broadcastStateUpdate(state.appState);
      return { kind: 'waiting' };
    };
    const refreshOutcome = await refresh(working, isCurrent);
    if (!isCurrent()) return { kind: 'cancelled' };
    if (isCampaignAcquired(candidate) || isExpiredGame(candidate))
      return { kind: 'completed', game: candidate };
    if (refreshOutcome !== 'refreshed')
      return refreshOutcome === 'auth-required'
        ? {
            kind: 'failed',
            reason: 'directory-unavailable',
            error: 'Sign in to Twitch to verify this campaign.',
          }
        : {
            kind: 'failed',
            reason: 'directory-unavailable',
            error: 'Unable to verify this campaign right now.',
          };
    const selected = working.appState.selectedGame;
    if (selected && (isCampaignAcquired(selected) || isExpiredGame(selected))) {
      return { kind: 'completed', game: selected };
    }
    if (!selected || gameKey(selected) !== gameKey(candidate)) return { kind: 'waiting' };
    const candidateDrops = working.cachedDropsSnapshot.filter((drop) =>
      dropMatchesSelectedGame(drop, selected),
    );
    if (
      hasCompleteIdentifiedRewardSet(selected, candidateDrops, true) &&
      candidateDrops.every(isRewardAcquired)
    )
      return {
        kind: 'completed',
        game: {
          ...selected,
          allDropsCompleted: true,
          rewardSummary: { completion: 'all-acquired', remainderReasons: [] },
        },
      };
    if (candidateDrops.length === 0)
      return {
        kind: 'failed',
        reason: 'directory-unavailable',
        error: 'Unable to verify rewards for this campaign right now.',
      };
    if (hasCompletedCampaignWatchTime(working, selected)) {
      projectDropsSnapshot(
        state,
        {
          games: working.appState.availableGames,
          drops: working.cachedDropsSnapshot,
          updatedAt: context.now(),
        },
        'campaign-authoritative',
      );
      await adapters.saveState(state);
      if (!isCurrent()) return { kind: 'cancelled' };
      return {
        kind: 'completed',
        game: {
          ...selected,
          allDropsCompleted: false,
          rewardSummary: { completion: 'farming-complete', remainderReasons: [] },
        },
      };
    }
    if (!candidateDrops.some((drop) => !isRewardAcquired(drop) && isRewardFarmableNow(drop))) {
      return retainInitialWait();
    }
    const candidateWatch: { watch: PreparedWatch | null } = { watch: null };
    let reservationFailed = false;
    let reservedKey: string | null = null;
    let reservationBefore: ServiceWorkerState['appState']['queueEntryMetadataByKey'][string] | undefined;
    let reservationCurrent: ServiceWorkerState['appState']['queueEntryMetadataByKey'][string] | undefined;
    const releaseReservation = async () => {
      if (
        reservedKey &&
        currentFarmingSessionEpoch(state) === epoch &&
        state.streamerAcquisitionGeneration === acquisitionGeneration &&
        state.appState.queueEntryMetadataByKey[reservedKey] === reservationCurrent
      ) {
        if (reservationBefore) state.appState.queueEntryMetadataByKey[reservedKey] = reservationBefore;
        else delete state.appState.queueEntryMetadataByKey[reservedKey];
        await adapters.saveState(state);
        return true;
      }
      return false;
    };
    const cancelled = async (): Promise<CampaignTransitionResult> => {
      if (!(await releaseReservation())) await adapters.saveState(state);
      return { kind: 'cancelled' };
    };
    let opened: boolean;
    try {
      opened = await openBestStreamerForSelectedGame(
        working,
        {
          isCurrent,
          onFetchDirectoryStreamersFromApi: adapters.fetchDirectoryStreamersFromApi,
          probeStreamInfo: adapters.probeStreamInfo,
          onRefreshVerifiedGame: adapters.refreshVerifiedGame,
          onOpenForegroundChannel: adapters.openForegroundChannel,
          onAttemptStreamer: async (game, name) => {
            if (!isCurrent()) return false;
            const key = gameKey(game);
            const before = state.appState.queueEntryMetadataByKey[key];
            if (!beginStreamerWatchAttempt(state, game, name)) return false;
            reservedKey = key;
            reservationBefore = before;
            reservationCurrent = state.appState.queueEntryMetadataByKey[key];
            working.appState.queueEntryMetadataByKey[gameKey(game)] =
              state.appState.queueEntryMetadataByKey[gameKey(game)];
            try {
              await adapters.saveState(state);
            } catch (error) {
              reservationFailed = true;
              throw error;
            }
            return isCurrent();
          },
          onOpenWatchTransport: async (streamer) => {
            const target = createFarmingTarget(working, streamer);
            if (!target || !isCurrent()) return { kind: 'cancelled' };
            state.streamerAcquisitionPhase = 'playback';
            const result = await prepare(target, isCurrent);
            if (!isCurrent()) {
              if (result.kind === 'prepared') await result.watch.dispose();
              return { kind: 'cancelled' };
            }
            retainPendingStreamerPreparation(
              state,
              selected,
              result.kind === 'failed' ? result.health : result.watch.health,
              working,
              context.now(),
            );
            working.appState.queueEntryMetadataByKey[gameKey(selected)] =
              state.appState.queueEntryMetadataByKey[gameKey(selected)];
            if (result.kind === 'failed') return { kind: 'failed', health: result.health ?? null };
            candidateWatch.watch = result.watch;
            return { kind: 'started', health: result.watch.health };
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
    } catch (error) {
      await candidateWatch.watch?.dispose();
      if (!isCurrent()) return cancelled();
      if (error instanceof WatchPlaybackUnavailableError && error.health?.reason === 'playback-pending') {
        if (state.appState.queueEntryMetadataByKey[gameKey(selected)]?.watchAttempt?.preparing)
          return { kind: 'preparing', retryAt: context.now() + 30_000 };
        await adapters.watchTransport?.stop();
        if (!isCurrent()) return cancelled();
      }
      if (error instanceof EligibleStreamerDiscoveryUnavailableError) {
        await releaseReservation();
        if (!isCurrent()) return cancelled();
      }
      if (reservationFailed)
        return { kind: 'failed', reason: 'open-failed', error: 'Unable to save the streamer attempt.' };
      if (error instanceof NoEligibleStreamerError)
        return {
          kind: 'failed',
          reason: 'no-streamers',
          alternativesExhausted: true,
          error: 'No eligible alternative streamer is available for this campaign.',
        };
      const reason = error instanceof WatchPlaybackUnavailableError ? 'open-failed' : 'directory-unavailable';
      return {
        kind: 'failed',
        reason,
        ...(error instanceof WatchPlaybackUnavailableError && error.streamerName
          ? { failedStreamerName: error.streamerName, alternativesExhausted: error.alternativesExhausted }
          : {}),
        error:
          error instanceof EligibleStreamerDiscoveryUnavailableError
            ? 'Unable to verify eligible streamers right now.'
            : reason === 'open-failed'
              ? 'Eligible stream playback could not start.'
              : 'Unable to check streamers right now.',
      };
    }
    const prepared = candidateWatch.watch;
    if (!opened || !prepared) {
      await prepared?.dispose();
      return isCurrent()
        ? {
            kind: 'failed',
            reason: 'no-streamers',
            error: 'No eligible streamer is available for this campaign.',
          }
        : cancelled();
    }
    if (!isCurrent()) {
      await prepared.dispose();
      return cancelled();
    }
    const rebased = reconcileFarmingAutomationSnapshot(
      {
        games: working.appState.availableGames,
        drops: working.cachedDropsSnapshot,
        campaignDropsByKey: working.appState.campaignDropsByKey,
        campaignChannelsMap: working.cachedCampaignChannelsMap,
        updatedAt: context.now(),
      },
      state,
    );
    projectDropsSnapshot(
      working,
      {
        games: rebased.games.map((game) => ({
          ...game,
          allowedChannels: game.allowedChannels ? [...game.allowedChannels] : game.allowedChannels,
        })),
        drops: rebased.drops.map((drop) => ({
          ...drop,
          benefitIds: drop.benefitIds?.slice(),
          rewardDistributionTypes: drop.rewardDistributionTypes?.slice(),
        })),
        updatedAt: rebased.updatedAt,
      },
      'cached',
    );
    const rebasedSelection = working.appState.selectedGame;
    if (
      !rebasedSelection ||
      campaignRejectionReason(rebasedSelection) ||
      !working.appState.pendingDrops.some((drop) => isRewardFarmableNow(drop))
    ) {
      await prepared.dispose();
      if (
        rebasedSelection &&
        !campaignRejectionReason(rebasedSelection) &&
        working.appState.pendingDrops.some(
          (drop) => !isRewardAcquired(drop) && isRewardScheduledForFuture(drop),
        )
      ) {
        return { kind: 'waiting' };
      }
      return rebasedSelection && (isCampaignAcquired(rebasedSelection) || isExpiredGame(rebasedSelection))
        ? { kind: 'completed', game: rebasedSelection }
        : { kind: 'waiting' };
    }
    const key = gameKey(selected);
    const metadata = state.appState.queueEntryMetadataByKey[key];
    const projectedDrop = (): TwitchDrop | null => working.appState.currentDrop;
    const next: ServiceWorkerState = {
      ...state,
      appState: {
        ...state.appState,
        selectedGame: rebasedSelection,
        pendingWatchTarget: null,
        activeStreamer: working.appState.activeStreamer,
        availableGames: working.appState.availableGames,
        campaignDropsByKey: working.appState.campaignDropsByKey,
        allDrops: working.appState.allDrops,
        pendingDrops: working.appState.pendingDrops,
        completedDrops: working.appState.completedDrops,
        currentDrop: projectedDrop(),
        lastSuccessfulRefreshAt: working.appState.lastSuccessfulRefreshAt,
        completionNotified: false,
        queue: [rebasedSelection, ...state.appState.queue.filter((game) => gameKey(game) !== key)],
        queueEntryMetadataByKey: { ...state.appState.queueEntryMetadataByKey },
        watchHealth: prepared.health,
        watchTransportMode: prepared.health.mode,
        tabId: prepared.ownership.kind === 'managed-tab' ? prepared.ownership.tabId : null,
      },
      cachedDropsSnapshot: working.cachedDropsSnapshot,
      cachedCampaignChannelsMap: working.cachedCampaignChannelsMap,
      lastFullRefreshAt: working.lastFullRefreshAt,
      lastInventoryRefreshAt: working.lastInventoryRefreshAt,
    };
    if (metadata) {
      const {
        streamerRetryAt: _retry,
        streamerRetryReason: _reason,
        streamerWaitState: _wait,
        manualPriorityAt: _manualPriority,
        ...retained
      } = metadata;
      next.appState.queueEntryMetadataByKey[key] = retained;
    }
    if (continuingStall) {
      next.recoveryBackoffUntil =
        context.now() + computeEffectiveStallThreshold(next.appState.currentDrop?.requiredMinutes);
      next.appState.recoveryBackoffUntil = next.recoveryBackoffUntil;
    } else clearRecoveryState(next);
    const liveProjectionBeforeSave = campaignPublicationFingerprint(state);
    const liveEvidenceBeforeSave = farmingAutomationCompletionFingerprint(state);
    try {
      await adapters.saveState(next, { deferPublicEffects: true, transactionOwner: state });
      if (
        !isCurrent() ||
        campaignPublicationFingerprint(state) !== liveProjectionBeforeSave ||
        farmingAutomationCompletionFingerprint(state) !== liveEvidenceBeforeSave
      ) {
        await prepared.dispose();
        return cancelled();
      }
    } catch {
      await prepared.dispose();
      return { kind: 'failed', reason: 'open-failed', error: 'Unable to save the campaign change.' };
    }
    if (prepared.promote().kind === 'discarded') {
      await prepared.dispose();
      return cancelled();
    }
    Object.assign(next.appState, campaignPresentationState(state, next));
    Object.assign(state, next);
    const rotations = state.noProgressRotationAttempts;
    resetStreamTrackingState(state, continuingStall);
    if (sameCampaign) state.noProgressRotationAttempts = rotations;
    state.streamValidationGraceUntil = context.now() + STREAM_VALIDATION_GRACE_MS;
    state.hasCurrentGenerationCampaignValidation = working.hasCurrentGenerationCampaignValidation;
    adapters.broadcastStateUpdate(state.appState);
    try {
      await adapters.saveState(state);
    } catch (error) {
      logWarn('Unable to finalize persisted state after the campaign watch was promoted', error);
    }
    try {
      await adapters.saveTimingState(state);
    } catch (error) {
      logWarn('Unable to save timing state after the campaign watch was promoted', error);
    }
    return { kind: 'started' };
  };
}
