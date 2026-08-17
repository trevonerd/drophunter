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
  | 'fetchInventorySnapshot'
  | 'fetchStreamContext'
  | 'heartbeat'
>;

type ServiceWorkerFarmingAutomationDependencies = {
  readonly browserEvents: BrowserEvents;
  readonly startMonitoring: () => void;
  readonly twitchGateway: TwitchGateway;
};

type InitializationResult =
  | { readonly kind: 'ready'; readonly automation: FarmingAutomation }
  | { readonly kind: 'failed'; readonly error: Error };

export interface ServiceWorkerFarmingAutomationRuntime {
  readonly automation: FarmingAutomation;
  readonly initialize: () => Promise<void>;
}

export function createServiceWorkerFarmingAutomationRuntime(
  state: ServiceWorkerState,
  dependencies: ServiceWorkerFarmingAutomationDependencies,
): ServiceWorkerFarmingAutomationRuntime {
  let settleInitialization: ((result: InitializationResult) => void) | null = null;
  const ready = new Promise<InitializationResult>((resolve) => {
    settleInitialization = resolve;
  });
  let initialization: Promise<void> | null = null;

  const publicAutomation: FarmingAutomation = {
    async request(trigger) {
      const result = await ready;
      switch (result.kind) {
        case 'ready':
          return result.automation.request(trigger);
        case 'failed':
          throw result.error;
      }
    },
    async snooze(reason) {
      const result = await ready;
      switch (result.kind) {
        case 'ready':
          return result.automation.snooze(reason);
        case 'failed':
          throw result.error;
      }
    },
  };

  const initializeOnce = async (): Promise<void> => {
    try {
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
      if (currentOwnership) {
        dependencies.browserEvents.watchTransport.restore(currentOwnership);
      }

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
            const sameGame =
              target.categorySlug !== undefined && context?.categorySlug === target.categorySlug;
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
        fetchCampaignSnapshot: () => dependencies.twitchGateway.fetchDropsSnapshot(),
        fetchInventorySnapshot: (_session, baseDrops) =>
          dependencies.twitchGateway.fetchInventorySnapshot([...baseDrops]),
        fetchDirectoryStreamers: async (game, _session, language) => {
          const streamers = await dependencies.twitchGateway.fetchDirectoryStreamers(game, false, language);
          return { streamers, languageFilterApplied: streamers.languageFilterApplied };
        },
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
          currentCampaignKey: () =>
            state.appState.selectedGame ? gameKey(state.appState.selectedGame) : null,
          repairActivity,
          watch: automationBrowser.watch,
        });
      const automation = createFarmingAutomation({
        state,
        persistence,
        browser: automationBrowser,
        twitch,
        recover: async (): Promise<FarmingAutomationOutcome | null> => {
          const result = await recover();
          return result.kind === 'failed' ? { kind: 'failed', reason: 'persistence-failed' } : null;
        },
        onStarted: dependencies.startMonitoring,
      });
      await initializeFarmingAutomationLifecycle({
        automation,
        browser: automationBrowser,
        persistence,
        recover,
      });
      settleInitialization?.({ kind: 'ready', automation });
    } catch (error) {
      const failure =
        error instanceof Error
          ? error
          : new DOMException('Farming automation initialization failed', 'InvalidStateError');
      settleInitialization?.({ kind: 'failed', error: failure });
      throw failure;
    }
  };

  const initialize = (): Promise<void> => {
    if (initialization) return initialization;
    initialization = initializeOnce();
    return initialization;
  };

  return { automation: publicAutomation, initialize };
}
