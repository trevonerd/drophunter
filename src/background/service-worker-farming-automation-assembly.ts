import { gameKey } from '../shared/game-selection.ts';
import { recordAutomationActivity } from './automation-activity.ts';
import { initializeFarmingAutomationLifecycle } from './extension-lifecycle.ts';
import { createFarmingAutomation } from './farming-automation.ts';
import { createFarmingAutomationBrowser } from './farming-automation-browser.ts';
import type {
  FarmingAutomation,
  FarmingAutomationOutcome,
  FarmingAutomationPersistenceWrite,
  FarmingSessionTransitionReceiptV1,
  WatchOwnershipV1,
} from './farming-automation-contracts.ts';
import {
  createFarmingAutomationManualWatch,
  type FarmingAutomationManualWatchController,
} from './farming-automation-manual-watch.ts';
import { createChromeFarmingAutomationPersistence } from './farming-automation-persistence.ts';
import {
  type FarmingAutomationRecoveryResult,
  reconcileFarmingAutomationRecovery,
} from './farming-automation-recovery.ts';
import { createFarmingAutomationTwitchAdapter } from './farming-automation-twitch.ts';
import { currentFarmingSessionEpoch } from './farming-session-revision.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import type { createServiceWorkerBrowserEvents } from './service-worker-browser-events.ts';
import type { createServiceWorkerTwitchGateway } from './service-worker-twitch-gateway.ts';
import { broadcastStateUpdate, saveState } from './state-persistence.ts';
import { waitForTabComplete } from './tab-management.ts';

type BrowserEvents = Pick<
  ReturnType<typeof createServiceWorkerBrowserEvents>,
  'prepareStreamPlayback' | 'watchTransport'
>;
type TwitchGateway = Pick<
  ReturnType<typeof createServiceWorkerTwitchGateway>,
  | 'ensureTwitchSession'
  | 'fetchDirectoryStreamers'
  | 'fetchDropsSnapshot'
  | 'getLatestProgressSnapshot'
  | 'fetchInventorySnapshot'
  | 'fetchStreamContext'
  | 'heartbeat'
>;

export interface ServiceWorkerFarmingAutomationAssemblyDependencies {
  readonly browserEvents: BrowserEvents;
  readonly startMonitoring: () => void;
  readonly twitchGateway: TwitchGateway;
  readonly telegramNotify?: (reason: string, message: string) => Promise<void>;
}

export interface ServiceWorkerFarmingAutomationAssembly {
  readonly automation: FarmingAutomation;
  readonly manualWatch: FarmingAutomationManualWatchController;
}

