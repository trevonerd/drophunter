import { gameKey } from '../shared/game-selection.ts';
import { isRewardFarmableNow } from '../shared/reward-scheduling.ts';
import type { TwitchDrop, TwitchGame } from '../types/index.ts';
import { projectDropsSnapshot } from './drops-projection.ts';
import type {
  FarmingAutomationPersistenceRead,
  FarmingSessionTransitionReceiptV1,
  WatchOwnershipV1,
} from './farming-automation-contracts.ts';
import type {
  FarmingAutomationNormalizedDrop,
  FarmingAutomationNormalizedGame,
} from './farming-automation-twitch.ts';
import { clearStopState } from './recovery-state.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { resetStreamTrackingState } from './session-lifecycle-stop.ts';
import type {
  AutomaticFarmingSessionTransitionRequest,
  AutomaticFarmingSessionTransitionResult,
} from './session-lifecycle-transition.ts';

export class FarmingSessionTransitionInvariantError extends Error {
  readonly name = 'FarmingSessionTransitionInvariantError';

  constructor(
    readonly attemptId: string,
    readonly violation: 'attempt-pair-reused' | 'promotion-discarded',
  ) {
    super(`Farming session transition invariant violated: ${violation}`);
  }
}

function cloneGame(game: FarmingAutomationNormalizedGame): TwitchGame {
  return {
    ...game,
    allowedChannels:
      game.allowedChannels === null || game.allowedChannels === undefined
        ? game.allowedChannels
        : [...game.allowedChannels],
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

function cloneTransitionState(state: ServiceWorkerState): ServiceWorkerState {
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

export function candidateWorkingState(
  state: ServiceWorkerState,
  request: AutomaticFarmingSessionTransitionRequest,
  now: number,
): { readonly state: ServiceWorkerState; readonly candidate: TwitchGame } | null {
  const candidateKey = gameKey(request.candidate);
  const games = request.snapshot.games.map(cloneGame);
  const candidate = games.find((game) => gameKey(game) === candidateKey);
  if (!candidate) return null;
  const working = cloneTransitionState(state);
  working.appState.selectedGame = candidate;
  const campaignChannelsMap = Object.fromEntries(
    Object.entries(request.snapshot.campaignChannelsMap).map(([key, channels]) => [
      key,
      channels === null ? null : [...channels],
    ]),
  );
  projectDropsSnapshot(
    working,
    {
      games,
      drops: request.snapshot.drops.map(cloneDrop),
      campaignChannelsMap,
      updatedAt: request.snapshot.updatedAt,
    },
    'campaign-authoritative',
  );
  const selected = working.appState.selectedGame;
  if (
    !selected ||
    gameKey(selected) !== candidateKey ||
    !working.appState.pendingDrops.some((drop) => isRewardFarmableNow(drop, now))
  ) {
    return null;
  }
  working.appState.isRunning = true;
  working.appState.isPaused = false;
  working.appState.activeStreamer = null;
  working.appState.completionNotified = false;
  working.appState.lastRotationReason = null;
  working.appState.lastRotationAt = null;
  resetStreamTrackingState(working);
  clearStopState(working);
  working.dropClaimRetryAtById.clear();
  working.dropClaimInFlight = false;
  working.monitorTickInFlight = false;
  working.tickGeneration += 1;
  return { state: working, candidate: selected };
}

export function sameOwnership(left: WatchOwnershipV1 | null, right: WatchOwnershipV1 | null): boolean {
  if (left === null || right === null) return left === right;
  if (left.kind !== right.kind) return false;
  if (left.kind === 'tabless' && right.kind === 'tabless') return left.targetKey === right.targetKey;
  return (
    left.kind === 'managed-tab' &&
    right.kind === 'managed-tab' &&
    left.tabId === right.tabId &&
    left.ownershipToken === right.ownershipToken &&
    left.expectedChannel === right.expectedChannel
  );
}

export function pairMatchesState(
  state: ServiceWorkerState,
  request: AutomaticFarmingSessionTransitionRequest,
): boolean {
  switch (request.transition) {
    case 'start':
      return !state.appState.isRunning;
    case 'preemption':
      return (
        state.appState.isRunning &&
        state.appState.selectedGame !== null &&
        gameKey(state.appState.selectedGame) === request.fromCampaignKey
      );
  }
}

export function existingReceiptResult(
  read: FarmingAutomationPersistenceRead<FarmingSessionTransitionReceiptV1 | null>,
  request: AutomaticFarmingSessionTransitionRequest,
): AutomaticFarmingSessionTransitionResult | null {
  if (read.kind === 'failed') return { kind: 'failed', reason: 'transition-commit-failed' };
  const receipt = read.value;
  if (!receipt) return null;
  if (receipt.attemptId === request.attemptId) {
    if (
      receipt.fromCampaignKey !== request.fromCampaignKey ||
      receipt.toCampaignKey !== gameKey(request.candidate)
    ) {
      throw new FarmingSessionTransitionInvariantError(request.attemptId, 'attempt-pair-reused');
    }
    return { kind: 'replayed', receipt };
  }
  return receipt.cleanup.kind === 'pending' ? { kind: 'failed', reason: 'transition-commit-failed' } : null;
}
