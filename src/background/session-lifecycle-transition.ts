import { gameKey } from '../shared/game-selection.ts';
import { toSlug } from '../shared/utils.ts';
import type { TwitchGame, TwitchStreamer, WatchTransportMode } from '../types/index.ts';
import type {
  FarmingAutomationPersistence,
  FarmingSessionTransitionCommit,
  FarmingSessionTransitionReceiptV1,
  WatchOwnershipV1,
} from './farming-automation-contracts.ts';
import type { FarmingAutomationTwitchSnapshot } from './farming-automation-twitch.ts';
import {
  currentFarmingSessionEpoch,
  isFarmingSessionEpochCurrent,
  runInFarmingSessionCriticalSection,
} from './farming-session-revision.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import {
  candidateWorkingState,
  existingReceiptResult,
  FarmingSessionTransitionInvariantError,
  pairMatchesState,
  sameOwnership,
} from './session-lifecycle-transition-state.ts';
import type { PreparedWatch, WatchTransportTransition } from './watch-transport-transition.ts';

type TransitionBase = {
  readonly attemptId: string;
  readonly candidate: TwitchGame;
  readonly snapshot: FarmingAutomationTwitchSnapshot;
  readonly watchMode: WatchTransportMode;
  readonly expectedFingerprint: string;
};

export type AutomaticFarmingSessionTransitionRequest = TransitionBase &
  (
    | { readonly transition: 'start'; readonly fromCampaignKey: null }
    | { readonly transition: 'preemption'; readonly fromCampaignKey: string }
  );

export type AutomaticFarmingSessionTransitionResult =
  | {
      readonly kind: 'committed';
      readonly receipt: FarmingSessionTransitionReceiptV1;
      readonly obsolete: WatchOwnershipV1 | null;
    }
  | { readonly kind: 'replayed'; readonly receipt: FarmingSessionTransitionReceiptV1 }
  | { readonly kind: 'unchanged'; readonly reason: 'superseded-by-state-change' }
  | { readonly kind: 'failed'; readonly reason: 'candidate-preparation-failed' | 'transition-commit-failed' };

export type AutomaticFarmingSessionTransitionDependencies = {
  readonly acquireStreamer: (
    candidate: TwitchGame,
    snapshot: FarmingAutomationTwitchSnapshot,
  ) => Promise<TwitchStreamer | null>;
  readonly currentFingerprint: () => string;
  readonly loadReceipt: FarmingAutomationPersistence['loadReceipt'];
  readonly commitTransition: FarmingAutomationPersistence['commitTransition'];
  readonly watch: WatchTransportTransition;
  readonly now?: () => number;
};

export { FarmingSessionTransitionInvariantError };

async function disposeForResult(
  watch: PreparedWatch,
  result: AutomaticFarmingSessionTransitionResult,
): Promise<AutomaticFarmingSessionTransitionResult> {
  await watch.dispose();
  return result;
}

