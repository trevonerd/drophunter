import { campaignRejectionReason } from '../shared/campaign-eligibility.ts';
import { gameKey, getGameDisplayLabel } from '../shared/game-selection.ts';
import { isRewardFarmableNow } from '../shared/reward-scheduling.ts';
import { isRewardAcquired } from '../shared/reward-semantics.ts';
import type { TwitchDrop, TwitchGame } from '../types/index.ts';
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
import { clearRecoveryState } from './recovery-state.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { resetStreamTrackingState } from './session-lifecycle-stop.ts';
import { computeEffectiveStallThreshold } from './stream-rotation.ts';
import { normalizePreferredStreamerLanguage, pickStreamerForPreferences } from './streamer-selection.ts';
import {
  NoEligibleStreamerError,
  openBestStreamerForSelectedGame,
  WatchPlaybackUnavailableError,
} from './streamer-selection-flow.ts';
import { createFarmingTarget } from './watch-transport-state.ts';
import type { PreparedWatch } from './watch-transport-transition.ts';

export type CampaignTransitionResult =
  | { readonly kind: 'started' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'completed' }
  | {
      readonly kind: 'failed';
      readonly reason: 'no-streamers' | 'directory-unavailable' | 'open-failed';
      readonly error: string;
      readonly alternativesExhausted?: boolean;
    };

export function cloneCampaignWorkingState(state: ServiceWorkerState): ServiceWorkerState {
  return {
    ...state,
    appState: structuredClone(state.appState),
    cachedDropsSnapshot: structuredClone(state.cachedDropsSnapshot),
    cachedCampaignChannelsMap: structuredClone(state.cachedCampaignChannelsMap),
    dropClaimRetryAtById: new Map(state.dropClaimRetryAtById),
    queueMissingStreak: new Map(state.queueMissingStreak),
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
    const refreshOutcome = await refresh(working, isCurrent);
    if (!isCurrent()) return { kind: 'cancelled' };
    if (refreshOutcome !== 'refreshed')
      return {
        kind: 'failed',
        reason: 'directory-unavailable',
        error:
          refreshOutcome === 'auth-required'
            ? 'Sign in to Twitch to verify this campaign.'
            : 'Unable to verify this campaign right now.',
      };
    const selected = working.appState.selectedGame;
    if (!selected || gameKey(selected) !== gameKey(candidate) || campaignRejectionReason(selected)) {
      return { kind: 'completed' };
    }
    const candidateDrops = working.cachedDropsSnapshot.filter((drop) =>
      dropMatchesSelectedGame(drop, selected),
    );
    if (candidateDrops.length === 0)
      return {
        kind: 'failed',
        reason: 'directory-unavailable',
        error: 'Unable to verify rewards for this campaign right now.',
      };
    if (!candidateDrops.some((drop) => !isRewardAcquired(drop) && isRewardFarmableNow(drop))) {
      return { kind: 'completed' };
    }
    const candidateWatch: { watch: PreparedWatch | null } = { watch: null };
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
          onOpenWatchTransport: async (streamer) => {
            const target = createFarmingTarget(working, streamer);
            if (!target || !isCurrent()) return { kind: 'cancelled' };
            state.streamerAcquisitionPhase = 'playback';
            const result = await prepare(target, isCurrent);
            if (result.kind === 'failed') return { kind: 'failed', health: null };
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
      if (!isCurrent()) return { kind: 'cancelled' };
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
        : { kind: 'cancelled' };
    }
    if (!isCurrent()) {
      await prepared.dispose();
      return { kind: 'cancelled' };
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
      return { kind: 'completed' };
    }
    const key = gameKey(selected);
    const metadata = state.appState.queueEntryMetadataByKey[key];
    const projectedDrop = (): TwitchDrop | null => working.appState.currentDrop;
    const next: ServiceWorkerState = {
      ...state,
      appState: {
        ...state.appState,
        selectedGame: rebasedSelection,
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
        watchFallbackReason: prepared.fallbackReason,
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
        streamerRetryAttempts: _attempts,
        streamerRetryCycles: _cycles,
        streamerWaitState: _wait,
        ...retained
      } = metadata;
      next.appState.queueEntryMetadataByKey[key] = retained;
    }
    if (continuingStall) {
      next.recoveryBackoffUntil =
        context.now() + computeEffectiveStallThreshold(next.appState.currentDrop?.requiredMinutes);
      next.appState.recoveryBackoffUntil = next.recoveryBackoffUntil;
    } else clearRecoveryState(next);
    const liveProjectionBeforeSave = JSON.stringify(state.appState);
    const liveEvidenceBeforeSave = farmingAutomationCompletionFingerprint(state);
    try {
      await adapters.saveState(next, { deferPublicEffects: true, transactionOwner: state });
      if (
        !isCurrent() ||
        JSON.stringify(state.appState) !== liveProjectionBeforeSave ||
        farmingAutomationCompletionFingerprint(state) !== liveEvidenceBeforeSave
      ) {
        await prepared.dispose();
        await adapters.saveState(state);
        return { kind: 'cancelled' };
      }
    } catch {
      await prepared.dispose();
      return { kind: 'failed', reason: 'open-failed', error: 'Unable to save the campaign change.' };
    }
    if (prepared.promote().kind === 'discarded') {
      await prepared.dispose();
      await adapters.saveState(state);
      return { kind: 'cancelled' };
    }
    Object.assign(state, next);
    const rotations = state.noProgressRotationAttempts;
    resetStreamTrackingState(state, continuingStall);
    if (sameCampaign) state.noProgressRotationAttempts = rotations;
    state.lastProgressAdvanceAt = context.now();
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
