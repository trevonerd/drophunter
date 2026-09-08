import { browser } from '../shared/browser-api.ts';
import { gameKey, getGameDisplayLabel, replaceAvailableGames } from '../shared/game-selection.ts';
import { autoClaimClaimableDrops } from './auto-claim.ts';
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

type FarmingSessionMonitoringDependencies = {
  readonly onRotateStreamerIfInvalid: (isCurrent?: () => boolean) => Promise<void>;
  readonly onAcquireStreamerForSelectedGame: (isCurrent?: () => boolean) => Promise<boolean>;
  readonly onAdvanceQueueIfCompleted: () => Promise<boolean>;
  readonly onRecoverStalledProgress: (
    source: StalledProgressSource,
    isCurrent?: () => boolean,
  ) => Promise<StalledProgressRecoveryResult>;
};

export type FarmingSessionMonitoring = {
  readonly checkDropProgress: () => Promise<void>;
  readonly refreshDropsData: (options?: RefreshDropsOptions) => Promise<RefreshDropsOutcome>;
  readonly startMonitoring: () => void;
  readonly stopMonitoring: () => void;
};

export function createFarmingSessionMonitoring(
  context: FarmingSessionContext,
  dependencies: FarmingSessionMonitoringDependencies,
): FarmingSessionMonitoring {
  const { state, adapters } = context;

  async function tickWatchTransport(isCurrent: () => boolean): Promise<boolean> {
    const directive = await context.manualWatchController.reconcileTransport({
      target: state.appState.selectedGame,
      managedTabId: state.appState.tabId,
      automationActive: state.appState.isRunning && !state.appState.isPaused,
      transportSuspended: context.manualWatchTransportSuspended,
    });
    if (!isCurrent()) return false;
    switch (directive.kind) {
      case 'suspend':
        context.manualWatchTransportSuspended = true;
        try {
          await adapters.watchTransport?.stop();
        } catch (error) {
          if (!(error instanceof Error)) throw error;
          logWarn('Manual watch transport suspension failed:', String(error));
        }
        if (!isCurrent()) return false;
        await adapters.automationNotify?.({
          transitionId: directive.transitionId,
          event: 'manual-suspended',
          campaignId: state.appState.selectedGame?.campaignId ?? 'manual-watch',
          title: 'Manual viewing detected',
          message: 'DropHunter paused automatic farming while you watch Twitch.',
          telegramReason: 'manual-suspended',
        });
        return false;
      case 'resume': {
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
        await adapters.automationNotify?.({
          transitionId: directive.transitionId,
          event: 'manual-resumed',
          campaignId: state.appState.selectedGame?.campaignId ?? 'manual-watch',
          title: 'Automatic farming resumed',
          message: 'DropHunter resumed automatic farming after your Twitch viewing ended.',
          telegramReason: 'manual-resumed',
        });
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

    const health = await adapters.watchTransport?.tick(isCurrent);
    if (!isCurrent()) return false;
    const stalledRecoveryDue =
      state.appState.recoveryReason === 'stalled-progress' && context.now() >= state.recoveryBackoffUntil;
    const tablessStallDetected =
      health?.mode === 'tabless' && health.reason === 'stalled-progress' && health.shouldFallback;
    const tablessRecoveryDue =
      stalledRecoveryDue &&
      state.appState.tabId === null &&
      (health?.mode === 'tabless' || state.appState.watchTransportMode === 'tabless');
    if (tablessStallDetected || tablessRecoveryDue) {
      const result = await dependencies.onRecoverStalledProgress({ kind: 'tabless' }, isCurrent);
      return result.kind === 'selection-changed';
    }
    if (stalledRecoveryDue && state.appState.tabId) {
      const result = await dependencies.onRecoverStalledProgress(
        {
          kind: 'managed-tab',
          tabId: state.appState.tabId,
        },
        isCurrent,
      );
      return result.kind === 'selection-changed';
    }
    const transportMissing =
      health?.status === 'not-started' &&
      state.appState.selectedGame !== null &&
      state.appState.tabId === null;
    if (!transportMissing && (health?.mode !== 'managed-tab' || !health.shouldFallback)) {
      return false;
    }
    if (health?.reason === 'stalled-progress' && state.appState.tabId) {
      const result = await dependencies.onRecoverStalledProgress(
        {
          kind: 'managed-tab',
          tabId: state.appState.tabId,
        },
        isCurrent,
      );
      return result.kind === 'selection-changed';
    }
    const previousCampaignKey = state.appState.selectedGame ? gameKey(state.appState.selectedGame) : null;
    if (state.apiBackoffUntil > context.now()) {
      applyApiBackoffRecoveryState(state);
      await adapters.saveState(state);
    } else if (context.now() >= state.recoveryBackoffUntil) {
      await dependencies.onAcquireStreamerForSelectedGame(isCurrent);
    }
    return (
      previousCampaignKey !== (state.appState.selectedGame ? gameKey(state.appState.selectedGame) : null)
    );
  }

  async function evaluateDropTransitions(previousCompletedKeys: Set<string>): Promise<void> {
    const nowCompletedKeys = completedDropKeys(state.appState.completedDrops);
    const newlyCompleted = state.appState.completedDrops.filter(
      (drop) => !previousCompletedKeys.has(dropStateKey(drop)),
    );
    for (const drop of newlyCompleted) {
      await adapters.sendAlert('drop-complete', `Reward unlocked: ${drop.name}`);
    }

    const hasDrops = state.appState.allDrops.length > 0;
    const allCompleted =
      hasDrops && state.appState.pendingDrops.length === 0 && state.appState.currentDrop === null;
    if (allCompleted && !state.appState.completionNotified) {
      const selectedGame = state.appState.selectedGame;
      const campaign = selectedGame ? getGameDisplayLabel(selectedGame) : 'this campaign';
      state.appState.completionNotified = true;
      const message = `All rewards for ${campaign} are complete.`;
      if (adapters.automationNotify) {
        // Persist the state transition before delivery. A restarted MV3 worker can
        // then retry only a channel whose delivery did not succeed.
        await adapters.saveState(state);
        await adapters.automationNotify({
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
        });
      } else {
        await adapters.sendAlert('all-complete', message);
      }
    }
    if (nowCompletedKeys.size < previousCompletedKeys.size) {
      state.appState.completionNotified = false;
    }
  }

  async function claimAvailableDrops(): Promise<boolean> {
    return autoClaimClaimableDrops(
      state,
      () => adapters.ensureTwitchSession(),
      (drop) => adapters.sendAlert('drop-complete', `Claimed: ${drop.name} (${drop.gameName})`),
    );
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
          await adapters.automationNotify?.({
            transitionId: notification.transitionId,
            event: 'queue-cleanup',
            campaignId: 'queue',
            telegramReason: 'queue-cleanup',
            title: 'Queue updated',
            message: notification.message,
          });
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
      onRotateStreamerIfInvalid: dependencies.onRotateStreamerIfInvalid,
      onAcquireStreamerForSelectedGame: dependencies.onAcquireStreamerForSelectedGame,
      onAttemptAutoClaimChannelPointsBonus: adapters.attemptAutoClaimChannelPointsBonus,
      onRefreshDropsData: refreshDropsData,
      onWatchTransportTick: tickWatchTransport,
      onAutoClaimClaimableDrops: claimAvailableDrops,
      onAdvanceQueueIfCompleted: dependencies.onAdvanceQueueIfCompleted,
      onSaveTimingState: adapters.saveTimingState,
    });
  }

  function startMonitoring(): void {
    browser.alarms.create(ALARM_NAME, { periodInMinutes: Math.max(0.5, PROGRESS_POLL_MS / 60_000) });
  }

  function stopMonitoring(): void {
    browser.alarms.clear(ALARM_NAME).catch(() => undefined);
  }

  return { checkDropProgress, refreshDropsData, startMonitoring, stopMonitoring };
}