export async function transitionAutomaticFarmingSession(
  state: ServiceWorkerState,
  request: AutomaticFarmingSessionTransitionRequest,
  dependencies: AutomaticFarmingSessionTransitionDependencies,
): Promise<AutomaticFarmingSessionTransitionResult> {
  const epoch = currentFarmingSessionEpoch(state);
  const fromWatch = dependencies.watch.currentOwnership();
  const replay = existingReceiptResult(await dependencies.loadReceipt(), request);
  if (replay) return replay;
  const now = dependencies.now?.() ?? Date.now();
  const isCurrent = () =>
    isFarmingSessionEpochCurrent(state, epoch) &&
    dependencies.currentFingerprint() === request.expectedFingerprint &&
    pairMatchesState(state, request) &&
    sameOwnership(dependencies.watch.currentOwnership(), fromWatch);
  if (!isCurrent()) return { kind: 'unchanged', reason: 'superseded-by-state-change' };
  const workingCandidate = candidateWorkingState(state, request, now);
  if (!workingCandidate) return { kind: 'failed', reason: 'candidate-preparation-failed' };
  let streamer: TwitchStreamer | null;
  try {
    streamer = await dependencies.acquireStreamer(workingCandidate.candidate, request.snapshot);
  } catch {
    return { kind: 'failed', reason: 'candidate-preparation-failed' };
  }
  if (!streamer) return { kind: 'failed', reason: 'candidate-preparation-failed' };
  if (!isCurrent()) return { kind: 'unchanged', reason: 'superseded-by-state-change' };
  let preparation: Awaited<ReturnType<WatchTransportTransition['prepare']>>;
  try {
    preparation = await dependencies.watch.prepare(
      {
        gameId: workingCandidate.candidate.categoryId ?? workingCandidate.candidate.id,
        selectionId: workingCandidate.candidate.id,
        campaignId: workingCandidate.candidate.campaignId,
        categorySlug:
          workingCandidate.candidate.categorySlug?.trim() || toSlug(workingCandidate.candidate.name),
        channelName: streamer.name,
      },
      request.watchMode,
    );
  } catch {
    return { kind: 'failed', reason: 'candidate-preparation-failed' };
  }
  if (preparation.kind === 'failed') return { kind: 'failed', reason: 'candidate-preparation-failed' };
  if (!isCurrent()) {
    return disposeForResult(preparation.watch, {
      kind: 'unchanged',
      reason: 'superseded-by-state-change',
    });
  }
  return runInFarmingSessionCriticalSection(state, async () => {
    if (!isCurrent()) {
      return disposeForResult(preparation.watch, {
        kind: 'unchanged',
        reason: 'superseded-by-state-change',
      });
    }
    const working = workingCandidate.state;
    working.appState.activeStreamer = structuredClone(streamer);
    working.appState.watchTransportMode = preparation.watch.health.mode;
    working.appState.watchHealth = structuredClone(preparation.watch.health);
    working.appState.watchFallbackReason = null;
    working.appState.tabId =
      preparation.watch.ownership.kind === 'managed-tab' ? preparation.watch.ownership.tabId : null;
    const receipt: FarmingSessionTransitionReceiptV1 = {
      version: 1,
      attemptId: request.attemptId,
      transition: request.transition,
      fromCampaignKey: request.fromCampaignKey,
      toCampaignKey: gameKey(request.candidate),
      toStreamerName: streamer.name,
      committedAt: now,
      sessionRevision: String(epoch),
      fromWatch,
      toWatch: preparation.watch.ownership,
      cleanup:
        fromWatch?.kind === 'managed-tab'
          ? { kind: 'pending', obsolete: fromWatch }
          : { kind: 'not-required' },
    };
    const commit: FarmingSessionTransitionCommit = {
      expectedSessionRevision: String(epoch),
      nextAppState: working.appState,
      nextDropsSnapshot: working.cachedDropsSnapshot,
      receipt,
    };
    let committed: Awaited<ReturnType<FarmingAutomationPersistence['commitTransition']>>;
    try {
      committed = await dependencies.commitTransition(commit);
    } catch {
      return disposeForResult(preparation.watch, { kind: 'failed', reason: 'transition-commit-failed' });
    }
    switch (committed.kind) {
      case 'stale':
        return disposeForResult(preparation.watch, {
          kind: 'unchanged',
          reason: 'superseded-by-state-change',
        });
      case 'failed':
        return disposeForResult(preparation.watch, { kind: 'failed', reason: 'transition-commit-failed' });
      case 'committed': {
        Object.assign(state, working);
        const promotion = preparation.watch.promote();
        if (promotion.kind === 'discarded') {
          throw new FarmingSessionTransitionInvariantError(request.attemptId, 'promotion-discarded');
        }
        return { kind: 'committed', receipt, obsolete: promotion.obsolete };
      }
    }
  });
}
