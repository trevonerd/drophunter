import { gameKey } from '../shared/game-selection.ts';
import type { RefreshDropsOutcome } from './drops-tick-refresh.ts';
import type { FarmingSessionContext, RefreshDropsOptions } from './farming-session-context.ts';
import { currentFarmingSessionEpoch } from './farming-session-revision.ts';
import {
  recoverStalledProgress,
  type StalledProgressRecoveryResult,
  type StalledProgressSource,
} from './stalled-progress-recovery.ts';
import { rotateStreamer } from './streamer-acquisition.ts';

interface FarmingSessionStallRecoveryDependencies {
  readonly onRefreshDropsData: (options?: RefreshDropsOptions) => Promise<RefreshDropsOutcome>;
  readonly onAdvanceQueueIfCompleted: () => Promise<boolean>;
  readonly onAcquireStreamer: (isCurrent?: () => boolean) => Promise<boolean>;
  readonly onSkipCurrentGame: (
    verifiedAlternativesExhausted?: boolean,
    isCurrent?: () => boolean,
  ) => Promise<void>;
}

export function createFarmingSessionStallRecovery(
  context: FarmingSessionContext,
  dependencies: FarmingSessionStallRecoveryDependencies,
) {
  const { state, adapters } = context;
  return async (
    source: StalledProgressSource,
    callerIsCurrent: () => boolean = () => true,
  ): Promise<StalledProgressRecoveryResult> => {
    const epoch = currentFarmingSessionEpoch(state);
    const generation = state.tickGeneration;
    const campaignKey = state.appState.selectedGame ? gameKey(state.appState.selectedGame) : null;
    const isCurrent = () =>
      callerIsCurrent() &&
      currentFarmingSessionEpoch(state) === epoch &&
      state.tickGeneration === generation &&
      (state.appState.selectedGame ? gameKey(state.appState.selectedGame) : null) === campaignKey;
    const result = await recoverStalledProgress(state, source, {
      isCurrent,
      now: context.now,
      onCampaignRefresh: (current = isCurrent) =>
        dependencies.onRefreshDropsData({
          includeCampaignFetch: true,
          includeInventoryFetch: false,
          sessionRecoveryMode: 'background-tab',
          suppressNotifications: true,
          strictFreshProof: true,
          minimumFreshUpdatedAt: context.now(),
          isCurrent: current,
        }),
      onInventoryRefresh: (current = isCurrent) =>
        dependencies.onRefreshDropsData({
          includeCampaignFetch: false,
          includeInventoryFetch: true,
          sessionRecoveryMode: 'background-tab',
          suppressNotifications: true,
          strictFreshProof: true,
          minimumFreshUpdatedAt: context.now(),
          isCurrent: current,
        }),
      onAdvanceQueueIfCompleted: dependencies.onAdvanceQueueIfCompleted,
      onRotateStreamer: async (current = isCurrent) => {
        return rotateStreamer(state, 'stalled-progress', {
          isCurrent: current,
          onOpenStreamer: dependencies.onAcquireStreamer,
          onSaveState: () => adapters.saveState(state),
          onSaveTimingState: adapters.saveTimingState,
        });
      },
      onSkipCurrentGame: (verifiedAlternativesExhausted = false, current = isCurrent) =>
        dependencies.onSkipCurrentGame(verifiedAlternativesExhausted, current),
      onSaveState: () => adapters.saveState(state),
      onSaveTimingState: adapters.saveTimingState,
    });
    return isCurrent() ? result : { kind: 'selection-changed' };
  };
}
