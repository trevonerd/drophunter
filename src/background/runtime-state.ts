import type { AppState } from '../types/index.ts';

export { createServiceWorkerState } from './runtime-service-worker-state.ts';
export type {
  StartupResumePolicyResult,
  StartupResumePolicyState,
} from './runtime-startup-policy.ts';
export { applyStartupResumePolicy } from './runtime-startup-policy.ts';
export type { ServiceWorkerState } from './runtime-state-types.ts';
export type {
  TimingState,
  UnverifiableRewardMarker,
} from './runtime-timing-state.ts';
export {
  createInitialTimingState,
  normalizeTimingState,
} from './runtime-timing-state.ts';

export function clearRotationMetadata(state: AppState): AppState {
  return { ...state, lastRotationReason: null, lastRotationAt: null };
}

export function pickDurablePreferences(appState: AppState) {
  return {
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
  };
}

export function shouldCloseManagedTab(windowTabCount: number | null | undefined): boolean {
  return typeof windowTabCount === 'number' && Number.isFinite(windowTabCount) && windowTabCount > 1;
}
