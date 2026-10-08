import { gameKey } from '../shared/game-selection.ts';
import { recordCampaignFailure } from './campaign-failure-episodes.ts';
import type { FarmingAutomationDiscoveryResult } from './farming-automation-discovery.ts';
import type { FarmingAutomationEvaluatorDependencies } from './farming-automation-evaluator.ts';
import { reconcileFarmingSessionTargets } from './farming-session-targets.ts';
import { parkCampaignForStreamerRetry } from './session-lifecycle-queue-parking.ts';
import {
  type AutomaticFarmingSessionTransitionRequest,
  type AutomaticFarmingSessionTransitionResult,
  transitionAutomaticFarmingSession,
} from './session-lifecycle-transition.ts';
import { pickStreamerForPreferences } from './streamer-selection.ts';
import { MAX_STREAMER_ATTEMPTS, streamerCandidatesForWatchAttempt } from './streamer-watch-attempt.ts';

type ReadyDiscovery = Extract<FarmingAutomationDiscoveryResult, { kind: 'ready' }>;

export function transitionDiscoveredCampaign(
  dependencies: FarmingAutomationEvaluatorDependencies,
  discovery: ReadyDiscovery,
  request: AutomaticFarmingSessionTransitionRequest,
  currentFingerprint: () => string,
): Promise<AutomaticFarmingSessionTransitionResult> {
  return transitionAutomaticFarmingSession(dependencies.state, request, {
    acquireStreamer: async (campaign) => {
      const directory = discovery.directories.get(gameKey(campaign));
      if (!directory) return null;
      return pickStreamerForPreferences(
        streamerCandidatesForWatchAttempt(
          directory.streamers,
          dependencies.state.appState.queueEntryMetadataByKey[gameKey(campaign)],
        ),
        directory.preferredLanguageFallbackApplied
          ? { mode: 'random', preferredLanguage: null }
          : {
              mode: dependencies.state.appState.streamerSelectionMode,
              preferredLanguage: dependencies.state.appState.preferredStreamerLanguage,
            },
        dependencies.random,
        directory.languageFilterApplied,
      ).streamer;
    },
    currentFingerprint,
    persistAttempt: async () =>
      (
        await dependencies.persistence.savePolicyPatch({
          queue: dependencies.state.appState.queue,
          queueEntryMetadataByKey: dependencies.state.appState.queueEntryMetadataByKey,
          campaignAvailabilityByKey: dependencies.state.appState.campaignAvailabilityByKey,
        })
      ).kind === 'written',
    loadReceipt: dependencies.persistence.loadReceipt,
    commitTransition: dependencies.persistence.commitTransition,
    watch: dependencies.browser.watch,
    now: dependencies.now,
  });
}

export async function persistFailedFarmingTransition(
  dependencies: FarmingAutomationEvaluatorDependencies,
  discovery: ReadyDiscovery,
  request: AutomaticFarmingSessionTransitionRequest,
  result: Extract<AutomaticFarmingSessionTransitionResult, { kind: 'failed' }>,
  now: number,
): Promise<boolean> {
  const candidate = request.candidate;
  if (result.reason === 'candidate-playback-pending') return true;
  const attempted =
    dependencies.state.appState.queueEntryMetadataByKey[gameKey(candidate)]?.attemptedStreamerNames ?? [];
  const directory = discovery.directories.get(gameKey(candidate));
  const alternatives = directory?.streamers.some(
    (streamer) => !attempted.includes(streamer.name.trim().toLowerCase()),
  );
  if (
    result.reason === 'candidate-preparation-failed' &&
    attempted.length > 0 &&
    (attempted.length >= MAX_STREAMER_ATTEMPTS || alternatives === false)
  ) {
    const app = dependencies.state.appState;
    const notification = recordCampaignFailure(dependencies.state, candidate, 'open-failed', now);
    parkCampaignForStreamerRetry(dependencies.state, candidate, 'open-failed', false, now);
    if (!app.isRunning) {
      app.isRunning = true;
      app.farmingSessionOrigin = 'automatic';
      app.selectedGame = candidate;
    }
    reconcileFarmingSessionTargets(dependencies.state);
    const saved = await dependencies.persistence.savePolicyPatch({
      queue: app.queue,
      queueEntryMetadataByKey: app.queueEntryMetadataByKey,
      campaignAvailabilityByKey: app.campaignAvailabilityByKey,
    });
    if (saved.kind === 'failed') return false;
    if (notification)
      void Promise.resolve()
        .then(() => dependencies.automationNotify?.notify(notification))
        .catch(() => undefined);
    dependencies.onStarted?.();
  }
  return true;
}
