import { gameKey } from '../shared/game-selection.ts';
import { recordCampaignFailure } from './campaign-failure-episodes.ts';
import type { FarmingSessionContext } from './farming-session-context.ts';
import { currentFarmingSessionEpoch, isFarmingSessionEpochCurrent } from './farming-session-revision.ts';
import { applyNoStreamersRecoveryState, applyStopState } from './recovery-state.ts';
import { advanceQueueIfCompleted, skipCurrentGameAndAdvanceQueue } from './session-lifecycle-queue.ts';
import { progressFarmingQueue } from './session-lifecycle-queue-progression.ts';
import {
  isAutomaticFavoriteSession,
  prepareNextEligibleQueueHead,
} from './session-lifecycle-queue-selection.ts';
import type {
  QueueProgressionExecution,
  QueueSkipReason,
  StopFarmingSessionRequest,
} from './session-lifecycle-types.ts';

export type QueueAvailabilityEvidence = {
  readonly eligibleCampaignKeys: ReadonlySet<string>;
  readonly rehabilitatedCampaignKeys: ReadonlySet<string>;
  /** Live streamers to remember for stalled parks that have no baseline yet. */
  readonly stallBaselines: ReadonlyMap<string, readonly string[]>;
};

export type FarmingQueueProgression = {
  advanceIfCompleted(isCurrent?: () => boolean): Promise<boolean>;
  skipCurrent(reason: QueueSkipReason, isCurrent?: () => boolean): Promise<void>;
  retryWaitingQueue(isCurrent?: () => boolean): Promise<boolean>;
  reconcileAvailability(evidence: QueueAvailabilityEvidence, now: number): void;
};

type Dependencies = {
  readonly onStopMonitoring: () => void;
  readonly onStopFarmingSession: (options: StopFarmingSessionRequest) => Promise<void>;
};

