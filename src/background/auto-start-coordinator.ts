import { gameKey } from '../shared/game-selection.ts';
import type { TwitchGame } from '../types/index.ts';
import type { CampaignPriorityCandidate } from './campaign-priority.ts';

export type AutoStartEvaluationReason = 'browser-start' | 'periodic' | 'campaign-refresh';

export type AutoStartCandidate = CampaignPriorityCandidate & {
  readonly hasFarmableReward: boolean;
  readonly isActive: boolean;
  readonly isFavorite: boolean;
};

export interface AutoStartCoordinatorState {
  readonly autoStartFavoriteGames: boolean;
  readonly notificationsEnabled: boolean;
  readonly isRunning: boolean;
  readonly isPaused: boolean;
  readonly selectedGame: TwitchGame | null;
  readonly manualWatchActive: boolean;
  readonly autoStartSnoozed: boolean;
  readonly twitchSessionValid: boolean;
}

export type AutoStartSkipReason =
  | 'disabled'
  | 'notifications-unavailable'
  | 'twitch-session-missing'
  | 'auto-start-snoozed'
  | 'paused'
  | 'manual-watch-active'
  | 'already-running'
  | 'no-campaign'
  | 'preemption-already-applied'
  | 'state-changed'
  | 'refresh-failed'
  | 'start-failed';

export type AutoStartResult =
  | {
      readonly started: true;
      readonly campaign: TwitchGame;
      readonly preempted: boolean;
    }
  | {
      readonly started: false;
      readonly skipReason: AutoStartSkipReason;
      readonly candidate: TwitchGame | undefined;
    };

export interface AutoStartStartContext {
  readonly reason: AutoStartEvaluationReason;
  readonly preempted: boolean;
  readonly currentCampaign: TwitchGame | null;
}

export interface AutoStartCoordinatorDependencies {
  readonly getState: () => AutoStartCoordinatorState;
  readonly refreshDrops: (reason: AutoStartEvaluationReason) => Promise<void>;
  readonly discoverCandidates: () => Promise<readonly AutoStartCandidate[]>;
  readonly rankCandidates?: (
    candidates: readonly AutoStartCandidate[],
    reason: AutoStartEvaluationReason,
  ) => readonly AutoStartCandidate[];
  readonly onRankedCampaigns?: (
    campaigns: readonly AutoStartCandidate[],
    reason: AutoStartEvaluationReason,
  ) => Promise<void>;
  readonly hasNotificationPermission: () => Promise<boolean>;
  readonly startFarming: (campaign: TwitchGame, context: AutoStartStartContext) => Promise<void>;
  readonly now?: () => number;
}

export interface AutoStartCoordinator {
  evaluate(reason: AutoStartEvaluationReason): Promise<AutoStartResult>;
}

function sameCampaign(left: TwitchGame | null, right: TwitchGame | null): boolean {
  if (!left || !right) {
    return left === right;
  }
  return gameKey(left) === gameKey(right);
}

function isStateChanged(before: AutoStartCoordinatorState, after: AutoStartCoordinatorState): boolean {
  return (
    before.isRunning !== after.isRunning ||
    before.isPaused !== after.isPaused ||
    !sameCampaign(before.selectedGame, after.selectedGame)
  );
}

function resultSkipped(
  skipReason: AutoStartSkipReason,
  candidate: TwitchGame | undefined = undefined,
): AutoStartResult {
  return { started: false, skipReason, candidate };
}

function errorResult(error: unknown, skipReason: 'refresh-failed' | 'start-failed'): AutoStartResult {
  if (error instanceof Error) {
    return resultSkipped(skipReason);
  }
  throw error;
}

function defaultRankCandidates(candidates: readonly AutoStartCandidate[]): readonly AutoStartCandidate[] {
  return [...candidates].sort((left, right) => {
    const leftEndsAt = left.game.endsAt ? Date.parse(left.game.endsAt) : Number.POSITIVE_INFINITY;
    const rightEndsAt = right.game.endsAt ? Date.parse(right.game.endsAt) : Number.POSITIVE_INFINITY;
    const leftExpiry = Number.isFinite(leftEndsAt) ? leftEndsAt : Number.POSITIVE_INFINITY;
    const rightExpiry = Number.isFinite(rightEndsAt) ? rightEndsAt : Number.POSITIVE_INFINITY;
    return (
      leftExpiry - rightExpiry ||
      (left.game.campaignId ?? gameKey(left.game)).localeCompare(right.game.campaignId ?? gameKey(right.game))
    );
  });
}

