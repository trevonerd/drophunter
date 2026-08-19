import { createInitialState } from '../shared/utils.ts';
import type { AppState } from '../types/index.ts';
import { clearRotationMetadata, createServiceWorkerState, type ServiceWorkerState } from './runtime-state.ts';

export function createExtensionUpdateAppState(appState: AppState): AppState {
  const preserved = {
    totalDropsClaimed: appState.totalDropsClaimed,
    totalChannelPointsClaimed: appState.totalChannelPointsClaimed,
    monitorAutoOpen: appState.monitorAutoOpen,
    autoResumeOnStartup: appState.autoResumeOnStartup,
    muteFarmingTab: appState.muteFarmingTab,
    notificationsEnabled: appState.notificationsEnabled,
    telegramAlertsEnabled: appState.telegramAlertsEnabled,
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
  };
  return clearRotationMetadata({ ...createInitialState(), ...preserved });
}

function replaceAppStateContents(target: AppState, replacement: AppState): void {
  for (const key of Object.keys(target)) {
    Reflect.deleteProperty(target, key);
  }
  Object.assign(target, replacement);
}

export function applyExtensionUpdateStateTransition(state: ServiceWorkerState): void {
  const appStateReference = state.appState;
  const appState = createExtensionUpdateAppState(appStateReference);
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
