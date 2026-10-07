import { browser } from '../shared/browser-api.ts';
import { gameKey, getGameDisplayLabel, replaceAvailableGames } from '../shared/game-selection.ts';
import { isRewardAcquired } from '../shared/reward-semantics.ts';
import { isStreamerAcquisitionRecovery } from '../shared/runtime-status.ts';
import { autoClaimClaimableDrops } from './auto-claim.ts';
import { hasCompleteIdentifiedRewardSet } from './campaign-reward-identity.ts';
import { ALARM_NAME, PROGRESS_POLL_MS } from './constants.ts';
import { completedDropKeys, dropStateKey, projectDropsSnapshot } from './drops-projection.ts';
import {
  checkDropProgress as checkDropProgressCore,
  refreshDropsData as refreshDropsDataCore,
} from './drops-tick.ts';
import type { RefreshDropsOutcome } from './drops-tick-refresh.ts';
import type { FarmingSessionContext, RefreshDropsOptions } from './farming-session-context.ts';
import { logWarn } from './logging.ts';
import { queueCleanupNotification } from './queue-availability-cleanup-activity.ts';
import { normalizeQueueSelection } from './queue-operations.ts';
import { applyApiBackoffRecoveryState } from './recovery-state.ts';
import type { StalledProgressRecoveryResult, StalledProgressSource } from './stalled-progress-recovery.ts';
import type { StreamRotationReason } from './stream-rotation.ts';
import { computeEffectiveStallThreshold } from './stream-rotation.ts';
import { shouldKeepStreamerWhileDropProgresses } from './streamer-health-evaluation.ts';
import { resumeWatchObservation, watchObservationStartedAt } from './streamer-watch-attempt.ts';
import { hasVerifiedWatchPlayback, isTablessServiceFailure } from './watch-health.ts';

type FarmingSessionMonitoringDependencies = {
  readonly onRotateStreamerIfInvalid: (isCurrent?: () => boolean) => Promise<void>;
  readonly onRotateStreamerForTransportFailure: (
    reason: StreamRotationReason,
    isCurrent?: () => boolean,
  ) => Promise<void>;
  readonly onAcquireStreamerForSelectedGame: (isCurrent?: () => boolean) => Promise<boolean>;
  readonly onAdvanceQueueIfCompleted: () => Promise<boolean>;
  readonly onRecoverStalledProgress: (
    source: StalledProgressSource,
    isCurrent?: () => boolean,
  ) => Promise<StalledProgressRecoveryResult>;
};

function transportRotationReason(
  reason: import('../types/index.ts').WatchHealthReason,
): StreamRotationReason | null {
  switch (reason) {
    case 'stream-offline':
      return 'offline';
    case 'wrong-channel':
    case 'wrong-game':
    case 'drops-inactive':
      return reason;
    case 'playback-inactive':
    case 'heartbeat-failed':
    case 'error':
    case 'managed-tab-unavailable':
    case 'transport-disabled':
      return 'open-failed';
    default:
      return null;
  }
}

export type FarmingSessionMonitoring = {
  readonly checkDropProgress: () => Promise<void>;
  readonly refreshDropsData: (options?: RefreshDropsOptions) => Promise<RefreshDropsOutcome>;
  readonly startMonitoring: (immediate?: boolean) => void;
  readonly stopMonitoring: () => void;
};

