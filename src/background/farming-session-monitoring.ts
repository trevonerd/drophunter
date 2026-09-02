import { browser } from '../shared/browser-api.ts';
import { getGameDisplayLabel, replaceAvailableGames } from '../shared/game-selection.ts';
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
import { normalizeQueueSelection } from './queue-operations.ts';
import type { StalledProgressRecoveryResult, StalledProgressSource } from './stalled-progress-recovery.ts';

type FarmingSessionMonitoringDependencies = {
  readonly onRotateStreamerIfInvalid: () => Promise<void>;
  readonly onAcquireStreamerForSelectedGame: () => Promise<boolean>;
  readonly onAdvanceQueueIfCompleted: () => Promise<boolean>;
  readonly onHandleRecoverySkip: () => Promise<void>;
  readonly onRecoverStalledProgress: (
    source: StalledProgressSource,
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

  async function tickWatchTransport(): Promise<boolean> {
    const directive = await context.manualWatchController.reconcileTransport({
      target: state.appState.selectedGame,
      managedTabId: state.appState.tabId,
      automationActive: state.appState.isRunning && !state.appState.isPaused,
      transportSuspended: context.manualWatchTransportSuspended,
    });
    switch (directive) {
      case 'suspend':
        context.manualWatchTransportSuspended = true;
        try {
          await adapters.watchTransport?.stop();
        } catch (error) {
          logWarn('Manual watch transport suspension failed:', String(error));
        }
        return false;
      case 'resume': {
        const activeStreamer = state.appState.activeStreamer;
        if (activeStreamer && state.appState.isRunning && !state.appState.isPaused) {
          try {
            await adapters.watchTransport?.start(activeStreamer);
          } catch (error) {
            logWarn('Manual watch transport resume failed:', String(error));
            return false;
          }
        }
        context.manualWatchTransportSuspended = false;
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

    const health = await adapters.watchTransport?.tick();
    const stalledRecoveryDue =
      state.appState.recoveryReason === 'stalled-progress' && context.now() >= state.recoveryBackoffUntil;
    const tablessStallDetected =
      health?.mode === 'tabless' && health.reason === 'stalled-progress' && health.shouldFallback;
    const tablessRecoveryDue =
      stalledRecoveryDue && (health?.mode === 'tabless' || state.appState.watchTransportMode === 'tabless');
    if (tablessStallDetected || tablessRecoveryDue) {
      const result = await dependencies.onRecoverStalledProgress({ kind: 'tabless' });
      return result.kind === 'selection-changed';
    }
    if (stalledRecoveryDue && state.appState.tabId) {
      const result = await dependencies.onRecoverStalledProgress({
        kind: 'managed-tab',
        tabId: state.appState.tabId,
      });
      return result.kind === 'selection-changed';
    }
    if (health?.mode !== 'managed-tab' || !health.shouldFallback) {
      return false;
    }
    if (health.reason === 'stalled-progress' && state.appState.tabId) {
      const result = await dependencies.onRecoverStalledProgress({
        kind: 'managed-tab',
        tabId: state.appState.tabId,
      });
      return result.kind === 'selection-changed';
    }
    await dependencies.onHandleRecoverySkip();
    return true;
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
      const campaign = state.appState.selectedGame
        ? getGameDisplayLabel(state.appState.selectedGame)
        : 'this campaign';
      await adapters.sendAlert('all-complete', `All rewards for ${campaign} are complete.`);
      state.appState.completionNotified = true;
    }
    if (nowCompletedKeys.size < previousCompletedKeys.size) {
      state.appState.completionNotified = false;
    }
  }

  async function claimAvailableDrops(): Promise<boolean> {
    return autoClaimClaimableDrops(
      state,
      () => adapters.ensureTwitchSession(),
      async (drop) => {
        await adapters.sendAlert('drop-complete', `Claimed: ${drop.name} (${drop.gameName})`);
      },
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
    const apiBackoffActive = state.apiBackoffUntil > Date.now();
    if (apiBackoffActive) {
      await tickWatchTransport();
    }
    await checkDropProgressCore(state, {
      onEnforcePlaybackPolicy: adapters.enforcePlaybackPolicyOnStreamTab,
      onRotateStreamerIfInvalid: dependencies.onRotateStreamerIfInvalid,
      onAcquireStreamerForSelectedGame: dependencies.onAcquireStreamerForSelectedGame,
      onAttemptAutoClaimChannelPointsBonus: adapters.attemptAutoClaimChannelPointsBonus,
      onRefreshDropsData: refreshDropsData,
      onWatchTransportTick: apiBackoffActive ? undefined : tickWatchTransport,
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
