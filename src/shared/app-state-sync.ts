import type { AppState, TwitchDrop } from '../types/index.ts';
import { browser } from './browser-api.ts';
import { isRuntimeRequest } from './messages.ts';
import { createInitialState } from './utils.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeFavoriteGames(value: unknown): AppState['favoriteGames'] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(
      (entry): entry is Record<string, unknown> & AppState['favoriteGames'][number] =>
        isRecord(entry) &&
        typeof entry.gameId === 'string' &&
        entry.gameId.trim().length > 0 &&
        typeof entry.lastKnownName === 'string' &&
        Number.isFinite(entry.addedAt),
    )
    .map((entry) => ({
      gameId: entry.gameId,
      lastKnownName: entry.lastKnownName,
      addedAt: entry.addedAt,
      ...(Array.isArray(entry.identityKeys)
        ? {
            identityKeys: Array.from(
              new Set(
                entry.identityKeys.filter(
                  (key): key is string => typeof key === 'string' && key.trim().length > 0,
                ),
              ),
            ),
          }
        : {}),
    }));
}

function normalizeHiddenGames(value: unknown): AppState['hiddenGames'] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(
      (entry): entry is Record<string, unknown> & AppState['hiddenGames'][number] =>
        isRecord(entry) &&
        typeof entry.gameId === 'string' &&
        entry.gameId.trim().length > 0 &&
        typeof entry.lastKnownName === 'string' &&
        Number.isFinite(entry.hiddenAt),
    )
    .map((entry) => ({
      gameId: entry.gameId,
      lastKnownName: entry.lastKnownName,
      hiddenAt: entry.hiddenAt,
      ...(Array.isArray(entry.identityKeys)
        ? {
            identityKeys: Array.from(
              new Set(
                entry.identityKeys.filter(
                  (key): key is string => typeof key === 'string' && key.trim().length > 0,
                ),
              ),
            ),
          }
        : {}),
    }));
}

function normalizeQueueMetadata(value: unknown): AppState['queueEntryMetadataByKey'] {
  if (!isRecord(value)) {
    return {};
  }
  const entries = Object.entries(value).filter(
    (entry): entry is [string, AppState['queueEntryMetadataByKey'][string]] => {
      const metadata = entry[1];
      return (
        isRecord(metadata) &&
        (metadata.source === 'manual' || metadata.source === 'favorite-auto') &&
        Number.isFinite(metadata.addedAt) &&
        (metadata.reason === 'user-added' ||
          metadata.reason === 'favorite-discovered' ||
          metadata.reason === 'retained-after-hide')
      );
    },
  );
  return Object.fromEntries(entries);
}

function normalizeAutomationActivity(value: unknown): AppState['automationActivity'] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is AppState['automationActivity'][number] =>
      isRecord(entry) &&
      typeof entry.id === 'string' &&
      (entry.kind === 'favorite-added' ||
        entry.kind === 'auto-started' ||
        entry.kind === 'preempted' ||
        entry.kind === 'auto-start-skipped') &&
      Number.isFinite(entry.at) &&
      typeof entry.message === 'string' &&
      (entry.campaignId === undefined || typeof entry.campaignId === 'string'),
  );
}

function normalizeCampaignAvailability(value: unknown): AppState['campaignAvailabilityByKey'] {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, AppState['campaignAvailabilityByKey'][string]] => {
        const availability = entry[1];
        return (
          isRecord(availability) &&
          Number.isInteger(availability.eligibleStreamerCount) &&
          typeof availability.eligibleStreamerCount === 'number' &&
          availability.eligibleStreamerCount >= 0 &&
          Number.isFinite(availability.updatedAt)
        );
      },
    ),
  );
}

