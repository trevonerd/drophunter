import { gameKey, getGameDisplayLabel } from '../shared/game-selection.ts';
import type { RefreshDropsOutcome } from './drops-tick-refresh.ts';
import type { FarmingSessionContext, RefreshDropsOptions } from './farming-session-context.ts';
import { currentFarmingSessionEpoch } from './farming-session-revision.ts';
import {
  recoverStalledProgress,
  type StalledProgressRecoveryResult,
  type StalledProgressSource,
} from './stalled-progress-recovery.ts';
import { rotateStreamer } from './streamer-acquisition.ts';
import type { EnterPersistentRecoveryFn } from './streamer-acquisition-contracts.ts';

interface FarmingSessionStallRecoveryDependencies {
  readonly onRefreshDropsData: (options?: RefreshDropsOptions) => Promise<RefreshDropsOutcome>;
  readonly onAdvanceQueueIfCompleted: () => Promise<boolean>;
  readonly onAcquireStreamer: (isCurrent?: () => boolean) => Promise<boolean>;
  readonly onSkipCurrentGame: () => Promise<void>;
  readonly onEnterPersistentRecovery: EnterPersistentRecoveryFn;
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
          isCurrent: current,
        }),
      onInventoryRefresh: (current = isCurrent) =>
        dependencies.onRefreshDropsData({
          includeCampaignFetch: false,
          includeInventoryFetch: true,
          sessionRecoveryMode: 'background-tab',
          suppressNotifications: true,
          isCurrent: current,
        }),
      onAdvanceQueueIfCompleted: dependencies.onAdvanceQueueIfCompleted,
      onAttemptPlaybackSelfHeal: adapters.attemptPlaybackSelfHeal,
      onRestartTablessWatcher: async (current = isCurrent) => {
        const activeStreamer = state.appState.activeStreamer;
        if (activeStreamer && adapters.watchTransport) {
          await adapters.watchTransport.start(activeStreamer, current);
          return;
        }
        await dependencies.onAcquireStreamer(current);
      },
      onRotateManagedStreamer: async (current = isCurrent) => {
        await rotateStreamer(state, 'stalled-progress', {
          isCurrent: current,
          onOpenStreamer: dependencies.onAcquireStreamer,
          onSaveState: () => adapters.saveState(state),
          onSaveTimingState: adapters.saveTimingState,
          onEnterPersistentRecovery: dependencies.onEnterPersistentRecovery,
        });
      },
      onSkipCurrentGame: dependencies.onSkipCurrentGame,
      onSaveState: () => adapters.saveState(state),
      onSaveTimingState: adapters.saveTimingState,
    });
    if (!isCurrent()) return { kind: 'selection-changed' };
    if (result.kind === 'retry-scheduled' && result.started && state.appState.selectedGame) {
      const selectedGame = state.appState.selectedGame;
      await adapters.automationNotify?.({
        transitionId: `stall-recovery:${gameKey(selectedGame)}:${result.attempt}:${result.retryAt}`,
        event: 'recovery',
        campaignId: selectedGame.campaignId ?? selectedGame.id,
        title: 'Checking stalled Drop progress',
        message: `DropHunter is verifying progress for ${getGameDisplayLabel(selectedGame)} before changing streamer.`,
        priority: 1,
        telegramReason: 'recovery',
      });
    }
    return result;
  };
}
