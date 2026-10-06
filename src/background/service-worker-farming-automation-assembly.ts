import { gameKey } from '../shared/game-selection.ts';
import { isExpectedStreamCategory } from '../shared/stream-category.ts';
import { recordAutomationActivity } from './automation-activity.ts';
import type { AutomationEventNotifier } from './automation-event-notifier.ts';
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
import {
  createFarmingAutomationTwitchAdapter,
  FarmingAutomationRefreshBackoffError,
} from './farming-automation-twitch.ts';
import type { FarmingQueueProgression } from './farming-queue-progression.ts';
import { currentFarmingSessionEpoch } from './farming-session-revision.ts';
import { reconcileManagedWatchesOnStartup } from './managed-watch-startup.ts';
import { applyPlaybackStartRecoveryState } from './recovery-state.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import type { createServiceWorkerBrowserEvents } from './service-worker-browser-events.ts';
import type { createServiceWorkerTwitchGateway } from './service-worker-twitch-gateway.ts';
import { resetStreamTrackingState } from './session-lifecycle-stop.ts';
import { broadcastStateUpdate, saveState } from './state-persistence.ts';
import { waitForTabComplete } from './tab-management.ts';
import { saveTimingState } from './timing-state-persistence.ts';

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
> &
  Partial<Pick<ReturnType<typeof createServiceWorkerTwitchGateway>, 'probeStreamInfo'>>;

export interface ServiceWorkerFarmingAutomationAssemblyDependencies {
  readonly reconcileQueueAvailability: FarmingQueueProgression['reconcileAvailability'];
  readonly browserEvents: BrowserEvents;
  readonly startMonitoring: () => void;
  readonly twitchGateway: TwitchGateway;
  readonly automationNotify?: AutomationEventNotifier;
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
      if (
        state.appState.isRunning &&
        receiptRead.value?.toCampaignKey === selectedKey &&
        receiptRead.value.toStreamerName.trim().toLowerCase() ===
          state.appState.activeStreamer?.name.trim().toLowerCase()
      ) {
        currentOwnership = receiptRead.value.toWatch;
      }
      break;
    }
    default:
      receiptRead satisfies never;
  }
  currentOwnership = await reconcileManagedWatchesOnStartup(state, currentOwnership);
  if (currentOwnership) {
    const epoch = currentFarmingSessionEpoch(state);
    const restored = await dependencies.browserEvents.watchTransport.restore(currentOwnership);
    if (
      !restored &&
      epoch === currentFarmingSessionEpoch(state) &&
      state.appState.isRunning &&
      !state.appState.isPaused
    ) {
      resetStreamTrackingState(state);
      state.appState.activeStreamer = null;
      state.appState.watchHealth = null;
      state.appState.tabId = null;
      state.appState.watchFallbackReason = null;
      applyPlaybackStartRecoveryState(state, Date.now(), 0);
      await saveState(state);
      await saveTimingState(state);
    }
  }

  const persistNewApiCooldown = async <T>(operation: () => Promise<T>): Promise<T> => {
    const previousBackoff = state.apiBackoffUntil;
    const previousRetryAfterProof = state.apiRetryAfterVerifiedAt;
    try {
      return await operation();
    } finally {
      if (
        state.apiBackoffUntil > Date.now() &&
        (state.apiBackoffUntil !== previousBackoff ||
          state.apiRetryAfterVerifiedAt !== previousRetryAfterProof)
      ) {
        await saveTimingState(state);
      }
    }
  };

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
        const sameGame = isExpectedStreamCategory(context, target);
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
    assertCanRefresh: (options) => {
      if (options.requireFreshCompleteSnapshot && state.apiBackoffUntil > Date.now()) {
        throw new FarmingAutomationRefreshBackoffError(state.apiBackoffUntil);
      }
    },
    fetchCampaignSnapshot: async (_session, options) => {
      return persistNewApiCooldown(async () => {
        if (options?.requireFreshCompleteSnapshot) {
          return dependencies.twitchGateway.fetchDropsSnapshot({
            sessionRecoveryMode: options.allowSessionRecovery === false ? 'passive' : 'background-tab',
            preserveSessionOnAuthFailure: true,
            onSessionResolved: (session) => options.onSessionResolved?.(session.userId),
          });
        }
        return (
          dependencies.twitchGateway.getLatestProgressSnapshot() ??
          (await dependencies.twitchGateway.fetchDropsSnapshot())
        );
      });
    },
    campaignSnapshotIncludesInventory: (snapshot) => snapshot.inventoryVerified === true,
    fetchInventorySnapshot: (_session, baseDrops) =>
      dependencies.twitchGateway.fetchInventorySnapshot([...baseDrops]),
    fetchDirectoryStreamers: async (game, _session, language, options) => {
      return persistNewApiCooldown(async () => {
        const streamers = await dependencies.twitchGateway.fetchDirectoryStreamers(
          game,
          false,
          language,
          undefined,
          options,
        );
        return { streamers, languageFilterApplied: streamers.languageFilterApplied };
      });
    },
    probeStreamInfo: dependencies.twitchGateway.probeStreamInfo
      ? (channel) => {
          const probeStreamInfo = dependencies.twitchGateway.probeStreamInfo;
          return probeStreamInfo
            ? persistNewApiCooldown(() => probeStreamInfo(channel))
            : Promise.resolve({ kind: 'unavailable' as const });
        }
      : undefined,
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
    reconcileQueueAvailability: dependencies.reconcileQueueAvailability,
    persistence,
    browser: automationBrowser,
    manualWatch,
    twitch,
    recover: async (): Promise<FarmingAutomationOutcome | null> => {
      const result = await recover();
      return result.kind === 'failed' ? { kind: 'failed', reason: 'persistence-failed' } : null;
    },
    onStarted: dependencies.startMonitoring,
    automationNotify: dependencies.automationNotify,
  });
  await initializeFarmingAutomationLifecycle({
    automation,
    browser: automationBrowser,
    persistence,
    recover,
  });
  return { automation, manualWatch };
}