export function createFarmingQueueProgression(
  context: FarmingSessionContext,
  dependencies: Dependencies,
): FarmingQueueProgression {
  const { state, adapters, now } = context;
  const runProgression = (operation: () => Promise<boolean>): Promise<boolean> => {
    const epoch = currentFarmingSessionEpoch(state);
    const generation = state.tickGeneration;
    const pending = state.queueProgressionInFlight;
    if (pending?.epoch === epoch && pending.generation === generation) return pending.promise;
    const promise = Promise.resolve()
      .then(operation)
      .finally(() => {
        if (state.queueProgressionInFlight?.promise === promise) state.queueProgressionInFlight = null;
      });
    state.queueProgressionInFlight = { epoch, generation, promise };
    return promise;
  };
  const effects = {
    now,
    onTransitionToCampaign: (game, isCurrent) =>
      context.transitionCampaign?.(game, isCurrent) ??
      Promise.resolve({
        kind: 'failed',
        reason: 'open-failed',
        error: 'Watch preparation is unavailable.',
      }),
    onSaveState: () => adapters.saveState(state),
    onSaveTimingState: adapters.saveTimingState,
    onStopMonitoring: async () => {
      dependencies.onStopMonitoring();
      context.manualWatchTransportSuspended = false;
      try {
        await adapters.watchTransport?.stop();
      } catch {
        // Transport cleanup cannot prevent a durable terminal queue state.
      }
    },
    onApplyStopState: applyStopState,
    onNotify: adapters.notify,
    onStopFarmingSession: dependencies.onStopFarmingSession,
    onSuspendTransport: async () => {
      try {
        await adapters.watchTransport?.stop();
      } catch {
        /* Keep the durable retry even if transport cleanup fails. */
      }
    },
    onCampaignFailure: async (game, reason) => {
      const notification = recordCampaignFailure(state, game, reason, now());
      await adapters.saveState(state);
      if (notification)
        void Promise.resolve()
          .then(() => adapters.automationNotify?.(notification))
          .catch(() => undefined);
    },
    onSendAlert: async (kind, message) => {
      if (kind === 'all-complete' && state.appState.completionNotified && adapters.automationNotify) return;
      await adapters.sendAlert(kind, message);
    },
    onQueueCompleteNotification: adapters.notifyQueueComplete,
    onSystemAlert: async (reason, message) => {
      const alreadyDelivered =
        state.appState.completionNotified &&
        adapters.automationNotify &&
        (reason === 'queue-complete' || reason === 'farming-complete');
      if (!alreadyDelivered) await adapters.telegramSystemAlert?.(reason, message);
    },
    isCampaignValidationCurrent: () => state.hasCurrentGenerationCampaignValidation,
  } satisfies Omit<QueueProgressionExecution, 'isCurrent'>;

  const execution = (externalIsCurrent: () => boolean = () => true): QueueProgressionExecution => {
    const epoch = currentFarmingSessionEpoch(state);
    const generation = state.tickGeneration;
    return {
      ...effects,
      isCurrent: () =>
        externalIsCurrent() &&
        isFarmingSessionEpochCurrent(state, epoch) &&
        state.tickGeneration === generation &&
        !state.appState.isPaused &&
        state.appState.lastStopReason !== 'user-stop',
    };
  };

  return {
    advanceIfCompleted: (isCurrent) => {
      const options = execution(isCurrent);
      return runProgression(() => advanceQueueIfCompleted(state, options));
    },
    skipCurrent: async (reason, isCurrent) => {
      const options = execution(isCurrent);
      await runProgression(async () => {
        await skipCurrentGameAndAdvanceQueue(
          state,
          reason,
          reason === 'unfarmable'
            ? {
                ...options,
                onNotify: undefined,
                onStopFarmingSession: (request) =>
                  dependencies.onStopFarmingSession({ ...request, suppressNotifications: true }),
              }
            : options,
        );
        return options.isCurrent() && state.appState.isRunning;
      });
    },
    retryWaitingQueue: (isCurrent) => {
      const options = execution(isCurrent);
      return runProgression(async () => {
        const deadline = state.appState.queueAcquisitionRound?.nextRoundAt;
        if (!options.isCurrent() || !state.appState.isRunning || deadline == null || deadline > now())
          return false;
        const result = await progressFarmingQueue(state, {
          restrictUnauthorizedManualContinuation: isAutomaticFavoriteSession(
            state,
            state.appState.selectedGame,
          ),
          terminalFarmingCompleteGame: null,
          options,
        });
        return result.kind === 'advanced';
      });
    },
    reconcileAvailability(evidence, observedAt) {
      for (const [key, parkedStreamerNames] of evidence.stallBaselines) {
        const metadata = state.appState.queueEntryMetadataByKey[key];
        if (metadata) state.appState.queueEntryMetadataByKey[key] = { ...metadata, parkedStreamerNames };
      }
      const readyKeys = new Set<string>();
      for (const game of state.appState.queue) {
        const key = gameKey(game);
        const metadata = state.appState.queueEntryMetadataByKey[key];
        if (
          !metadata ||
          !evidence.eligibleCampaignKeys.has(key) ||
          (metadata.streamerWaitState !== 'availability' && !evidence.rehabilitatedCampaignKeys.has(key))
        )
          continue;
        const { streamerWaitState: _wait, parkedStreamerNames: _parked, ...ready } = metadata;
        state.appState.queueEntryMetadataByKey[key] = { ...ready, streamerRetryAt: observedAt };
        readyKeys.add(key);
      }
      const round = state.appState.queueAcquisitionRound;
      if (readyKeys.size === 0 || !round) return;
      if (round.nextRoundAt !== null && round.nextRoundAt > observedAt) return;
      state.appState.queueAcquisitionRound = {
        attemptedCampaignKeys: round.attemptedCampaignKeys.filter((key) => !readyKeys.has(key)),
        nextRoundAt: null,
      };
      if (state.appState.isRunning && !state.appState.isPaused && !state.appState.activeStreamer) {
        const next = prepareNextEligibleQueueHead(
          state,
          !state.appState.manualQueueAuthorized && state.appState.farmingSessionOrigin === 'automatic',
          observedAt,
        );
        if (next) applyNoStreamersRecoveryState(state, observedAt, 0);
      }
    },
  };
}
