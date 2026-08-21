import { favoriteGameIdentityKeys, gameKey, hiddenGameIdentityKeys } from '../shared/game-selection.ts';
import type { TwitchDrop, TwitchGame, TwitchStreamer, WatchTransportMode } from '../types/index.ts';
import type {
  FarmingAutomationPolicySnapshot,
  FarmingAutomationTransitionDecision,
} from './farming-automation-candidates.ts';
import type { FarmingAutomationFactsV1, FarmingAutomationOutcome } from './farming-automation-contracts.ts';
import type {
  FarmingAutomationDirectoryResult,
  FarmingAutomationNormalizedDrop,
  FarmingAutomationNormalizedGame,
  FarmingAutomationTwitchSnapshot,
} from './farming-automation-twitch.ts';
import { currentFarmingSessionEpoch } from './farming-session-revision.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import type { AutomaticFarmingSessionTransitionRequest } from './session-lifecycle-transition.ts';

export const FARMING_AUTOMATION_INTERVAL_MS = 2 * 60_000;
export const FARMING_AUTOMATION_MIN_WAKE_MS = 30_000;

export type FarmingAutomationDirectoryCacheEntry = {
  readonly streamers: readonly TwitchStreamer[];
  readonly languageFilterApplied: boolean;
};

function cloneGame(game: FarmingAutomationNormalizedGame): TwitchGame {
  return {
    ...game,
    allowedChannels: game.allowedChannels == null ? game.allowedChannels : [...game.allowedChannels],
  };
}

function cloneDrop(drop: FarmingAutomationNormalizedDrop): TwitchDrop {
  return {
    ...drop,
    benefitIds: drop.benefitIds ? [...drop.benefitIds] : drop.benefitIds,
    rewardDistributionTypes: drop.rewardDistributionTypes
      ? [...drop.rewardDistributionTypes]
      : drop.rewardDistributionTypes,
  };
}

export function cloneFarmingAutomationGame(game: FarmingAutomationNormalizedGame): TwitchGame {
  return cloneGame(game);
}

export function eligibleFarmingAutomationStreamers(
  game: TwitchGame,
  directory: Extract<FarmingAutomationDirectoryResult, { readonly kind: 'ready' }>,
): readonly TwitchStreamer[] {
  const allowed = game.allowedChannels?.map((channel) => channel.toLowerCase()) ?? null;
  return directory.streamers.filter(
    (streamer) =>
      streamer.isLive &&
      (allowed === null || allowed.length === 0 || allowed.includes(streamer.name.toLowerCase())),
  );
}

export function farmingAutomationAttemptId(
  transition: 'start' | 'preemption',
  fromCampaignKey: string | null,
  toCampaignKey: string,
  snapshot: FarmingAutomationTwitchSnapshot,
): string {
  return `${transition}:${fromCampaignKey ?? 'idle'}:${toCampaignKey}:${snapshot.updatedAt}`;
}

export function createFarmingAutomationTransitionRequest(
  decision: Exclude<FarmingAutomationTransitionDecision, { readonly kind: 'unchanged' }>,
  snapshot: FarmingAutomationTwitchSnapshot,
  watchMode: WatchTransportMode,
  expectedFingerprint: string,
): AutomaticFarmingSessionTransitionRequest {
  const toCampaignKey = gameKey(decision.campaign);
  return {
    attemptId: farmingAutomationAttemptId('start', null, toCampaignKey, snapshot),
    transition: 'start',
    fromCampaignKey: null,
    candidate: decision.campaign,
    snapshot,
    watchMode,
    expectedFingerprint,
  };
}

export function factsWithFarmingAutomationManualWatch(
  facts: FarmingAutomationFactsV1,
  manualWatch: FarmingAutomationFactsV1['manualWatch'],
  now: number,
): FarmingAutomationFactsV1 {
  const next = { ...facts, manualWatch };
  return { ...next, nextEvaluationAt: deriveFarmingAutomationDeadline(now, next) };
}