export async function assembleServiceWorkerFarmingAutomation(
  state: ServiceWorkerState,
  dependencies: ServiceWorkerFarmingAutomationAssemblyDependencies,
): Promise<ServiceWorkerFarmingAutomationAssembly> {
  const persistence = createChromeFarmingAutomationPersistence({
    state,
    getSessionRevision: () => String(currentFarmingSessionEpoch(state)),
    broadcast: broadcastStateUpdate,
  });
  const receiptRead = await persistence.loadReceipt();
  let currentOwnership: WatchOwnershipV1 | null = null;
  switch (receiptRead.kind) {
    case 'failed':
      break;
    case 'ready': {
      const selectedKey = state.appState.selectedGame ? gameKey(state.appState.selectedGame) : null;
      if (state.appState.isRunning && receiptRead.value?.toCampaignKey === selectedKey) {
        currentOwnership = receiptRead.value.toWatch;
      }
      break;
    }
    default:
      receiptRead satisfies never;
  }
  if (currentOwnership) await dependencies.browserEvents.watchTransport.restore(currentOwnership);

  const automationBrowser = createFarmingAutomationBrowser({
    watchRuntime: dependencies.browserEvents.watchTransport,
    getManualStreamContext: dependencies.twitchGateway.fetchStreamContext,
    watch: {
      tablessEnabled: true,
      heartbeat: dependencies.twitchGateway.heartbeat,
      waitForTabComplete,
      preparePlayback: dependencies.browserEvents.prepareStreamPlayback,
      probeManaged: async (ownership, target) => {
        const context = await dependencies.twitchGateway.fetchStreamContext(ownership.tabId);
        const sameChannel = context?.channelName.toLowerCase() === target.channelName.toLowerCase();
        const sameGame = target.categorySlug !== undefined && context?.categorySlug === target.categorySlug;
        return {
          accepted: context !== null && sameChannel && sameGame && context.isPlaybackReady === true,
          isLive: context?.isLive,
          sameChannel,
          sameGame,
          hasDropsSignal: context?.hasDropsSignal,
          reason: !context
            ? 'heartbeat-failed'
            : !sameChannel
              ? 'wrong-channel'
              : !sameGame
                ? 'wrong-game'
                : context.isPlaybackReady !== true
                  ? 'playback-inactive'
                  : 'heartbeat',
        };
      },
    },
  });
  const twitch = createFarmingAutomationTwitchAdapter({
    loadSession: dependencies.twitchGateway.ensureTwitchSession,
    fetchCampaignSnapshot: async () =>
      dependencies.twitchGateway.getLatestProgressSnapshot() ??
      (await dependencies.twitchGateway.fetchDropsSnapshot()),
    campaignSnapshotIncludesInventory: (snapshot) => snapshot.inventoryVerified === true,
    fetchInventorySnapshot: (_session, baseDrops) =>
      dependencies.twitchGateway.fetchInventorySnapshot([...baseDrops]),
    fetchDirectoryStreamers: async (game, _session, language) => {
      const streamers = await dependencies.twitchGateway.fetchDirectoryStreamers(game, false, language);
      return { streamers, languageFilterApplied: streamers.languageFilterApplied };
    },
  });
  const manualWatch = createFarmingAutomationManualWatch({
    persistence,
    observeManualTabs: automationBrowser.observeManualTabs,
    replaceDeadline: automationBrowser.replaceDeadlineAlarm,
  });
  const repairActivity = async (
    receipt: FarmingSessionTransitionReceiptV1,
  ): Promise<FarmingAutomationPersistenceWrite> => {
    const id = `farming-transition:${receipt.attemptId}`;
    if (state.appState.automationActivity.some((entry) => entry.id === id)) {
      return { kind: 'written' };
    }
    const previousActivity = structuredClone(state.appState.automationActivity);
    const previousMessage = state.appState.lastAutomationMessage;
    const game = state.appState.selectedGame;
    recordAutomationActivity(state.appState, {
      id,
      kind: receipt.transition === 'preemption' ? 'preempted' : 'auto-started',
      at: receipt.committedAt,
      campaignId: game?.campaignId,
      message: game ? `${game.name} started automatically.` : 'Farming started automatically.',
    });
    try {
      await saveState(state);
      return { kind: 'written' };
    } catch (error) {
      state.appState.automationActivity = previousActivity;
      state.appState.lastAutomationMessage = previousMessage;
      if (!(error instanceof Error)) throw error;
      return { kind: 'failed', reason: 'storage-unavailable' };
    }
  };
  const recover = (): Promise<FarmingAutomationRecoveryResult> =>
    reconcileFarmingAutomationRecovery({
      persistence,
      currentCampaignKey: () => (state.appState.selectedGame ? gameKey(state.appState.selectedGame) : null),
      repairActivity,
      watch: automationBrowser.watch,
    });
  const automation = createFarmingAutomation({
    state,
    persistence,
    browser: automationBrowser,
    manualWatch,
    twitch,
    recover: async (): Promise<FarmingAutomationOutcome | null> => {
      const result = await recover();
      return result.kind === 'failed' ? { kind: 'failed', reason: 'persistence-failed' } : null;
    },
    onStarted: dependencies.startMonitoring,
    telegramNotify: dependencies.telegramNotify,
  });
  await initializeFarmingAutomationLifecycle({
    automation,
    browser: automationBrowser,
    persistence,
    recover,
  });
  return { automation, manualWatch };
}
