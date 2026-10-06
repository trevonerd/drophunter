import { campaignRejectionReason } from '../shared/campaign-eligibility.ts';
import { gameKey } from '../shared/game-selection.ts';
import { isExpiredGame } from '../shared/utils.ts';
import { discoverEligibleStreamers } from './eligible-streamer-discovery.ts';
import type {
  FarmingAutomationEvaluatorDependencies,
  FarmingAutomationRuntime,
} from './farming-automation-evaluator-types.ts';
import { cloneFarmingAutomationGame, farmingAutomationStateFingerprint } from './farming-automation-gates.ts';
import { reconcileFarmingAutomationSnapshot } from './farming-automation-reconciliation.ts';
import {
  FarmingAutomationCampaignRefreshError,
  FarmingAutomationDirectoryRefreshError,
  FarmingAutomationInventoryRefreshError,
  FarmingAutomationRefreshBackoffError,
  FarmingAutomationSessionMissingError,
} from './farming-automation-twitch.ts';
import { logWarn } from './logging.ts';
import { transitionAutomaticFarmingSession } from './session-lifecycle-transition.ts';
import { pickStreamerForPreferences } from './streamer-selection.ts';
import { classifyTwitchApiFailure } from './twitch-api/errors.ts';

type QueuedStartDependencies = Omit<
  FarmingAutomationEvaluatorDependencies,
  'manualWatch' | 'runtime' | 'now' | 'random'
> & {
  readonly now?: () => number;
  readonly random?: () => number;
};