function isStoredTwitchDrop(value: unknown): value is TwitchDrop {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.gameId === 'string' &&
    typeof value.gameName === 'string' &&
    typeof value.imageUrl === 'string' &&
    typeof value.progress === 'number' &&
    Number.isFinite(value.progress) &&
    typeof value.currentMinutes === 'number' &&
    Number.isFinite(value.currentMinutes) &&
    typeof value.claimed === 'boolean' &&
    (value.acquisitionMethod === 'watch-time' ||
      value.acquisitionMethod === 'subscription' ||
      value.acquisitionMethod === 'other-event' ||
      value.acquisitionMethod === 'unknown') &&
    (value.rewardKind === 'in-game' ||
      value.rewardKind === 'twitch-badge' ||
      value.rewardKind === 'twitch-emote' ||
      value.rewardKind === 'unknown') &&
    (value.verificationState === 'unassessed' ||
      value.verificationState === 'verified' ||
      value.verificationState === 'unverifiable')
  );
}

function normalizeCampaignDrops(value: unknown): AppState['campaignDropsByKey'] {
  if (!isRecord(value)) return {};
  const result: AppState['campaignDropsByKey'] = {};
  for (const [key, drops] of Object.entries(value)) {
    if (key && Array.isArray(drops)) result[key] = drops.filter(isStoredTwitchDrop);
  }
  return result;
}

function normalizeWatchHealth(value: unknown): AppState['watchHealth'] {
  if (!isRecord(value)) {
    return null;
  }
  const mode = value.mode;
  const status = value.status;
  const reason = value.reason;
  const isMode = (candidate: unknown): candidate is NonNullable<AppState['watchHealth']>['mode'] =>
    candidate === 'managed-tab' || candidate === 'tabless';
  const isStatus = (candidate: unknown): candidate is NonNullable<AppState['watchHealth']>['status'] =>
    candidate === 'healthy' ||
    candidate === 'degraded' ||
    candidate === 'failed' ||
    candidate === 'stalled' ||
    candidate === 'disabled' ||
    candidate === 'stopped' ||
    candidate === 'not-started';
  const isReason = (candidate: unknown): candidate is NonNullable<AppState['watchHealth']>['reason'] =>
    candidate === 'started' ||
    candidate === 'heartbeat' ||
    candidate === 'heartbeat-failed' ||
    candidate === 'stream-offline' ||
    candidate === 'wrong-channel' ||
    candidate === 'wrong-game' ||
    candidate === 'drops-inactive' ||
    candidate === 'stalled-progress' ||
    candidate === 'managed-tab-unavailable' ||
    candidate === 'transport-disabled' ||
    candidate === 'not-started' ||
    candidate === 'stopped' ||
    candidate === 'error';
  if (
    !isMode(mode) ||
    !isStatus(status) ||
    !isReason(reason) ||
    typeof value.isHealthy !== 'boolean' ||
    typeof value.consecutiveFailures !== 'number' ||
    !Number.isFinite(value.consecutiveFailures) ||
    typeof value.consecutiveStalls !== 'number' ||
    !Number.isFinite(value.consecutiveStalls) ||
    (value.progress !== null && (typeof value.progress !== 'number' || !Number.isFinite(value.progress))) ||
    typeof value.shouldFallback !== 'boolean' ||
    typeof value.checkedAt !== 'number' ||
    !Number.isFinite(value.checkedAt)
  ) {
    return null;
  }
  return {
    mode,
    isHealthy: value.isHealthy,
    status,
    reason,
    consecutiveFailures: value.consecutiveFailures,
    consecutiveStalls: value.consecutiveStalls,
    progress: value.progress,
    shouldFallback: value.shouldFallback,
    checkedAt: value.checkedAt,
  };
}

export function normalizeStoredAppState(value: unknown): AppState {
  if (!isRecord(value)) {
    return createInitialState();
  }
  const defaults = createInitialState();
  const hiddenGames = normalizeHiddenGames(value.hiddenGames);
  const hiddenIdentityKeys = new Set(
    hiddenGames.flatMap((entry) => [entry.gameId, ...(entry.identityKeys ?? [])]),
  );
  const storedState: AppState = {
    ...createInitialState(),
    ...value,
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
  };
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