function filterEligibleCandidates(candidates: readonly AutoStartCandidate[]): readonly AutoStartCandidate[] {
  return candidates.filter(
    (candidate) => candidate.isActive && candidate.hasFarmableReward && candidate.eligibleStreamerCount > 0,
  );
}

function findCandidate(candidates: readonly AutoStartCandidate[]): AutoStartCandidate | undefined {
  return candidates[0];
}

function isEarlierExpiry(candidate: TwitchGame, current: TwitchGame): boolean {
  if (!candidate.endsAt || !current.endsAt) {
    return false;
  }
  const candidateEndsAt = Date.parse(candidate.endsAt);
  const currentEndsAt = Date.parse(current.endsAt);
  return (
    Number.isFinite(candidateEndsAt) && Number.isFinite(currentEndsAt) && candidateEndsAt < currentEndsAt
  );
}

export function createAutoStartCoordinator(
  dependencies: AutoStartCoordinatorDependencies,
): AutoStartCoordinator {
  const preemptedCampaignKeys = new Set<string>();
  const rankCandidates = dependencies.rankCandidates ?? defaultRankCandidates;
  let inFlight: Promise<AutoStartResult> | null = null;

  const evaluateOnce = async (reason: AutoStartEvaluationReason): Promise<AutoStartResult> => {
    const before = dependencies.getState();
    if (!before.autoStartFavoriteGames) {
      return resultSkipped('disabled');
    }
    if (!before.notificationsEnabled) {
      return resultSkipped('notifications-unavailable');
    }

    let hasPermission: boolean;
    try {
      hasPermission = await dependencies.hasNotificationPermission();
    } catch (error) {
      if (error instanceof Error) {
        return resultSkipped('notifications-unavailable');
      }
      throw error;
    }
    if (!hasPermission) {
      return resultSkipped('notifications-unavailable');
    }
    if (!before.twitchSessionValid) {
      return resultSkipped('twitch-session-missing');
    }
    if (before.autoStartSnoozed) {
      return resultSkipped('auto-start-snoozed');
    }
    if (before.isPaused) {
      return resultSkipped('paused');
    }

    let ranked: readonly AutoStartCandidate[];
    try {
      await dependencies.refreshDrops(reason);
      const discovered = filterEligibleCandidates(await dependencies.discoverCandidates());
      ranked = rankCandidates(discovered, reason);
      if (dependencies.onRankedCampaigns) {
        await dependencies.onRankedCampaigns(ranked, reason);
      }
    } catch (error) {
      return errorResult(error, 'refresh-failed');
    }

    const candidate = findCandidate(ranked);
    if (!candidate) {
      return resultSkipped('no-campaign');
    }

    const after = dependencies.getState();
    if (isStateChanged(before, after)) {
      return resultSkipped('state-changed');
    }
    if (!after.autoStartFavoriteGames) {
      return resultSkipped('disabled');
    }
    if (!after.notificationsEnabled) {
      return resultSkipped('notifications-unavailable');
    }
    if (!after.twitchSessionValid) {
      return resultSkipped('twitch-session-missing');
    }
    if (after.autoStartSnoozed) {
      return resultSkipped('auto-start-snoozed');
    }
    if (after.isPaused) {
      return resultSkipped('paused');
    }
    if (after.manualWatchActive) {
      return resultSkipped('manual-watch-active', candidate.game);
    }

    const current = after.selectedGame;
    const alreadyRunning = after.isRunning;
    if (alreadyRunning && sameCampaign(current, candidate.game)) {
      return resultSkipped('already-running', candidate.game);
    }

    const preempted =
      alreadyRunning && current !== null && candidate.isFavorite && isEarlierExpiry(candidate.game, current);
    if (alreadyRunning && !preempted) {
      return resultSkipped('already-running', candidate.game);
    }
    if (preempted && preemptedCampaignKeys.has(gameKey(candidate.game))) {
      return resultSkipped('preemption-already-applied');
    }

    try {
      await dependencies.startFarming(candidate.game, {
        reason,
        preempted,
        currentCampaign: current,
      });
    } catch (error) {
      return errorResult(error, 'start-failed');
    }
    if (preempted) {
      preemptedCampaignKeys.add(gameKey(candidate.game));
    }
    return { started: true, campaign: candidate.game, preempted };
  };

  return {
    evaluate(reason: AutoStartEvaluationReason): Promise<AutoStartResult> {
      if (inFlight) {
        return inFlight;
      }
      inFlight = evaluateOnce(reason).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}
