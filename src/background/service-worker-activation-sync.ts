import type { ActivationTrigger } from '../types/index.ts';
import { hasInterruptedQueue, resumeInterruptedQueue } from './activation-queue-resume.ts';
import type { ActivationSyncAttempt, ActivationSyncExecution } from './activation-sync-coordinator.ts';
import type { createDropsPageRefresher, DropsPageRefreshResult } from './drops-page-refresh.ts';
import type { FarmingAutomation } from './farming-automation.ts';
import type { createFarmingSession } from './farming-session.ts';
import { invalidateFarmingSessionEpoch } from './farming-session-revision.ts';
import type { RefreshGamesCacheOptions } from './games-cache-orchestration.ts';
import type { GamesCacheRefreshResult } from './games-cache-refresh-state.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { withRecoveryTimeout } from './session-recovery-lifecycle.ts';
import { classifyTwitchApiFailure, type TwitchApiFailure } from './twitch-api/errors.ts';

type FarmingSession = Pick<
  ReturnType<typeof createFarmingSession>,
  'acquireStreamerForSelectedGame' | 'advanceQueueIfCompleted' | 'handleStartFarming'
>;
type DropsPageRefresher = Pick<ReturnType<typeof createDropsPageRefresher>, 'openDropsPageAndRefresh'>;
type RefreshGamesCache = (options: RefreshGamesCacheOptions) => Promise<GamesCacheRefreshResult>;

