import { createInitialState } from '../shared/utils.ts';
import type { AppState } from '../types/index.ts';
import { clearRotationMetadata, createServiceWorkerState, type ServiceWorkerState } from './runtime-state.ts';

interface ExtensionUpdateIntent {
  readonly wasRunning: boolean;
  readonly isPaused: boolean;
  readonly manualQueueAuthorized: AppState['manualQueueAuthorized'];
  readonly queueResumeOnAvailability: AppState['queueResumeOnAvailability'];
  readonly forcedCampaignKey: AppState['forcedCampaignKey'];
  readonly farmingSessionOrigin: AppState['farmingSessionOrigin'];
  readonly lastStopReason: AppState['lastStopReason'];
  readonly lastStopMessage: AppState['lastStopMessage'];
  readonly queueAcquisitionRound: AppState['queueAcquisitionRound'];
  readonly recoveryReason: AppState['recoveryReason'];
  readonly recoveryBackoffUntil: AppState['recoveryBackoffUntil'];
  readonly recoveryAttempts: AppState['recoveryAttempts'];
  readonly queue: AppState['queue'];
  readonly selectedGame: AppState['selectedGame'];
  readonly queueEntryMetadataByKey: AppState['queueEntryMetadataByKey'];
}

export function captureExtensionUpdateIntent(appState: AppState): ExtensionUpdateIntent {
  return {
    wasRunning:
      !appState.isPaused &&
      appState.lastStopReason !== 'user-stop' &&
      (appState.isRunning || appState.wasRunning),
    isPaused: appState.isPaused,
    manualQueueAuthorized: appState.manualQueueAuthorized,
    queueResumeOnAvailability: appState.queueResumeOnAvailability,
    forcedCampaignKey: appState.forcedCampaignKey,
    farmingSessionOrigin: appState.farmingSessionOrigin,
    lastStopReason: appState.lastStopReason,
    lastStopMessage: appState.lastStopMessage,
    queueAcquisitionRound: appState.queueAcquisitionRound,
    recoveryReason: appState.recoveryReason,
    recoveryBackoffUntil: appState.recoveryBackoffUntil,
    recoveryAttempts: appState.recoveryAttempts,
    queue: appState.queue.slice(),
    selectedGame: appState.selectedGame,
    queueEntryMetadataByKey: { ...appState.queueEntryMetadataByKey },
  };
}

export function createExtensionUpdateAppState(
  appState: AppState,
  intent: ExtensionUpdateIntent = captureExtensionUpdateIntent(appState),
): AppState {
  const preserved = {
    totalDropsClaimed: appState.totalDropsClaimed,
    totalChannelPointsClaimed: appState.totalChannelPointsClaimed,
    monitorAutoOpen: appState.monitorAutoOpen,
    autoResumeOnStartup: appState.autoResumeOnStartup,
    muteFarmingTab: appState.muteFarmingTab,
    notificationsEnabled: appState.notificationsEnabled,
    telegramAlertsEnabled: appState.telegramAlertsEnabled,
    telegramSystemAlertsEnabled: appState.telegramSystemAlertsEnabled,
    autoClaimChannelPointsBonus: appState.autoClaimChannelPointsBonus,
    autoClaimDrops: appState.autoClaimDrops,
    streamerSelectionMode: appState.streamerSelectionMode,
    preferredStreamerLanguage: appState.preferredStreamerLanguage,
    watchTransportPreference: appState.watchTransportPreference,
    watchTransportMode: appState.watchTransportPreference,
    favoriteGames: appState.favoriteGames,
    hiddenGames: appState.hiddenGames,
    campaignPriorityMode: appState.campaignPriorityMode,
    farmCategoryScope: appState.farmCategoryScope,
    autoStartFavoriteGames: appState.autoStartFavoriteGames,
    queue: intent.queue,
    selectedGame: intent.selectedGame,
    queueEntryMetadataByKey: intent.queueEntryMetadataByKey,
    manualQueueAuthorized: intent.manualQueueAuthorized,
    queueResumeOnAvailability: intent.queueResumeOnAvailability,
    forcedCampaignKey: intent.forcedCampaignKey,
    farmingSessionOrigin: intent.farmingSessionOrigin,
    isPaused: intent.isPaused,
    isRunning: intent.isPaused,
    lastStopReason: intent.lastStopReason,
    lastStopMessage: intent.lastStopMessage,
    queueAcquisitionRound: intent.queueAcquisitionRound,
    recoveryReason: intent.recoveryReason,
    recoveryBackoffUntil: intent.recoveryBackoffUntil,
    recoveryAttempts: intent.recoveryAttempts,
    campaignSyncState: appState.campaignSyncState,
    twitchSessionSyncState: appState.twitchSessionSyncState,
    availableGames: appState.availableGames,
    campaignDropsByKey: appState.campaignDropsByKey,
    campaignEvidenceUserId: appState.campaignEvidenceUserId,
    acquiredCampaignIds: appState.acquiredCampaignIds,
    allDrops: appState.allDrops,
    pendingDrops: appState.pendingDrops,
    completedDrops: appState.completedDrops,
    currentDrop: appState.currentDrop,
    stalledCampaignBlocksByKey: appState.stalledCampaignBlocksByKey,
    wasRunning: intent.wasRunning,
  };
  return clearRotationMetadata({ ...createInitialState(), ...preserved });
}

function replaceAppStateContents(target: AppState, replacement: AppState): void {
  for (const key of Object.keys(target)) {
    Reflect.deleteProperty(target, key);
  }
  Object.assign(target, replacement);
}

export function applyExtensionUpdateStateTransition(
  state: ServiceWorkerState,
  intent?: ExtensionUpdateIntent,
): void {
  const appStateReference = state.appState;
  const appState = createExtensionUpdateAppState(appStateReference, intent);
  Object.assign(state, createServiceWorkerState());
  replaceAppStateContents(appStateReference, appState);
  state.appState = appStateReference;
}

export function applyExtensionDataClearStateTransition(state: ServiceWorkerState): void {
  const appStateReference = state.appState;
  Object.assign(state, createServiceWorkerState());
  replaceAppStateContents(appStateReference, createInitialState());
  state.appState = appStateReference;
}
