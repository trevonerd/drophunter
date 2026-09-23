import { gameKey } from '../shared/game-selection.ts';
import { rememberAcquiredCampaigns } from './campaign-completion-evidence.ts';
import { decideFarmingAutomationTransition } from './farming-automation-candidates.ts';
import type {
  FarmingAutomationFailureReason,
  FarmingAutomationOutcome,
  FarmingAutomationTrigger,
} from './farming-automation-contracts.ts';
import { discoverFarmingAutomationCandidates } from './farming-automation-discovery.ts';
import {
  createFarmingAutomationCompletedFacts,
  persistFarmingAutomationFacts,
  persistFarmingAutomationPlan,
  persistFarmingAutomationRetry,
  runFarmingAutomationStartedEffects,
} from './farming-automation-effects.ts';
import { shouldRefreshAvailabilityOnly } from './farming-automation-evaluator-gates.ts';
import {
  cheapFarmingAutomationGate,
  cloneFarmingAutomationGame,
  createFarmingAutomationTransitionRequest,
  deriveFarmingAutomationDeadline,
  expireFarmingAutomationManualWatch,
  factsWithFarmingAutomationManualWatch,
  farmingAutomationFingerprint,
  farmingAutomationStateFingerprint,
} from './farming-automation-gates.ts';
import { reconcileParkedCampaigns } from './farming-automation-parked-campaigns.ts';
import {
  buildFarmingAutomationQueuePlan,
  resumeQueuedCampaignsWithAvailableStreamers,
} from './farming-automation-queue-planning.ts';
import { transitionAutomaticFarmingSession } from './session-lifecycle-transition.ts';
import { pickStreamerForPreferences } from './streamer-selection.ts';

export type {
  FarmingAutomationEvaluatorDependencies,
  FarmingAutomationRuntime,
} from './farming-automation-evaluator-types.ts';

import type { FarmingAutomationEvaluatorDependencies } from './farming-automation-evaluator-types.ts';