export async function startQueuedCampaign(
  dependencies: QueuedStartDependencies,
  runtime: FarmingAutomationRuntime,
  campaignKey: string,
): Promise<{ readonly success: boolean; readonly error?: string }> {
  const { state, persistence, browser } = dependencies;
  const requestedCampaignIsRunning = () => {
    const selected = state.appState.selectedGame;
    return state.appState.isRunning && selected !== null && gameKey(selected) === campaignKey;
  };
  const queued = state.appState.queue.find((game) => gameKey(game) === campaignKey);
  if (!queued) return { success: false, error: 'Campaign is no longer in the queue.' };
  if (isExpiredGame(queued)) return { success: false, error: 'Campaign has expired.' };
  if (requestedCampaignIsRunning()) return { success: true };
  const revision = runtime.generation;
  // Session acquisition is an expected side effect of this refresh; domain changes still cancel it.
  const fingerprint = () =>
    farmingAutomationStateFingerprint(state, runtime.generation, {
      includeAccountOwnedEvidence: false,
    });
  const initialFingerprint = fingerprint();
  const initialSessionUserId = state.twitchSessionCache?.userId ?? null;
  let expectedSessionUserId = initialSessionUserId;
  let refreshed: Awaited<ReturnType<QueuedStartDependencies['twitch']['refresh']>>;
  try {
    refreshed = await dependencies.twitch.refresh(false, { requireFreshCompleteSnapshot: true });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    if (requestedCampaignIsRunning()) return { success: true };
    if (error instanceof FarmingAutomationRefreshBackoffError) {
      return { success: false, error: 'Twitch is waiting for its scheduled retry.' };
    }
    if (error instanceof FarmingAutomationInventoryRefreshError) {
      return { success: false, error: 'Unable to refresh Twitch inventory right now.' };
    }
    if (error instanceof FarmingAutomationCampaignRefreshError) {
      return { success: false, error: 'Unable to refresh Twitch campaigns right now.' };
    }
    return { success: false, error: 'Unable to refresh Twitch campaigns right now.' };
  }
  if (requestedCampaignIsRunning()) return { success: true };
  if (revision !== runtime.generation || initialFingerprint !== fingerprint()) {
    return { success: false, error: 'Campaign start was superseded by another action.' };
  }
  if (refreshed.kind === 'session-missing') {
    return { success: false, error: 'Unable to refresh your Twitch session. Open Twitch and sign in.' };
  }
  if (initialSessionUserId && refreshed.sessionUserId && initialSessionUserId !== refreshed.sessionUserId) {
    return { success: false, error: 'Campaign start was superseded by another action.' };
  }
  expectedSessionUserId = refreshed.sessionUserId ?? expectedSessionUserId;
  const sessionIsCurrent = () =>
    expectedSessionUserId === null || state.twitchSessionCache?.userId === expectedSessionUserId;
  const currentFingerprint = () =>
    JSON.stringify([fingerprint(), expectedSessionUserId, state.twitchSessionCache?.userId ?? null]);
  if (!sessionIsCurrent()) {
    return { success: false, error: 'Campaign start was superseded by another action.' };
  }
  let snapshot = reconcileFarmingAutomationSnapshot(refreshed.snapshot, state);
  const found = snapshot.games.find((game) => gameKey(cloneFarmingAutomationGame(game)) === campaignKey);
  let candidate = found ? cloneFarmingAutomationGame(found) : null;
  if (
    !candidate ||
    campaignRejectionReason(candidate) !== null ||
    candidate.rewardSummary?.completion !== 'farmable'
  ) {
    return { success: false, error: 'Campaign is no longer available.' };
  }
  let secondaryRefreshError: string | null = null;
  const discovery = await discoverEligibleStreamers({
    game: candidate,
    language: state.appState.preferredStreamerLanguage ?? '',
    isCurrent: () =>
      !requestedCampaignIsRunning() &&
      revision === runtime.generation &&
      initialFingerprint === fingerprint() &&
      sessionIsCurrent(),
    fetchDirectory: async (game, language) => {
      const directory = await dependencies.twitch.fetchDirectory(game, language, {
        sessionRecoveryMode: 'passive',
        preserveSessionOnAuthFailure: true,
      });
      if (directory.kind === 'session-missing') throw new FarmingAutomationSessionMissingError();
      return {
        streamers: [...directory.streamers],
        languageFilterApplied: directory.languageFilterApplied,
      };
    },
    probeChannel: dependencies.twitch.probeStreamInfo ?? (async () => ({ kind: 'unavailable' as const })),
    refresh: async () => {
      let fresh: Awaited<ReturnType<QueuedStartDependencies['twitch']['refresh']>>;
      try {
        fresh = await dependencies.twitch.refresh(false, {
          requireFreshCompleteSnapshot: true,
          allowSessionRecovery: false,
        });
      } catch (error) {
        if (error instanceof FarmingAutomationRefreshBackoffError) {
          secondaryRefreshError = 'Twitch is waiting for its scheduled retry.';
        } else if (error instanceof FarmingAutomationInventoryRefreshError) {
          secondaryRefreshError = 'Unable to refresh Twitch inventory right now.';
        } else if (error instanceof FarmingAutomationCampaignRefreshError) {
          secondaryRefreshError = 'Unable to refresh Twitch campaigns right now.';
        } else {
          secondaryRefreshError = 'Unable to refresh Twitch campaigns right now.';
        }
        return { kind: 'unavailable' as const };
      }
      if (
        fresh.kind !== 'ready' ||
        (expectedSessionUserId && fresh.sessionUserId !== expectedSessionUserId)
      ) {
        return { kind: 'unavailable' as const };
      }
      snapshot = reconcileFarmingAutomationSnapshot(fresh.snapshot, state);
      const refreshedCandidate = snapshot.games.find(
        (game) => gameKey(cloneFarmingAutomationGame(game)) === campaignKey,
      );
      if (
        !refreshedCandidate ||
        campaignRejectionReason(cloneFarmingAutomationGame(refreshedCandidate)) !== null ||
        refreshedCandidate.rewardSummary?.completion !== 'farmable'
      ) {
        return { kind: 'unavailable' as const };
      }
      candidate = cloneFarmingAutomationGame(refreshedCandidate);
      return { kind: 'ready' as const, game: candidate };
    },
  });
  if (requestedCampaignIsRunning()) return { success: true };
  if (discovery.kind === 'cancelled') {
    return { success: false, error: 'Campaign start was superseded by another action.' };
  }
  if (discovery.kind === 'unavailable') {
    const directoryCause =
      discovery.cause instanceof FarmingAutomationDirectoryRefreshError
        ? discovery.cause.cause
        : discovery.cause;
    const failureKind = classifyTwitchApiFailure(directoryCause).kind;
    if (failureKind === 'rate-limit' && state.apiBackoffUntil > Date.now()) {
      return { success: false, error: 'Twitch is waiting for its scheduled retry.' };
    }
    if (failureKind === 'auth' || directoryCause instanceof FarmingAutomationSessionMissingError) {
      return {
        success: false,
        error: 'Unable to refresh your Twitch session. Open Twitch and sign in.',
      };
    }
    if (state.apiBackoffUntil > Date.now()) {
      return { success: false, error: 'Twitch is waiting for its scheduled retry.' };
    }
    return {
      success: false,
      error: secondaryRefreshError ?? 'Unable to check streamers for this campaign right now.',
    };
  }
  candidate = discovery.game;
  const streamers = discovery.kind === 'ready' ? [...discovery.streamers] : [];
  if (discovery.kind === 'empty' || streamers.length === 0) {
    return { success: false, error: 'No eligible streamer is available for this campaign.' };
  }
  const selected = state.appState.selectedGame;
  const fromCampaignKey = state.appState.isRunning && selected ? gameKey(selected) : null;
  const transition = fromCampaignKey
    ? { transition: 'preemption' as const, fromCampaignKey }
    : { transition: 'start' as const, fromCampaignKey: null };
  const result = await transitionAutomaticFarmingSession(
    state,
    {
      attemptId: `manual:${campaignKey}:${crypto.randomUUID()}`,
      ...transition,
      candidate,
      snapshot,
      watchMode: state.appState.watchTransportPreference,
      expectedFingerprint: currentFingerprint(),
      manualOverride: true,
    },
    {
      acquireStreamer: async () =>
        pickStreamerForPreferences(
          [...streamers],
          discovery.preferredLanguageFallbackApplied
            ? { mode: 'random', preferredLanguage: null }
            : {
                mode: state.appState.streamerSelectionMode,
                preferredLanguage: state.appState.preferredStreamerLanguage,
              },
          dependencies.random ?? Math.random,
          discovery.languageFilterApplied,
        ).streamer,
      currentFingerprint,
      loadReceipt: persistence.loadReceipt,
      commitTransition: persistence.commitTransition,
      watch: browser.watch,
      now: dependencies.now,
    },
  );
  if (result.kind === 'unchanged') {
    if (requestedCampaignIsRunning()) return { success: true };
    return { success: false, error: 'Campaign start was superseded by another action.' };
  }
  if (result.kind === 'failed') {
    if (requestedCampaignIsRunning()) return { success: true };
    return { success: false, error: 'Unable to prepare a working stream for this campaign.' };
  }
  if (result.kind === 'replayed') {
    if (requestedCampaignIsRunning()) return { success: true };
    return { success: false, error: 'Campaign start was already handled.' };
  }
  if (result.kind === 'committed' && result.obsolete && result.receipt.cleanup.kind === 'pending') {
    try {
      const released = await browser.watch.release(result.obsolete);
      const now = dependencies.now?.() ?? Date.now();
      const cleanup =
        released.kind === 'released'
          ? { kind: 'released' as const, releasedAt: now, method: released.method }
          : released.kind === 'abandoned-unproven'
            ? { kind: 'abandoned-unproven' as const, acknowledgedAt: now }
            : { kind: 'not-required' as const };
      await persistence.updateReceiptCleanup({ attemptId: result.receipt.attemptId, cleanup });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      logWarn('Queued campaign obsolete watch release failed', { message: error.message });
    }
  }
  dependencies.onStarted?.();
  return { success: true };
}
