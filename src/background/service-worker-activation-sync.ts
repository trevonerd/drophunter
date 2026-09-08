import type { ActivationTrigger } from '../types/index.ts';
import type { ActivationSyncAttempt, ActivationSyncExecution } from './activation-sync-coordinator.ts';
import type { createDropsPageRefresher } from './drops-page-refresh.ts';
import type { FarmingAutomation } from './farming-automation.ts';
import type { createFarmingSession } from './farming-session.ts';
import { invalidateFarmingSessionEpoch } from './farming-session-revision.ts';
import type { RefreshGamesCacheOptions } from './games-cache-orchestration.ts';
import type { GamesCacheRefreshResult } from './games-cache-refresh-state.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

type FarmingSession = Pick<
  ReturnType<typeof createFarmingSession>,
  'acquireStreamerForSelectedGame' | 'handleStartFarming'
>;
type DropsPageRefresher = Pick<ReturnType<typeof createDropsPageRefresher>, 'openDropsPageAndRefresh'>;
type RefreshGamesCache = (options: RefreshGamesCacheOptions) => Promise<GamesCacheRefreshResult>;

interface ActivationSyncDependencies {
  readonly automation: FarmingAutomation;
  readonly dropsPageRefresher: DropsPageRefresher;
  readonly farmingSession: FarmingSession;
  readonly refreshGamesCache: RefreshGamesCache;
  readonly state: ServiceWorkerState;
}

function invalidateAutomationOnAbort(
  execution: ActivationSyncExecution,
  automation: FarmingAutomation,
): () => void {
  const invalidate = () => automation.invalidate?.();
  if (execution.signal.aborted) invalidate();
  else execution.signal.addEventListener('abort', invalidate, { once: true });
  return () => execution.signal.removeEventListener('abort', invalidate);
}

function invalidateFarmingSessionOnAbort(
  execution: ActivationSyncExecution,
  state: ServiceWorkerState,
): () => void {
  const invalidate = () => invalidateFarmingSessionEpoch(state);
  if (execution.signal.aborted) invalidate();
  else execution.signal.addEventListener('abort', invalidate, { once: true });
  return () => execution.signal.removeEventListener('abort', invalidate);
}

function transientError(error: string, errorKind: 'network' | 'invalid-response'): ActivationSyncAttempt {
  return { kind: 'transient-error', error, errorKind };
}

export function createServiceWorkerActivationSync(dependencies: ActivationSyncDependencies) {
  return async (
    trigger: ActivationTrigger,
    execution: ActivationSyncExecution,
  ): Promise<ActivationSyncAttempt> => {
    const releaseAutomationAbort = invalidateAutomationOnAbort(execution, dependencies.automation);
    const releaseFarmingSessionAbort = invalidateFarmingSessionOnAbort(execution, dependencies.state);
    try {
      const foreground = trigger === 'manual';
      const retry = trigger === 'manual-retry';
      if (!foreground) {
        const directRefresh = await dependencies.refreshGamesCache({
          requireFreshSnapshot: true,
          isCurrent: execution.isCurrent,
        });
        if (!execution.isCurrent()) return transientError('Campaign sync was superseded.', 'network');
        if (directRefresh.kind === 'refreshed') {
          if (
            dependencies.state.appState.resumedFromCrash !== null &&
            directRefresh.inventoryVerified === false
          ) {
            return transientError('Twitch inventory is temporarily unavailable.', 'network');
          }
          if (directRefresh.games.length > 0 || directRefresh.authoritativeEmpty === true) {
            if (!execution.isCurrent()) return transientError('Campaign sync was superseded.', 'network');
            await dependencies.automation.request('campaign-refresh');
            if (!execution.isCurrent()) return transientError('Campaign sync was superseded.', 'network');
            if (
              dependencies.state.appState.resumedFromCrash !== null &&
              dependencies.state.appState.isRunning &&
              !dependencies.state.appState.isPaused &&
              !dependencies.state.appState.activeStreamer &&
              !dependencies.state.appState.tabId &&
              dependencies.state.appState.selectedGame
            ) {
              if (!execution.isCurrent()) return transientError('Campaign sync was superseded.', 'network');
              await dependencies.farmingSession.acquireStreamerForSelectedGame(execution.isCurrent);
              if (!execution.isCurrent()) return transientError('Campaign sync was superseded.', 'network');
            }
            return { kind: 'synced', campaignCount: dependencies.state.appState.availableGames.length };
          }
          return transientError('Empty Twitch campaign data is awaiting confirmation.', 'invalid-response');
        }
        if (directRefresh.kind === 'unavailable' && directRefresh.failure) {
          if (directRefresh.failure.kind === 'auth' && !retry) {
            return { kind: 'needs-session', errorKind: 'auth' };
          }
          if (directRefresh.failure.kind === 'auth') {
            // Retry now may recover a session in a hidden Drops tab. It must
            // remain distinct from the user-requested foreground Drops action.
          } else {
            return {
              kind: 'transient-error',
              error: directRefresh.failure.message,
              errorKind: directRefresh.failure.kind,
              ...(directRefresh.failure.retryAfterMs === undefined
                ? {}
                : { retryAfterMs: directRefresh.failure.retryAfterMs }),
            };
          }
        }
      }
      const waitForRestoredTab = trigger === 'browser-start' || trigger === 'wake';
      const canOpenMissingSessionTab =
        trigger === 'popup-open' || trigger === 'extension-update' || trigger === 'manual-retry';
      const result = await dependencies.dropsPageRefresher.openDropsPageAndRefresh({
        active: foreground,
        isCurrent: execution.isCurrent,
        openIfMissing: foreground || (!dependencies.state.twitchSessionCache && canOpenMissingSessionTab),
        waitForExistingTabMs: waitForRestoredTab ? 10_000 : 0,
      });
      if (!result.success) {
        const error = result.error || 'Twitch campaign data is temporarily unavailable.';
        if (dependencies.state.twitchSessionCache) return transientError(error, 'network');
        return /open twitch|sign in|session/i.test(error)
          ? { kind: 'needs-session', errorKind: 'session' }
          : transientError(error, 'network');
      }
      if (!execution.isCurrent()) return transientError('Campaign sync was superseded.', 'network');
      await dependencies.automation.request('campaign-refresh');
      if (!execution.isCurrent()) return transientError('Campaign sync was superseded.', 'network');
      if (
        trigger === 'extension-update' &&
        dependencies.state.appState.wasRunning &&
        dependencies.state.appState.autoResumeOnStartup &&
        !dependencies.state.appState.isRunning &&
        dependencies.state.appState.selectedGame
      ) {
        const resumed = await dependencies.farmingSession.handleStartFarming(
          {
            game: dependencies.state.appState.selectedGame,
          },
          execution.isCurrent,
        );
        if (!execution.isCurrent()) return transientError('Campaign sync was superseded.', 'network');
        if (resumed.success) dependencies.state.appState.wasRunning = false;
      }
      return { kind: 'synced', campaignCount: result.gamesCount };
    } finally {
      releaseAutomationAbort();
      releaseFarmingSessionAbort();
    }
  };
}
