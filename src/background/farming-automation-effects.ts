import { gameKey } from '../shared/game-selection.ts';
import type { TwitchGame } from '../types/index.ts';
import { recordAutomationActivity } from './automation-activity.ts';
import type { FarmingAutomationBrowser } from './farming-automation-browser.ts';
import type {
  FarmingAutomationFactsV1,
  FarmingAutomationOutcome,
  FarmingAutomationPersistence,
  FarmingSessionTransitionReceiptV1,
  WatchCleanupV1,
  WatchOwnershipV1,
} from './farming-automation-contracts.ts';
import { clampFarmingAutomationWake } from './farming-automation-gates.ts';
import type { FavoriteCampaignQueuePlan } from './favorite-games.ts';
import { logWarn } from './logging.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

interface PersistFarmingAutomationPlanInput {
  readonly state: ServiceWorkerState;
  readonly persistence: FarmingAutomationPersistence;
  readonly queuePlan: FavoriteCampaignQueuePlan | null;
  readonly availability: ServiceWorkerState['appState']['campaignAvailabilityByKey'];
  readonly now: number;
}

function queueActivityId(game: TwitchGame, addedAt: number): string {
  return `favorite-added:${gameKey(game)}:${addedAt}`;
}

function transitionActivityId(receipt: FarmingSessionTransitionReceiptV1): string {
  return `farming-transition:${receipt.attemptId}`;
}

function recordQueueActivities(
  state: ServiceWorkerState,
  plan: FavoriteCampaignQueuePlan,
  now: number,
): void {
  const existing = new Set(state.appState.automationActivity.map(({ id }) => id));
  for (const addition of plan.added) {
    const addedAt = plan.queueEntryMetadataByKey[gameKey(addition.game)]?.addedAt ?? now;
    const id = queueActivityId(addition.game, addedAt);
    if (existing.has(id)) continue;
    recordAutomationActivity(state.appState, {
      id,
      kind: 'favorite-added',
      at: addedAt,
      campaignId: addition.game.campaignId,
      message: `${addition.game.name} was added because a favorite campaign is available.`,
    });
    existing.add(id);
  }
}

export async function persistFarmingAutomationPlan(
  input: PersistFarmingAutomationPlanInput,
): Promise<boolean> {
  const { state, persistence, queuePlan, availability, now } = input;
  const previousActivity = structuredClone(state.appState.automationActivity);
  const previousMessage = state.appState.lastAutomationMessage;
  if (queuePlan) recordQueueActivities(state, queuePlan, now);
  let result: Awaited<ReturnType<FarmingAutomationPersistence['savePolicyPatch']>>;
  try {
    result = await persistence.savePolicyPatch({
      queue: queuePlan?.queue ?? state.appState.queue,
      queueEntryMetadataByKey: queuePlan?.queueEntryMetadataByKey ?? state.appState.queueEntryMetadataByKey,
      campaignAvailabilityByKey: availability,
    });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    result = { kind: 'failed', reason: 'storage-unavailable' };
  }
  if (result.kind === 'written') return true;
  state.appState.automationActivity = previousActivity;
  state.appState.lastAutomationMessage = previousMessage;
  return false;
}

export async function persistFarmingAutomationFacts(
  persistence: FarmingAutomationPersistence,
  browser: Pick<FarmingAutomationBrowser, 'replaceDeadlineAlarm'>,
  facts: FarmingAutomationFactsV1,
  now: number,
): Promise<boolean> {
  if (!(await saveFarmingAutomationFacts(persistence, facts))) return false;
  try {
    const scheduled = await browser.replaceDeadlineAlarm(
      clampFarmingAutomationWake(now, facts.nextEvaluationAt ?? now),
    );
    if (scheduled === 'failed') logWarn('Farming automation deadline replacement failed');
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    logWarn('Farming automation deadline replacement failed', { message: error.message });
  }
  return true;
}

async function saveFarmingAutomationFacts(
  persistence: FarmingAutomationPersistence,
  facts: FarmingAutomationFactsV1,
): Promise<boolean> {
  let result: Awaited<ReturnType<FarmingAutomationPersistence['saveFacts']>>;
  try {
    result = await persistence.saveFacts(facts);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return false;
  }
  return result.kind === 'written';
}

