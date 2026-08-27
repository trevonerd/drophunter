import { createInitialState } from '../shared/utils.ts';
import type { AppState } from '../types/index.ts';
import { clearRotationMetadata, createServiceWorkerState, type ServiceWorkerState } from './runtime-state.ts';

interface ExtensionUpdateIntent {
  readonly wasRunning: boolean;
  readonly queue: AppState['queue'];
  readonly selectedGame: AppState['selectedGame'];
  readonly queueEntryMetadataByKey: AppState['queueEntryMetadataByKey'];
}

export function createExtensionUpdateAppState(
  appState: AppState,
  intent: ExtensionUpdateIntent = {
    wasRunning: appState.isRunning || appState.wasRunning,
    queue: appState.queue,
    selectedGame: appState.selectedGame,
    queueEntryMetadataByKey: appState.queueEntryMetadataByKey,
  },
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
    favoriteGames: appState.favoriteGames,
    hiddenGames: appState.hiddenGames,
    campaignPriorityMode: appState.campaignPriorityMode,
    farmCategoryScope: appState.farmCategoryScope,
    autoStartFavoriteGames: appState.autoStartFavoriteGames,
    queue: intent.queue,
    selectedGame: intent.selectedGame,
    queueEntryMetadataByKey: intent.queueEntryMetadataByKey,
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
