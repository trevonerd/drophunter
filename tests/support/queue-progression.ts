import type { CampaignTransitionResult } from '../../src/background/farming-campaign-transition.ts';
import {
  createFarmingQueueProgression,
  type FarmingQueueProgression,
} from '../../src/background/farming-queue-progression.ts';
import {
  createFarmingSessionContext,
  type FarmingSessionAdapters,
} from '../../src/background/farming-session-context.ts';
import { applyStopState } from '../../src/background/recovery-state.ts';
import type { ServiceWorkerState } from '../../src/background/runtime-state.ts';
import { stopFarmingSession } from '../../src/background/session-lifecycle-stop.ts';
import type { StopFarmingSessionRequest } from '../../src/background/session-lifecycle-types.ts';
import type { TwitchGame } from '../../src/types/index.ts';
import { createDrop, createFarmingSessionAdapters, createStreamer } from '../fixtures/queue-management.ts';

type Options = Partial<FarmingSessionAdapters> & {
  readonly transitionCampaign?: (
    game: TwitchGame,
    isCurrent: () => boolean,
  ) => Promise<CampaignTransitionResult>;
  readonly stopSession?: (request: StopFarmingSessionRequest) => Promise<void>;
  readonly stopMonitoring?: () => void;
  readonly validated?: boolean;
};

// In-memory adapter for the prepared campaign-transition seam. Composed
// handoff tests separately exercise the real campaign and playback modules.
export function commitPreparedCampaign(
  state: ServiceWorkerState,
  game: TwitchGame,
): CampaignTransitionResult {
  const drop = createDrop({ gameId: game.id, campaignId: game.campaignId, requiredMinutes: 60 });
  state.appState.selectedGame = game;
  state.appState.activeStreamer = createStreamer({ name: game.campaignId ?? game.id });
  state.appState.allDrops = [drop];
  state.appState.pendingDrops = [drop];
  state.appState.completedDrops = [];
  state.appState.currentDrop = drop;
  return { kind: 'started' };
}

export function createQueueProgressionFixture(
  state: ServiceWorkerState,
  options: Options = {},
): FarmingQueueProgression {
  state.hasCurrentGenerationCampaignValidation = options.validated ?? true;
  const adapters = createFarmingSessionAdapters(options);
  const context = createFarmingSessionContext(state, adapters);
  context.transitionCampaign = async (game, isCurrent = () => true) =>
    options.transitionCampaign
      ? options.transitionCampaign(game, isCurrent)
      : isCurrent()
        ? commitPreparedCampaign(state, game)
        : { kind: 'cancelled' };
  return createFarmingQueueProgression(context, {
    onStopMonitoring: options.stopMonitoring ?? (() => {}),
    onStopFarmingSession:
      options.stopSession ??
      ((request) =>
        stopFarmingSession(state, {
          ...request,
          onApplyStopState: applyStopState,
          onSaveState: () => adapters.saveState(state),
          onSaveTimingState: adapters.saveTimingState,
          onNotify: adapters.notify,
        })),
  });
}

export function createQueueAvailabilityReconciler(state: ServiceWorkerState) {
  return createQueueProgressionFixture(state, {
    validated: state.hasCurrentGenerationCampaignValidation,
  }).reconcileAvailability;
}