export function createFarmingSessionMonitoring(
  context: FarmingSessionContext,
  dependencies: FarmingSessionMonitoringDependencies,
): FarmingSessionMonitoring {
  const { state, adapters } = context;

  async function tickWatchTransport(isCurrent: () => boolean): Promise<boolean> {
    // The retained tab still belongs to the previous watch while a campaign is parked.
    // Its old health must not start rotations or override the acquisition deadline.
    if (!state.appState.activeStreamer && isStreamerAcquisitionRecovery(state.appState.recoveryReason)) {
      return false;
    }
    if (state.appState.tabId !== null && state.preparingManagedTabIds.has(state.appState.tabId)) {
      return true;
    }
    const directive = await context.manualWatchController.reconcileTransport({
      target: state.appState.selectedGame,
      managedTabId: state.appState.tabId,
      preparingManagedTabIds: [...state.preparingManagedTabIds],
      automationActive: state.appState.isRunning && !state.appState.isPaused,
      transportSuspended: context.manualWatchTransportSuspended,
    });
    if (!isCurrent()) return false;
    switch (directive.kind) {
      case 'suspend':
        context.manualWatchTransportSuspended = true;
        if (state.appState.selectedGame) {
          const key = gameKey(state.appState.selectedGame);
          const metadata = state.appState.queueEntryMetadataByKey[key];
          if (metadata?.watchAttempt && metadata.watchAttempt.suspendedAt === undefined)
            state.appState.queueEntryMetadataByKey[key] = {
              ...metadata,
              watchAttempt: { ...metadata.watchAttempt, suspendedAt: context.now() },
            };
        }
        try {
          await adapters.watchTransport?.stop();
        } catch (error) {
          if (!(error instanceof Error)) throw error;
          logWarn('Manual watch transport suspension failed:', String(error));
        }
        if (!isCurrent()) return false;
        void Promise.resolve()
          .then(() =>
            adapters.automationNotify?.({
              transitionId: directive.transitionId,
              event: 'manual-suspended',
              campaignId: state.appState.selectedGame?.campaignId ?? 'manual-watch',
              title: 'Manual viewing detected',
              message: 'DropHunter paused automatic farming while you watch Twitch.',
              telegramReason: 'manual-suspended',
            }),
          )
          .catch(() => undefined);
        return false;
      case 'resume': {
        resumeWatchObservation(state, context.now());
        const activeStreamer = state.appState.activeStreamer;
        if (activeStreamer && state.appState.isRunning && !state.appState.isPaused) {
          try {
            await adapters.watchTransport?.start(activeStreamer, isCurrent);
          } catch (error) {
            if (!(error instanceof Error)) throw error;
            logWarn('Manual watch transport resume failed:', String(error));
            return false;
          }
        }
        if (!isCurrent()) return false;
        context.manualWatchTransportSuspended = false;
        void Promise.resolve()
          .then(() =>
            adapters.automationNotify?.({
              transitionId: directive.transitionId,
              event: 'manual-resumed',
              campaignId: state.appState.selectedGame?.campaignId ?? 'manual-watch',
              title: 'Automatic farming resumed',
              message: 'DropHunter resumed automatic farming after your Twitch viewing ended.',
              telegramReason: 'manual-resumed',
            }),
          )
          .catch(() => undefined);
        return false;
      }
      case 'unchanged':
        if (context.manualWatchTransportSuspended) {
          return false;
        }
        break;
      default: {
        const unreachable: never = directive;
        throw new DOMException(`Unexpected transport directive: ${String(unreachable)}`, 'InvariantError');
      }
    }

    if (!state.appState.activeStreamer && state.appState.selectedGame) {
      if (state.apiBackoffUntil > context.now()) {
        applyApiBackoffRecoveryState(state);
        await adapters.saveState(state);
      }
      return false;
    }
    const wasWaitingForPlayback = state.appState.watchHealth?.reason === 'user-interaction-required';
    const health = await adapters.watchTransport?.tick(isCurrent);
    if (!isCurrent()) return false;
    if (health) state.appState.watchHealth = health;
    if (health?.reason === 'user-interaction-required') return false;
    const key = state.appState.selectedGame ? gameKey(state.appState.selectedGame) : null;
    const metadata = key ? state.appState.queueEntryMetadataByKey[key] : undefined;
    if (
      key &&
      metadata?.watchAttempt &&
      isTablessServiceFailure(health) &&
      metadata.watchAttempt.suspendedAt === undefined
    ) {
      state.appState.queueEntryMetadataByKey[key] = {
        ...metadata,
        watchAttempt: { ...metadata.watchAttempt, suspendedAt: context.now() },
      };
      await adapters.saveState(state);
    } else if (
      health?.mode === 'tabless' &&
      !isTablessServiceFailure(health) &&
      ['healthy', 'degraded', 'failed'].includes(health.status) &&
      metadata?.watchAttempt?.suspendedAt !== undefined
    ) {
      resumeWatchObservation(state, context.now());
      await adapters.saveState(state);
    }
    if (!isCurrent()) return false;
    if (
      wasWaitingForPlayback &&
      hasVerifiedWatchPlayback(health) &&
      metadata?.watchAttempt &&
      metadata.watchAttempt.firstPlaybackAt === undefined &&
      key
    ) {
      state.appState.queueEntryMetadataByKey[key] = {
        ...metadata,
        watchAttempt: { ...metadata.watchAttempt, firstPlaybackAt: context.now() },
      };
      state.invalidStreamChecks = 0;
      state.streamValidationGraceUntil =
        context.now() + computeEffectiveStallThreshold(state.appState.currentDrop?.requiredMinutes);
    }
    return false;
  }

  async function evaluateDropTransitions(previousCompletedKeys: Set<string>): Promise<void> {
    const nowCompletedKeys = completedDropKeys(state.appState.completedDrops);
    const newlyCompleted = state.appState.completedDrops.filter(
      (drop) => isRewardAcquired(drop) && !previousCompletedKeys.has(dropStateKey(drop)),
    );
    for (const drop of newlyCompleted) {
      void Promise.resolve()
        .then(() => adapters.sendAlert('drop-complete', `Reward unlocked: ${drop.name}`))
        .catch(() => undefined);
    }

    const hasDrops = state.appState.allDrops.length > 0;
    const allCompleted =
      hasDrops &&
      state.appState.selectedGame !== null &&
      hasCompleteIdentifiedRewardSet(state.appState.selectedGame, state.appState.allDrops, true) &&
      state.appState.allDrops.every(isRewardAcquired);
    if (allCompleted && !state.appState.completionNotified) {
      const selectedGame = state.appState.selectedGame;
      const campaign = selectedGame ? getGameDisplayLabel(selectedGame) : 'this campaign';
      state.appState.completionNotified = true;
      const message = `All rewards for ${campaign} are complete.`;
      if (adapters.automationNotify) {
        // Persist the state transition before delivery. A restarted MV3 worker can
        // then retry only a channel whose delivery did not succeed.
        await adapters.saveState(state);
        void Promise.resolve()
          .then(() =>
            adapters.automationNotify?.({
              transitionId: `campaign-complete:${selectedGame?.campaignId ?? 'current-campaign'}:${[
                ...nowCompletedKeys,
              ]
                .sort()
                .join(',')}`,
              event: 'completion',
              campaignId: selectedGame?.campaignId ?? 'current-campaign',
              title: 'Campaign complete',
              message,
              telegramReason: 'campaign-complete',
            }),
          )
          .catch(() => undefined);
      } else {
        void Promise.resolve()
          .then(() => adapters.sendAlert('all-complete', message))
          .catch(() => undefined);
      }
    }
    if (nowCompletedKeys.size < previousCompletedKeys.size) {
      state.appState.completionNotified = false;
    }
  }

  async function claimAvailableDrops(): Promise<boolean> {
    return autoClaimClaimableDrops(state, () => adapters.ensureTwitchSession());
  }

  async function refreshDropsData(options: RefreshDropsOptions = {}): Promise<RefreshDropsOutcome> {
    return refreshDropsDataCore(
      state,
      options,
      {
        onFetchDropsSnapshotFromApi: adapters.fetchDropsSnapshotFromApi,
        onFetchInventorySnapshotFromApi: adapters.fetchInventorySnapshotFromApi,
        onEvaluateDropTransitions: evaluateDropTransitions,
        onSaveState: adapters.saveState,
        onQueueCampaignsRemoved: async (result) => {
          const notification = queueCleanupNotification(result);
          void Promise.resolve()
            .then(() =>
              adapters.automationNotify?.({
                transitionId: notification.transitionId,
                event: 'queue-cleanup',
                campaignId: 'queue',
                telegramReason: 'queue-cleanup',
                title: 'Queue updated',
                message: notification.message,
              }),
            )
            .catch(() => undefined);
        },
      },
      {
        replaceAvailableGames,
        getGameDisplayLabel,
        projectDropsSnapshot,
        normalizeQueueSelection,
      },
    );
  }

  async function checkDropProgress(): Promise<void> {
    const initPromise = adapters.getInitPromise();
    if (initPromise) {
      await initPromise;
    }
    await checkDropProgressCore(state, {
      onEnforcePlaybackPolicy: adapters.enforcePlaybackPolicyOnStreamTab,
      onRotateStreamerIfInvalid: async (isCurrent) => {
        if (context.manualWatchTransportSuspended) return;
        const health = state.appState.watchHealth;
        if (isTablessServiceFailure(health)) return;
        if (health?.reason === 'stream-offline') {
          await dependencies.onRotateStreamerForTransportFailure('offline', isCurrent);
          return;
        }
        if (health && hasVerifiedWatchPlayback(health)) state.offlineChecks = 0;
        if (health?.shouldFallback) {
          const reason = transportRotationReason(health.reason);
          const protectedManagedWatch =
            health.mode === 'managed-tab' &&
            (context.now() < state.streamValidationGraceUntil ||
              shouldKeepStreamerWhileDropProgresses({
                currentDrop: state.appState.currentDrop,
                lastProgressAdvanceAt: state.lastProgressAdvanceAt,
                now: context.now(),
                effectiveThresholdMs: computeEffectiveStallThreshold(
                  state.appState.currentDrop?.requiredMinutes,
                ),
                reason,
              }));
          if (reason && !protectedManagedWatch) {
            await dependencies.onRotateStreamerForTransportFailure(reason, isCurrent);
            return;
          }
        }
        if (health?.status === 'not-started' && !state.appState.tabId && state.appState.selectedGame) {
          await dependencies.onAcquireStreamerForSelectedGame(isCurrent);
          return;
        }
        const observedAt = watchObservationStartedAt(state);
        if (
          state.appState.activeStreamer &&
          observedAt > 0 &&
          context.now() - observedAt >=
            computeEffectiveStallThreshold(state.appState.currentDrop?.requiredMinutes)
        ) {
          await dependencies.onRecoverStalledProgress(
            state.appState.watchTransportPreference === 'tabless'
              ? { kind: 'tabless' }
              : { kind: 'managed-tab', tabId: state.appState.tabId ?? 0 },
            isCurrent,
          );
          return;
        }
        await dependencies.onRotateStreamerIfInvalid(isCurrent);
      },
      onAcquireStreamerForSelectedGame: dependencies.onAcquireStreamerForSelectedGame,
      onAttemptAutoClaimChannelPointsBonus: adapters.attemptAutoClaimChannelPointsBonus,
      onRefreshDropsData: refreshDropsData,
      onWatchTransportTick: tickWatchTransport,
      onAutoClaimClaimableDrops: claimAvailableDrops,
      onAdvanceQueueIfCompleted: dependencies.onAdvanceQueueIfCompleted,
      onSaveTimingState: adapters.saveTimingState,
    });
  }

  function startMonitoring(immediate = false): void {
    const periodInMinutes = Math.max(0.5, PROGRESS_POLL_MS / 60_000);
    if (immediate) browser.alarms.create(ALARM_NAME, { when: Date.now() + 1, periodInMinutes });
    else browser.alarms.create(ALARM_NAME, { periodInMinutes });
  }

  function stopMonitoring(): void {
    browser.alarms.clear(ALARM_NAME).catch(() => undefined);
  }

  return { checkDropProgress, refreshDropsData, startMonitoring, stopMonitoring };
}