export function createFarmingAutomationPolicySnapshot(
  state: ServiceWorkerState,
  snapshot: FarmingAutomationTwitchSnapshot,
  availability: Readonly<
    Record<string, { readonly eligibleStreamerCount: number; readonly updatedAt: number }>
  >,
): FarmingAutomationPolicySnapshot {
  return {
    availableGames: snapshot.games.map(cloneGame),
    favoriteGames: structuredClone(state.appState.favoriteGames),
    hiddenGames: structuredClone(state.appState.hiddenGames),
    queue: structuredClone(state.appState.queue),
    queueEntryMetadataByKey: structuredClone(state.appState.queueEntryMetadataByKey),
    campaignPriorityMode: state.appState.campaignPriorityMode,
    farmCategoryScope: state.appState.farmCategoryScope,
    campaignAvailabilityByKey: availability,
    campaignDropsByKey: Object.fromEntries(
      Object.entries(snapshot.campaignDropsByKey).map(([key, drops]) => [key, drops.map(cloneDrop)]),
    ),
    allDrops: snapshot.drops.map(cloneDrop),
  };
}

export function farmingAutomationStateFingerprint(state: ServiceWorkerState, generation: number): string {
  const app = state.appState;
  return JSON.stringify({
    generation,
    sessionEpoch: currentFarmingSessionEpoch(state),
    enabled: app.autoStartFavoriteGames,
    notifications: app.notificationsEnabled,
    sessionPresent: state.twitchSessionCache !== null,
    running: app.isRunning,
    paused: app.isPaused,
    selected: app.selectedGame ? gameKey(app.selectedGame) : null,
    queue: app.queue.map((game) => [gameKey(game), app.queueEntryMetadataByKey[gameKey(game)] ?? null]),
    favorites: [...favoriteGameIdentityKeys(app.favoriteGames)].sort(),
    hiddenGames: [...hiddenGameIdentityKeys(app.hiddenGames)].sort(),
    priorityMode: app.campaignPriorityMode,
    farmScope: app.farmCategoryScope,
    preferredLanguage: app.preferredStreamerLanguage,
    watchPreference: app.watchTransportPreference,
    campaigns: app.availableGames
      .map((game) => [gameKey(game), game.endsAt ?? null, game.rewardSummary?.completion ?? null])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
  });
}

export function farmingAutomationFingerprint(
  state: ServiceWorkerState,
  facts: FarmingAutomationFactsV1,
  generation: number,
): string {
  return JSON.stringify({
    state: farmingAutomationStateFingerprint(state, generation),
    manualWatch: facts.manualWatch,
    projectedManualWatch: state.appState.manualWatchState,
    projectedDeadline: state.appState.nextAutomationCheckAt,
  });
}

export function expireFarmingAutomationManualWatch(
  facts: FarmingAutomationFactsV1,
  now: number,
): FarmingAutomationFactsV1 {
  if (facts.manualWatch === null || now < facts.manualWatch.expiresAt) return facts;
  return {
    ...facts,
    manualWatch: null,
    nextEvaluationAt: facts.nextEvaluationAt === facts.manualWatch.recheckAt ? null : facts.nextEvaluationAt,
  };
}

export function cheapFarmingAutomationGate(
  state: ServiceWorkerState,
  snoozed: boolean,
): FarmingAutomationOutcome | null {
  if (!state.appState.autoStartFavoriteGames) return { kind: 'unchanged', reason: 'disabled' };
  if (snoozed) return { kind: 'unchanged', reason: 'snoozed' };
  if (state.appState.isPaused) return { kind: 'unchanged', reason: 'paused' };
  return null;
}

export function deriveFarmingAutomationDeadline(
  now: number,
  facts: Pick<FarmingAutomationFactsV1, 'manualWatch'>,
  retryAt: number | null = null,
): number {
  return Math.min(
    now + FARMING_AUTOMATION_INTERVAL_MS,
    facts.manualWatch?.recheckAt ?? Number.POSITIVE_INFINITY,
    retryAt ?? Number.POSITIVE_INFINITY,
  );
}

export function clampFarmingAutomationWake(now: number, deadline: number): number {
  return Math.max(now + FARMING_AUTOMATION_MIN_WAKE_MS, deadline);
}
