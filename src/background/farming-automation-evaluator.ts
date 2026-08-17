import { gameKey } from '../shared/game-selection.ts';
import type { CampaignAvailability } from '../types/index.ts';
import type { FarmingAutomationBrowser } from './farming-automation-browser.ts';
import {
  decideFarmingAutomationTransition,
  planFarmingAutomationPolicy,
} from './farming-automation-candidates.ts';
import type {
  FarmingAutomationFailureReason,
  FarmingAutomationOutcome,
  FarmingAutomationPersistence,
  FarmingAutomationTrigger,
} from './farming-automation-contracts.ts';
import {
  createFarmingAutomationCompletedFacts,
  persistFarmingAutomationFacts,
  persistFarmingAutomationQueuePlan,
  persistFarmingAutomationRetry,
  runFarmingAutomationStartedEffects,
} from './farming-automation-effects.ts';
import {
  cheapFarmingAutomationGate,
  cloneFarmingAutomationGame,
  createFarmingAutomationPolicySnapshot,
  createFarmingAutomationTransitionRequest,
  deriveFarmingAutomationDeadline,
  eligibleFarmingAutomationStreamers,
  expireFarmingAutomationManualWatch,
  type FarmingAutomationDirectoryCacheEntry,
  factsWithFarmingAutomationManualWatch,
  farmingAutomationFingerprint,
  farmingAutomationStateFingerprint,
} from './farming-automation-gates.ts';
import { createFarmingAutomationManualWatch } from './farming-automation-manual-watch.ts';
import type { FarmingAutomationTwitchAdapter } from './farming-automation-twitch.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { transitionAutomaticFarmingSession } from './session-lifecycle-transition.ts';
import { pickStreamerForPreferences } from './streamer-selection.ts';

export type FarmingAutomationRuntime = { generation: number; snoozed: boolean };

export type FarmingAutomationEvaluatorDependencies = {
  readonly state: ServiceWorkerState;
  readonly persistence: FarmingAutomationPersistence;
  readonly browser: FarmingAutomationBrowser;
  readonly twitch: FarmingAutomationTwitchAdapter;
  readonly runtime: FarmingAutomationRuntime;
  readonly recover?: () => Promise<FarmingAutomationOutcome | null>;
  readonly now: () => number;
  readonly random: () => number;
  readonly onStarted?: () => void;
};

export function createFarmingAutomationEvaluator(
  dependencies: FarmingAutomationEvaluatorDependencies,
): (triggers: ReadonlySet<FarmingAutomationTrigger>) => Promise<FarmingAutomationOutcome> {
  const manualWatch = createFarmingAutomationManualWatch({
    persistence: dependencies.persistence,
    observeManualTabs: dependencies.browser.observeManualTabs,
    replaceDeadline: dependencies.browser.replaceDeadlineAlarm,
    now: dependencies.now,
  });

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
    const cheapGate = cheapFarmingAutomationGate(dependencies.state, dependencies.runtime.snoozed);
    if (cheapGate) return cheapGate;
    try {
      if (!(await dependencies.browser.hasNotificationPermission())) {
        return { kind: 'failed', reason: 'notifications-unavailable' };
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return { kind: 'failed', reason: 'notifications-unavailable' };
    }

    const beforeRefresh = currentStateFingerprint();
    let refreshed: Awaited<ReturnType<FarmingAutomationTwitchAdapter['refresh']>>;
    try {
      refreshed = await dependencies.twitch.refresh();
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return retry('drops-refresh-failed');
    }
    if (refreshed.kind === 'session-missing') {
      return retry('twitch-session-missing');
    }
    const directories = new Map<string, FarmingAutomationDirectoryCacheEntry>();
    const availability: Record<string, CampaignAvailability> = {};
    try {
      for (const normalized of refreshed.snapshot.games) {
        const game = cloneFarmingAutomationGame(normalized);
        const directory = await dependencies.twitch.fetchDirectory(
          game,
          dependencies.state.appState.preferredStreamerLanguage ?? '',
        );
        if (directory.kind === 'session-missing') {
          return retry('twitch-session-missing');
        }
        const streamers = eligibleFarmingAutomationStreamers(game, directory);
        directories.set(gameKey(game), {
          streamers,
          languageFilterApplied: directory.languageFilterApplied,
        });
        availability[gameKey(game)] = { eligibleStreamerCount: streamers.length, updatedAt: now };
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return retry('drops-refresh-failed');
    }
    if (currentStateFingerprint() !== beforeRefresh) {
      return { kind: 'unchanged', reason: 'superseded-by-state-change' };
    }

    const plan = planFarmingAutomationPolicy(
      createFarmingAutomationPolicySnapshot(dependencies.state, refreshed.snapshot, availability),
      now,
    );
    if (
      !(await persistFarmingAutomationQueuePlan(
        dependencies.state,
        dependencies.persistence,
        plan.queue,
        now,
      ))
    ) {
      return { kind: 'failed', reason: 'persistence-failed' };
    }
    const beforeObservation = currentStateFingerprint();
    let observed: Awaited<ReturnType<typeof manualWatch.evaluate>>;
    try {
      observed = await manualWatch.evaluate({
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
    if (observed.kind === 'active') {
      if (!(await saveFacts())) return { kind: 'failed', reason: 'persistence-failed' };
      return { kind: 'unchanged', reason: 'manual-watch-active' };
    }

    const decision = decideFarmingAutomationTransition({
      isRunning: dependencies.state.appState.isRunning,
      currentCampaign: dependencies.state.appState.selectedGame,
      rankedCandidates: plan.rankedCandidates,
    });
    if (decision.kind === 'unchanged') {
      if (!(await saveFacts())) return { kind: 'failed', reason: 'persistence-failed' };
      return {
        kind: 'unchanged',
        reason: decision.reason === 'no-campaign' ? 'no-eligible-campaign' : 'already-farming-best-campaign',
      };
    }
    const expectedFingerprint = farmingAutomationFingerprint(
      dependencies.state,
      facts,
      dependencies.runtime.generation,
    );
    if (decision.kind === 'preempt') {
      const fromCampaignKey = gameKey(decision.currentCampaign);
      const toCampaignKey = gameKey(decision.campaign);
      if (
        facts.lastPreemption?.fromCampaignKey === fromCampaignKey &&
        facts.lastPreemption.toCampaignKey === toCampaignKey
      ) {
        return { kind: 'unchanged', reason: 'preemption-already-applied' };
      }
    }
    const transitionRequest = createFarmingAutomationTransitionRequest(
      decision,
      refreshed.snapshot,
      dependencies.state.appState.watchTransportPreference,
      expectedFingerprint,
    );
    const result = await transitionAutomaticFarmingSession(dependencies.state, transitionRequest, {
      acquireStreamer: async (campaign) => {
        const directory = directories.get(gameKey(campaign));
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
    });
    if (receipt.transition === 'start') dependencies.onStarted?.();
    return { kind: 'started', campaignKey: receipt.toCampaignKey, transition: receipt.transition };
  };
}
