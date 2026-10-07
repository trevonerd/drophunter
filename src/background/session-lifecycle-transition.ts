import { campaignRejectionReason } from '../shared/campaign-eligibility.ts';
import { gameKey } from '../shared/game-selection.ts';
import { isRewardFarmableNow } from '../shared/reward-scheduling.ts';
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
import { retainPendingStreamerPreparation } from './pending-streamer-preparation.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import {
  candidateWorkingState,
  createAutomaticTransitionReceipt,
  existingReceiptResult,
  FarmingSessionTransitionInvariantError,
  pairMatchesState,
  persistAutomaticTransitionAttempt,
  sameOwnership,
} from './session-lifecycle-transition-state.ts';
import { beginStreamerWatchAttempt } from './streamer-watch-attempt.ts';
import { isWatchPreparationUnavailable } from './watch-health.ts';
import type { PreparedWatch, WatchTransportTransition } from './watch-transport-transition.ts';

type TransitionBase = {
  readonly attemptId: string;
  readonly candidate: TwitchGame;
  readonly snapshot: FarmingAutomationTwitchSnapshot;
  readonly watchMode: WatchTransportMode;
  readonly expectedFingerprint: string;
  readonly manualOverride?: boolean;
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
  | {
      readonly kind: 'failed';
      readonly reason:
        | 'candidate-preparation-failed'
        | 'candidate-playback-pending'
        | 'transition-commit-failed';
    };

export type AutomaticFarmingSessionTransitionDependencies = {
  readonly acquireStreamer: (
    candidate: TwitchGame,
    snapshot: FarmingAutomationTwitchSnapshot,
  ) => Promise<TwitchStreamer | null>;
  readonly currentFingerprint: () => string;
  readonly persistAttempt: () => Promise<boolean>;
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
  let expectedFingerprint = request.expectedFingerprint;
  let committedPreparation = false;
  const isCurrent = () =>
    campaignRejectionReason(request.candidate, dependencies.now?.() ?? Date.now()) === null &&
    isFarmingSessionEpochCurrent(state, epoch) &&
    (committedPreparation ||
      (dependencies.currentFingerprint() === expectedFingerprint &&
        pairMatchesState(state, request) &&
        sameOwnership(dependencies.watch.currentOwnership(), fromWatch)));
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
  const key = gameKey(workingCandidate.candidate);
  const beforeReservation = state.appState.queueEntryMetadataByKey[key];
  if (!beginStreamerWatchAttempt(state, workingCandidate.candidate, streamer.name, now))
    return { kind: 'failed', reason: 'candidate-preparation-failed' };
  expectedFingerprint = dependencies.currentFingerprint();
  if (!(await persistAutomaticTransitionAttempt(dependencies.persistAttempt))) {
    return { kind: 'failed', reason: 'transition-commit-failed' };
  }
  if (!isCurrent()) return { kind: 'unchanged', reason: 'superseded-by-state-change' };
  const reservation = state.appState.queueEntryMetadataByKey[key];
  workingCandidate.state.appState.queueEntryMetadataByKey[key] = state.appState.queueEntryMetadataByKey[key];
  let preparation: Awaited<ReturnType<WatchTransportTransition['prepare']>>;
  try {
    preparation = await dependencies.watch.prepare(
      {
        gameId: workingCandidate.candidate.categoryId ?? workingCandidate.candidate.id,
        selectionId: workingCandidate.candidate.id,
        campaignId: workingCandidate.candidate.campaignId,
        categorySlug:
          workingCandidate.candidate.categorySlug?.trim() || toSlug(workingCandidate.candidate.name),
        categoryName: workingCandidate.candidate.name,
        channelName: streamer.name,
      },
      request.watchMode,
      isCurrent,
      request.manualOverride === true,
    );
  } catch {
    preparation = { kind: 'failed', reason: 'candidate-unavailable', health: null };
  }
  if (preparation.kind === 'failed') {
    if (!isCurrent()) return { kind: 'unchanged', reason: 'superseded-by-state-change' };
    const pending = retainPendingStreamerPreparation(
      state,
      request.candidate,
      preparation.health,
      workingCandidate.state,
      dependencies.now?.() ?? Date.now(),
    );
    expectedFingerprint = dependencies.currentFingerprint();
    if (pending) {
      if (!(await persistAutomaticTransitionAttempt(dependencies.persistAttempt))) {
        return { kind: 'failed', reason: 'transition-commit-failed' };
      }
      return { kind: 'failed', reason: 'candidate-playback-pending' };
    }
    if (preparation.health?.reason === 'playback-pending') {
      await dependencies.watch.suspend?.(isCurrent);
      if (!isCurrent()) return { kind: 'unchanged', reason: 'superseded-by-state-change' };
    }
    if (
      isWatchPreparationUnavailable(preparation.health) &&
      isFarmingSessionEpochCurrent(state, epoch) &&
      state.appState.queueEntryMetadataByKey[key] === reservation
    ) {
      if (beforeReservation) state.appState.queueEntryMetadataByKey[key] = beforeReservation;
      else delete state.appState.queueEntryMetadataByKey[key];
      if (!(await persistAutomaticTransitionAttempt(dependencies.persistAttempt))) {
        return { kind: 'failed', reason: 'transition-commit-failed' };
      }
    }
    return { kind: 'failed', reason: 'candidate-preparation-failed' };
  }
  if (!isCurrent()) {
    return disposeForResult(preparation.watch, {
      kind: 'unchanged',
      reason: 'superseded-by-state-change',
    });
  }
  retainPendingStreamerPreparation(
    state,
    request.candidate,
    preparation.watch.health,
    workingCandidate.state,
    dependencies.now?.() ?? Date.now(),
  );
  expectedFingerprint = dependencies.currentFingerprint();
  workingCandidate.state.appState.queueEntryMetadataByKey[key] = state.appState.queueEntryMetadataByKey[key];
  return runInFarmingSessionCriticalSection(state, async () => {
    if (
      !isCurrent() ||
      !workingCandidate.state.appState.pendingDrops.some((drop) =>
        isRewardFarmableNow(drop, dependencies.now?.() ?? Date.now()),
      )
    ) {
      return disposeForResult(preparation.watch, {
        kind: 'unchanged',
        reason: 'superseded-by-state-change',
      });
    }
    const working = workingCandidate.state;
    working.appState.activeStreamer = structuredClone(streamer);
    working.appState.watchTransportMode = preparation.watch.health.mode;
    working.appState.watchHealth = structuredClone(preparation.watch.health);
    working.appState.tabId =
      preparation.watch.ownership.kind === 'managed-tab' ? preparation.watch.ownership.tabId : null;
    const receipt = createAutomaticTransitionReceipt(request, preparation.watch, fromWatch, now, epoch);
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
        if (!isFarmingSessionEpochCurrent(state, epoch)) {
          return disposeForResult(preparation.watch, {
            kind: 'unchanged',
            reason: 'superseded-by-state-change',
          });
        }
        committedPreparation = true;
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