export function createFarmingAutomationEvaluator(
  dependencies: FarmingAutomationEvaluatorDependencies,
): (triggers: ReadonlySet<FarmingAutomationTrigger>) => Promise<FarmingAutomationOutcome> {
  return async (triggers) => {
    const recovered = await dependencies.recover?.();
    if (recovered) return recovered;
    const loadedFacts = await dependencies.persistence.loadFacts();
    if (loadedFacts.kind === 'failed') return { kind: 'failed', reason: 'persistence-failed' };
    let facts = loadedFacts.value;
    const now = dependencies.now();
    const currentStateFingerprint = () =>
      farmingAutomationStateFingerprint(dependencies.state, dependencies.runtime.generation);
    const retry = (reason: FarmingAutomationFailureReason): Promise<FarmingAutomationOutcome> =>
      persistFarmingAutomationRetry(dependencies.persistence, dependencies.browser, facts, reason, now);
    const saveFacts = () =>
      persistFarmingAutomationFacts(dependencies.persistence, dependencies.browser, facts, now);
    if (triggers.has('browser-start')) {
      const cleared = await dependencies.persistence.clearSnooze();
      if (cleared.kind === 'failed') return { kind: 'failed', reason: 'persistence-failed' };
      dependencies.runtime.snoozed = false;
      dependencies.runtime.generation += 1;
    } else {
      const snooze = await dependencies.persistence.loadSnooze();
      if (snooze.kind === 'failed') return { kind: 'failed', reason: 'persistence-failed' };
      dependencies.runtime.snoozed = dependencies.runtime.snoozed || snooze.value;
    }
    const expiredFacts = expireFarmingAutomationManualWatch(facts, now);
    if (expiredFacts !== facts) {
      facts = expiredFacts;
      if (!(await saveFacts())) return { kind: 'failed', reason: 'persistence-failed' };
    }
    const cheapGate = cheapFarmingAutomationGate(
      dependencies.state,
      dependencies.runtime.snoozed,
      facts.suppressedCampaignKeys.length > 0,
    );
    const refreshAvailabilityOnly = shouldRefreshAvailabilityOnly(
      cheapGate,
      triggers,
      dependencies.state.appState.campaignPriorityMode,
    );
    if (cheapGate && !refreshAvailabilityOnly) return cheapGate;
    const beforeRefresh = currentStateFingerprint();
    const discovery = await discoverFarmingAutomationCandidates(
      dependencies.twitch,
      dependencies.state.appState.preferredStreamerLanguage ?? '',
      now,
      dependencies.state,
    );
    if (discovery.kind === 'failed') return retry(discovery.reason);
    if (currentStateFingerprint() !== beforeRefresh) {
      return { kind: 'unchanged', reason: 'superseded-by-state-change' };
    }
    rememberAcquiredCampaigns(
      dependencies.state.appState,
      discovery.snapshot.games.map(cloneFarmingAutomationGame),
    );
    if (refreshAvailabilityOnly) {
      const persisted = await persistFarmingAutomationPlan({
        state: dependencies.state,
        persistence: dependencies.persistence,
        queuePlan: null,
        availability: discovery.availability,
        now,
        automationNotify: dependencies.automationNotify,
      });
      return persisted
        ? { kind: 'unchanged', reason: 'disabled' }
        : { kind: 'failed', reason: 'persistence-failed' };
    }

    resumeQueuedCampaignsWithAvailableStreamers(dependencies.state, discovery);

    const parked = reconcileParkedCampaigns(facts, discovery.availability, now);
    if (parked.changed) {
      facts = parked.facts;
      if (!(await saveFacts())) return { kind: 'failed', reason: 'persistence-failed' };
    }
    const { plan, queuePlan, availabilityRetryAt, needsAvailabilityRetry } = buildFarmingAutomationQueuePlan(
      dependencies.state,
      discovery,
      parked.parkedKeys,
      now,
    );
    if (
      !(await persistFarmingAutomationPlan({
        state: dependencies.state,
        persistence: dependencies.persistence,
        queuePlan,
        availability: discovery.availability,
        now,
        automationNotify: dependencies.automationNotify,
      }))
    ) {
      return { kind: 'failed', reason: 'persistence-failed' };
    }
    if (needsAvailabilityRetry) {
      facts = {
        ...facts,
        nextEvaluationAt: Math.min(facts.nextEvaluationAt ?? Number.POSITIVE_INFINITY, availabilityRetryAt),
      };
    }
    const beforeObservation = currentStateFingerprint();
    let observed: Awaited<ReturnType<typeof dependencies.manualWatch.evaluate>>;
    try {
      observed = await dependencies.manualWatch.evaluate({
        target: plan.rankedCandidates[0]?.game ?? null,
        managedTabId: dependencies.state.appState.tabId,
        automationActive: true,
      });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return retry('candidate-preparation-failed');
    }
    if (currentStateFingerprint() !== beforeObservation) {
      return { kind: 'unchanged', reason: 'superseded-by-state-change' };
    }
    if (observed.kind === 'failed') return retry(observed.reason);
    facts = factsWithFarmingAutomationManualWatch(
      facts,
      observed.kind === 'active' ? observed.watch : null,
      now,
    );
    const parkedRetryAt = Math.min(
      ...Object.values(dependencies.state.appState.queueEntryMetadataByKey).flatMap((entry) =>
        entry.streamerRetryAt !== undefined && entry.streamerRetryAt > now ? [entry.streamerRetryAt] : [],
      ),
      needsAvailabilityRetry ? availabilityRetryAt : Number.POSITIVE_INFINITY,
    );
    facts = { ...facts, nextEvaluationAt: Math.min(facts.nextEvaluationAt ?? Infinity, parkedRetryAt) };
    if (observed.kind === 'active') {
      if (!(await saveFacts())) return { kind: 'failed', reason: 'persistence-failed' };
      return { kind: 'unchanged', reason: 'manual-watch-active' };
    }

    if (
      dependencies.state.appState.isRunning &&
      dependencies.state.appState.selectedGame &&
      dependencies.state.appState.forcedCampaignKey === gameKey(dependencies.state.appState.selectedGame)
    ) {
      if (!(await saveFacts())) return { kind: 'failed', reason: 'persistence-failed' };
      return { kind: 'unchanged', reason: 'already-farming-best-campaign' };
    }
    const decision = decideFarmingAutomationTransition({
      isRunning: dependencies.state.appState.isRunning && !dependencies.state.appState.isPaused,
      selectedGame: dependencies.state.appState.selectedGame,
      lastPreemption: facts.lastPreemption,
      rankedCandidates: plan.rankedCandidates,
    });
    if (decision.kind === 'unchanged') {
      if (!(await saveFacts())) return { kind: 'failed', reason: 'persistence-failed' };
      return {
        kind: 'unchanged',
        reason:
          decision.reason === 'no-campaign'
            ? 'no-eligible-campaign'
            : decision.reason === 'preemption-already-applied'
              ? 'preemption-already-applied'
              : 'already-farming-best-campaign',
      };
    }
    const expectedFingerprint = farmingAutomationFingerprint(
      dependencies.state,
      facts,
      dependencies.runtime.generation,
    );
    const transitionRequest = createFarmingAutomationTransitionRequest(
      decision,
      discovery.snapshot,
      dependencies.state.appState.watchTransportPreference,
      expectedFingerprint,
    );
    const result = await transitionAutomaticFarmingSession(dependencies.state, transitionRequest, {
      acquireStreamer: async (campaign) => {
        const directory = discovery.directories.get(gameKey(campaign));
        if (!directory) return null;
        return pickStreamerForPreferences(
          [...directory.streamers],
          {
            mode: dependencies.state.appState.streamerSelectionMode,
            preferredLanguage: dependencies.state.appState.preferredStreamerLanguage,
          },
          dependencies.random,
          directory.languageFilterApplied,
        ).streamer;
      },
      currentFingerprint: () =>
        farmingAutomationFingerprint(dependencies.state, facts, dependencies.runtime.generation),
      loadReceipt: dependencies.persistence.loadReceipt,
      commitTransition: dependencies.persistence.commitTransition,
      watch: dependencies.browser.watch,
      now: dependencies.now,
    });
    if (result.kind === 'unchanged') return result;
    if (result.kind === 'failed') return retry(result.reason);
    const receipt = result.receipt;
    const completedFacts = createFarmingAutomationCompletedFacts(
      facts,
      receipt,
      deriveFarmingAutomationDeadline(now, facts),
    );
    await runFarmingAutomationStartedEffects({
      state: dependencies.state,
      persistence: dependencies.persistence,
      browser: dependencies.browser,
      facts: completedFacts,
      receipt,
      obsolete: result.kind === 'committed' ? result.obsolete : null,
      now,
      automationNotify: dependencies.automationNotify,
    });
    // A preemption also leaves a running farming session behind. Re-arm progress
    // monitoring in case an extension update or recovery cleared its alarm.
    dependencies.onStarted?.();
    return { kind: 'started', campaignKey: receipt.toCampaignKey, transition: receipt.transition };
  };
}