interface ActivationSyncDependencies {
  readonly automation: FarmingAutomation;
  readonly clearQueueCompleteNotification?: () => Promise<void>;
  readonly dropsPageRefresher: DropsPageRefresher;
  readonly farmingSession: FarmingSession;
  readonly refreshGamesCache: RefreshGamesCache;
  readonly state: ServiceWorkerState;
  readonly hasCompletedOnboarding?: () => Promise<boolean>;
  readonly browserIntegrityTimeoutMs?: number;
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

async function verifyBrowserIntegrity(
  dependencies: ActivationSyncDependencies,
  execution: ActivationSyncExecution,
): Promise<DropsPageRefreshResult | null> {
  const timeoutMs = dependencies.browserIntegrityTimeoutMs ?? 30_000;
  const deadline = Date.now() + timeoutMs;
  let current = true;
  await execution.markBrowserVerificationAttempted?.();
  if (!execution.isCurrent()) return null;
  try {
    return await withRecoveryTimeout(
      dependencies.dropsPageRefresher
        .openDropsPageAndRefresh({
          active: false,
          openIfMissing: true,
          isCurrent: () => current && Date.now() < deadline && execution.isCurrent(),
        })
        .catch((error: unknown) => ({
          success: false,
          opened: false,
          refreshed: false,
          gamesCount: 0,
          failure: classifyTwitchApiFailure(error),
        })),
      timeoutMs,
      () => {
        current = false;
      },
    );
  } finally {
    current = false;
  }
}

function unavailableVerification(failure: TwitchApiFailure | undefined): ActivationSyncAttempt {
  if (failure?.kind === 'integrity' || failure?.kind === 'auth')
    return { kind: 'needs-session', errorKind: failure.kind };
  return {
    kind: 'transient-error',
    error: failure?.message ?? 'Twitch browser verification could not complete.',
    errorKind: failure?.kind ?? 'network',
    ...(failure?.retryAfterMs === undefined ? {} : { retryAfterMs: failure.retryAfterMs }),
  };
}

export function createServiceWorkerActivationSync(dependencies: ActivationSyncDependencies) {
  return async (
    trigger: ActivationTrigger,
    execution: ActivationSyncExecution,
  ): Promise<ActivationSyncAttempt> => {
    const releaseAutomationAbort = invalidateAutomationOnAbort(execution, dependencies.automation);
    const releaseFarmingSessionAbort = invalidateFarmingSessionOnAbort(execution, dependencies.state);
    try {
      const deferValidationUntilResume = hasInterruptedQueue(dependencies.state);
      const foreground = trigger === 'manual';
      const retry = trigger === 'manual-retry';
      const canRecoverSessionAfterOnboarding =
        trigger === 'popup-open' ||
        trigger === 'browser-start' ||
        trigger === 'wake' ||
        trigger === 'extension-update';
      let needsBrowserIntegrityVerification = false;
      let canOpenMissingSessionTab = false;
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
            if (directRefresh.inventoryVerified === true) {
              if (!deferValidationUntilResume)
                await execution.confirmCampaignValidation?.(directRefresh.games.length);
              if (!execution.isCurrent()) return transientError('Campaign sync was superseded.', 'network');
              dependencies.state.hasCurrentGenerationCampaignValidation = true;
              if (dependencies.state.appState.isRunning || dependencies.state.appState.queue.length > 0) {
                await dependencies.clearQueueCompleteNotification?.();
                if (!execution.isCurrent()) return transientError('Campaign sync was superseded.', 'network');
              }
            }
            await dependencies.automation.request('campaign-refresh');
            if (!execution.isCurrent()) return transientError('Campaign sync was superseded.', 'network');
            if (directRefresh.inventoryVerified === true) {
              await dependencies.farmingSession.advanceQueueIfCompleted();
              if (!execution.isCurrent()) return transientError('Campaign sync was superseded.', 'network');
              const resumed = await resumeInterruptedQueue(
                dependencies.state,
                dependencies.farmingSession,
                execution,
              );
              if (!execution.isCurrent()) return transientError('Campaign sync was superseded.', 'network');
              if (!resumed) return transientError('Campaign rewards require validation.', 'invalid-response');
              if (deferValidationUntilResume)
                await execution.confirmCampaignValidation?.(directRefresh.games.length);
              if (!execution.isCurrent()) return transientError('Campaign sync was superseded.', 'network');
            }
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
          if (
            !dependencies.state.twitchSessionCache &&
            canRecoverSessionAfterOnboarding &&
            (await dependencies.hasCompletedOnboarding?.()) === true
          ) {
            canOpenMissingSessionTab = true;
          }
          if (directRefresh.failure.kind === 'auth' && !retry) {
            if (!canOpenMissingSessionTab) return { kind: 'needs-session', errorKind: 'auth' };
          }
          if (directRefresh.failure.kind === 'auth') {
            // Retry now may recover a session in a hidden Drops tab. It must
            // remain distinct from the user-requested foreground Drops action.
          } else if (directRefresh.failure.kind === 'integrity') {
            if (
              dependencies.hasCompletedOnboarding &&
              !dependencies.state.twitchSessionCache &&
              !canOpenMissingSessionTab
            )
              return { kind: 'needs-session', errorKind: 'integrity' };
            if (dependencies.state.appState.campaignSyncState.browserVerificationAttempted && !retry)
              return unavailableVerification(directRefresh.failure);
            needsBrowserIntegrityVerification = true;
          } else if (!canOpenMissingSessionTab) {
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
        if (
          directRefresh.kind === 'unavailable' &&
          !directRefresh.failure &&
          !dependencies.state.twitchSessionCache &&
          canRecoverSessionAfterOnboarding
        ) {
          canOpenMissingSessionTab = (await dependencies.hasCompletedOnboarding?.()) === true;
        }
      }
      const waitForRestoredTab = trigger === 'browser-start' || trigger === 'wake';
      if (retry) canOpenMissingSessionTab = true;
      const result = needsBrowserIntegrityVerification
        ? await verifyBrowserIntegrity(dependencies, execution)
        : await dependencies.dropsPageRefresher.openDropsPageAndRefresh({
            active: foreground,
            isCurrent: execution.isCurrent,
            openIfMissing: foreground || (!dependencies.state.twitchSessionCache && canOpenMissingSessionTab),
            waitForExistingTabMs: waitForRestoredTab ? 10_000 : 0,
          });
      if (!execution.isCurrent()) return transientError('Campaign sync was superseded.', 'network');
      if (needsBrowserIntegrityVerification && result?.inventoryVerified !== true)
        return unavailableVerification(result?.failure);
      if (!result?.success) {
        const error = result?.error || 'Twitch campaign data is temporarily unavailable.';
        if (dependencies.state.twitchSessionCache) return transientError(error, 'network');
        return /open twitch|sign in|session/i.test(error)
          ? { kind: 'needs-session', errorKind: 'session' }
          : transientError(error, 'network');
      }
      if (!execution.isCurrent()) return transientError('Campaign sync was superseded.', 'network');
      if (result.inventoryVerified === true) {
        if (!deferValidationUntilResume) await execution.confirmCampaignValidation?.(result.gamesCount);
        if (!execution.isCurrent()) return transientError('Campaign sync was superseded.', 'network');
        dependencies.state.hasCurrentGenerationCampaignValidation = true;
      }
      await dependencies.automation.request('campaign-refresh');
      if (!execution.isCurrent()) return transientError('Campaign sync was superseded.', 'network');
      if (result.inventoryVerified === true) {
        const resumed = await resumeInterruptedQueue(
          dependencies.state,
          dependencies.farmingSession,
          execution,
        );
        if (!execution.isCurrent()) return transientError('Campaign sync was superseded.', 'network');
        if (!resumed) return transientError('Campaign rewards require validation.', 'invalid-response');
        if (deferValidationUntilResume) await execution.confirmCampaignValidation?.(result.gamesCount);
        if (!execution.isCurrent()) return transientError('Campaign sync was superseded.', 'network');
      }
      return { kind: 'synced', campaignCount: result.gamesCount };
    } finally {
      releaseAutomationAbort();
      releaseFarmingSessionAbort();
    }
  };
}
