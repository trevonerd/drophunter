import { gameKey } from '../shared/game-selection.ts';
import { isExpiredGame } from '../shared/utils.ts';
import type {
  FarmingAutomationEvaluatorDependencies,
  FarmingAutomationRuntime,
} from './farming-automation-evaluator-types.ts';
import {
  cloneFarmingAutomationGame,
  eligibleFarmingAutomationStreamers,
  farmingAutomationStateFingerprint,
} from './farming-automation-gates.ts';
import { reconcileFarmingAutomationSnapshot } from './farming-automation-reconciliation.ts';
import { logWarn } from './logging.ts';
import { transitionAutomaticFarmingSession } from './session-lifecycle-transition.ts';
import { pickStreamerForPreferences } from './streamer-selection.ts';

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
  const fingerprint = () => farmingAutomationStateFingerprint(state, runtime.generation);
  const initialFingerprint = fingerprint();
  let refreshed: Awaited<ReturnType<QueuedStartDependencies['twitch']['refresh']>>;
  try {
    refreshed = await dependencies.twitch.refresh();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    if (requestedCampaignIsRunning()) return { success: true };
    return { success: false, error: 'Unable to refresh Twitch campaigns right now.' };
  }
  if (requestedCampaignIsRunning()) return { success: true };
  if (revision !== runtime.generation || initialFingerprint !== fingerprint()) {
    return { success: false, error: 'Campaign start was superseded by another action.' };
  }
  if (refreshed.kind === 'session-missing') {
    return { success: false, error: 'Unable to refresh Twitch campaigns right now.' };
  }
  const snapshot = reconcileFarmingAutomationSnapshot(refreshed.snapshot, state);
  const found = snapshot.games.find((game) => gameKey(cloneFarmingAutomationGame(game)) === campaignKey);
  const candidate = found ? cloneFarmingAutomationGame(found) : null;
  if (!candidate || isExpiredGame(candidate)) {
    return { success: false, error: 'Campaign is no longer available.' };
  }
  let directory: Awaited<ReturnType<QueuedStartDependencies['twitch']['fetchDirectory']>>;
  try {
    directory = await dependencies.twitch.fetchDirectory(
      candidate,
      state.appState.preferredStreamerLanguage ?? '',
    );
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    if (requestedCampaignIsRunning()) return { success: true };
    return { success: false, error: 'Unable to check streamers for this campaign right now.' };
  }
  if (requestedCampaignIsRunning()) return { success: true };
  if (revision !== runtime.generation || initialFingerprint !== fingerprint()) {
    return { success: false, error: 'Campaign start was superseded by another action.' };
  }
  if (directory.kind === 'session-missing') {
    return { success: false, error: 'Unable to check streamers for this campaign right now.' };
  }
  const streamers = eligibleFarmingAutomationStreamers(candidate, directory);
  if (streamers.length === 0) {
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
      expectedFingerprint: initialFingerprint,
      manualOverride: true,
    },
    {
      acquireStreamer: async () =>
        pickStreamerForPreferences(
          [...streamers],
          {
            mode: state.appState.streamerSelectionMode,
            preferredLanguage: state.appState.preferredStreamerLanguage,
          },
          dependencies.random ?? Math.random,
          directory.languageFilterApplied,
        ).streamer,
      currentFingerprint: fingerprint,
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