export async function persistFarmingAutomationRetry(
  persistence: FarmingAutomationPersistence,
  browser: Pick<FarmingAutomationBrowser, 'replaceDeadlineAlarm'>,
  facts: FarmingAutomationFactsV1,
  reason: Extract<FarmingAutomationOutcome, { readonly kind: 'failed' }>['reason'],
  now: number,
): Promise<FarmingAutomationOutcome> {
  const retryAt = Math.min(now + 2 * 60_000, facts.manualWatch?.recheckAt ?? Number.POSITIVE_INFINITY);
  const saved = await persistFarmingAutomationFacts(
    persistence,
    browser,
    { ...facts, nextEvaluationAt: retryAt },
    now,
  );
  return saved ? { kind: 'failed', reason, retryAt } : { kind: 'failed', reason: 'persistence-failed' };
}

export function createFarmingAutomationCompletedFacts(
  facts: FarmingAutomationFactsV1,
  receipt: FarmingSessionTransitionReceiptV1,
  nextEvaluationAt: number,
): FarmingAutomationFactsV1 {
  switch (receipt.transition) {
    case 'start':
      return { ...facts, nextEvaluationAt };
    case 'preemption': {
      const fromCampaignKey = receipt.fromCampaignKey;
      if (fromCampaignKey === null) {
        throw new DOMException('Preemption receipt has no incumbent campaign', 'InvariantError');
      }
      return {
        ...facts,
        lastPreemption: {
          attemptId: receipt.attemptId,
          fromCampaignKey,
          toCampaignKey: receipt.toCampaignKey,
          committedAt: receipt.committedAt,
          sessionRevision: receipt.sessionRevision,
        },
        nextEvaluationAt,
      };
    }
  }
}

function recordTransitionActivity(
  state: ServiceWorkerState,
  receipt: FarmingSessionTransitionReceiptV1,
): boolean {
  const id = transitionActivityId(receipt);
  if (state.appState.automationActivity.some((entry) => entry.id === id)) return false;
  const game = state.appState.selectedGame;
  recordAutomationActivity(state.appState, {
    id,
    kind: receipt.transition === 'preemption' ? 'preempted' : 'auto-started',
    at: receipt.committedAt,
    campaignId: game?.campaignId,
    message: game ? `${game.name} started automatically.` : 'Farming started automatically.',
  });
  return true;
}

function cleanupForRelease(
  result: Awaited<ReturnType<FarmingAutomationBrowser['watch']['release']>>,
  now: number,
): WatchCleanupV1 {
  switch (result.kind) {
    case 'not-required':
      return { kind: 'not-required' };
    case 'released':
      return { kind: 'released', releasedAt: now, method: result.method };
    case 'abandoned-unproven':
      return { kind: 'abandoned-unproven', acknowledgedAt: now };
  }
}

type StartedEffectsInput = {
  readonly state: ServiceWorkerState;
  readonly persistence: FarmingAutomationPersistence;
  readonly browser: FarmingAutomationBrowser;
  readonly facts: FarmingAutomationFactsV1;
  readonly receipt: FarmingSessionTransitionReceiptV1;
  readonly obsolete: WatchOwnershipV1 | null;
  readonly now: number;
};

export async function runFarmingAutomationStartedEffects(input: StartedEffectsInput): Promise<void> {
  const activityAdded = recordTransitionActivity(input.state, input.receipt);
  const saved = await saveFarmingAutomationFacts(input.persistence, input.facts);
  if (!saved) logWarn('Farming automation activity presentation failed');

  if (activityAdded && input.state.appState.notificationsEnabled) {
    try {
      const delivered = await input.browser.deliverNotification({
        id: transitionActivityId(input.receipt),
        title: input.receipt.transition === 'preemption' ? 'Campaign priority changed' : 'Farming started',
        message: input.state.appState.lastAutomationMessage ?? 'Farming started automatically.',
        priority: 2,
      });
      if (delivered.kind === 'unavailable') logWarn('Farming automation notification unavailable');
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      logWarn('Farming automation notification failed', { message: error.message });
    }
  }

  if (input.obsolete !== null && input.receipt.cleanup.kind === 'pending') {
    try {
      const cleanup = cleanupForRelease(await input.browser.watch.release(input.obsolete), input.now);
      const updated = await input.persistence.updateReceiptCleanup({
        attemptId: input.receipt.attemptId,
        cleanup,
      });
      if (updated.kind !== 'written') logWarn('Farming automation cleanup acknowledgement failed');
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      logWarn('Farming automation obsolete watch release failed', { message: error.message });
    }
  }

  try {
    const scheduled = await input.browser.replaceDeadlineAlarm(
      clampFarmingAutomationWake(input.now, input.facts.nextEvaluationAt ?? input.now),
    );
    if (scheduled === 'failed') logWarn('Farming automation deadline replacement failed');
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    logWarn('Farming automation deadline replacement failed', { message: error.message });
  }
}
