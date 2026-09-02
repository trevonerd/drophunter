import type { AppState } from '../types/index.ts';
import {
  normalizeAutomationActivity,
  normalizeCampaignAvailability,
  normalizeCampaignDrops,
  normalizeFavoriteGames,
  normalizeHiddenGames,
  normalizeQueueMetadata,
} from './app-state-collection-normalizers.ts';
import {
  normalizeCampaignSyncState,
  normalizeTwitchSessionSyncState,
  normalizeWatchHealth,
} from './app-state-runtime-normalizers.ts';
import { browser } from './browser-api.ts';
import { isRuntimeRequest } from './messages.ts';
import { createInitialState } from './utils.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeStoredAppState(value: unknown): AppState {
  if (!isRecord(value)) {
    return createInitialState();
  }
  const defaults = createInitialState();
  const migratesLegacyAuthRecovery = value.isRunning === true && value.recoveryReason === 'sign-in-required';
  const hiddenGames = normalizeHiddenGames(value.hiddenGames);
  const hiddenIdentityKeys = new Set(
    hiddenGames.flatMap((entry) => [entry.gameId, ...(entry.identityKeys ?? [])]),
  );
  const storedState: AppState = {
    ...createInitialState(),
    ...value,
    queue: Array.isArray(value.queue) ? (value.queue as AppState['queue']) : defaults.queue,
    favoriteGames: normalizeFavoriteGames(value.favoriteGames).filter(
      (entry) => ![entry.gameId, ...(entry.identityKeys ?? [])].some((key) => hiddenIdentityKeys.has(key)),
    ),
    hiddenGames,
    campaignPriorityMode:
      value.campaignPriorityMode === 'ending-soonest' ||
      value.campaignPriorityMode === 'lowest-availability' ||
      value.campaignPriorityMode === 'priority-list-only'
        ? value.campaignPriorityMode
        : defaults.campaignPriorityMode,
    farmCategoryScope:
      value.farmCategoryScope === 'all' || value.farmCategoryScope === 'favorites-only'
        ? value.farmCategoryScope
        : defaults.farmCategoryScope,
    autoStartFavoriteGames:
      typeof value.autoStartFavoriteGames === 'boolean'
        ? value.autoStartFavoriteGames
        : defaults.autoStartFavoriteGames,
    queueEntryMetadataByKey: normalizeQueueMetadata(value.queueEntryMetadataByKey),
    automationActivity: normalizeAutomationActivity(value.automationActivity),
    lastAutomationMessage:
      typeof value.lastAutomationMessage === 'string' ? value.lastAutomationMessage : null,
    nextAutomationCheckAt:
      typeof value.nextAutomationCheckAt === 'number' && Number.isFinite(value.nextAutomationCheckAt)
        ? value.nextAutomationCheckAt
        : null,
    manualWatchState:
      value.manualWatchState === 'eligible-manual' || value.manualWatchState === 'automation-paused'
        ? value.manualWatchState
        : 'inactive',
    campaignAvailabilityByKey: normalizeCampaignAvailability(value.campaignAvailabilityByKey),
    campaignDropsByKey: normalizeCampaignDrops(value.campaignDropsByKey),
    watchTransportPreference:
      value.watchTransportPreference === 'tabless' || value.watchTransportPreference === 'managed-tab'
        ? value.watchTransportPreference
        : defaults.watchTransportPreference,
    watchTransportMode:
      value.watchTransportMode === 'tabless' || value.watchTransportMode === 'managed-tab'
        ? value.watchTransportMode
        : defaults.watchTransportMode,
    watchHealth: normalizeWatchHealth(value.watchHealth),
    watchFallbackReason: typeof value.watchFallbackReason === 'string' ? value.watchFallbackReason : null,
    campaignSyncState: normalizeCampaignSyncState(value),
    twitchSessionSyncState: normalizeTwitchSessionSyncState(value),
    recoveryReason:
      migratesLegacyAuthRecovery || typeof value.recoveryReason !== 'string' ? null : value.recoveryReason,
    recoveryBackoffUntil:
      migratesLegacyAuthRecovery ||
      typeof value.recoveryBackoffUntil !== 'number' ||
      !Number.isFinite(value.recoveryBackoffUntil)
        ? null
        : value.recoveryBackoffUntil,
    recoveryAttempts:
      migratesLegacyAuthRecovery ||
      typeof value.recoveryAttempts !== 'number' ||
      !Number.isFinite(value.recoveryAttempts)
        ? null
        : value.recoveryAttempts,
  };
  if (storedState.isRunning && !storedState.selectedGame && storedState.queue.length > 0) {
    storedState.selectedGame = storedState.queue[0] ?? null;
  }
  return storedState;
}

export async function loadStoredAppState(): Promise<AppState> {
  const result = await browser.storage.local.get(['appState']);
  return normalizeStoredAppState(result.appState);
}

export function subscribeToAppState(onState: (state: AppState) => void): () => void {
  const runtimeListener = (message: unknown) => {
    if (isRuntimeRequest(message) && message.type === 'UPDATE_STATE' && message.payload) {
      onState(normalizeStoredAppState(message.payload));
    }
  };

  const storageListener: Parameters<typeof browser.storage.onChanged.addListener>[0] = (
    changes,
    areaName,
  ) => {
    if (areaName !== 'local' || !changes.appState) {
      return;
    }
    onState(normalizeStoredAppState(changes.appState.newValue));
  };

  browser.runtime.onMessage.addListener(runtimeListener);
  browser.storage.onChanged.addListener(storageListener);

  return () => {
    browser.runtime.onMessage.removeListener(runtimeListener);
    browser.storage.onChanged.removeListener(storageListener);
  };
}
