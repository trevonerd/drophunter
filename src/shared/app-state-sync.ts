import type { AppState, TwitchGame } from '../types/index.ts';
import {
  normalizeAutomationActivity,
  normalizeCampaignAvailability,
  normalizeCampaignDrops,
  normalizeFavoriteGames,
  normalizeHiddenGames,
  normalizeQueueMetadata,
  normalizeStalledCampaignBlocks,
  normalizeStoredDrops,
} from './app-state-collection-normalizers.ts';
import {
  normalizeCampaignSyncState,
  normalizeStoredStreamer,
  normalizeTwitchSessionSyncState,
  normalizeWatchHealth,
  restoreAuthorizedQueueRetry,
} from './app-state-runtime-normalizers.ts';
import { browser } from './browser-api.ts';
import { isTwitchGameLike } from './message-validation.ts';
import { isRuntimeRequest } from './messages.ts';
import { normalizeQueueAcquisitionRound } from './queue-acquisition-round.ts';
import { createInitialState } from './utils.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeStoredGame(value: unknown): TwitchGame | null {
  if (!isRecord(value)) return null;
  // Older snapshots can carry a stale boolean alongside an authoritative reward summary.
  // Repair the redundant boolean instead of deleting the campaign and its queue position.
  const completion = isRecord(value.rewardSummary) ? value.rewardSummary.completion : undefined;
  const candidate =
    completion === 'all-acquired' || completion === 'farmable' || completion === 'farming-complete'
      ? { ...value, allDropsCompleted: completion === 'all-acquired' }
      : value;
  return isTwitchGameLike(candidate) ? candidate : null;
}

function normalizeStoredGames(value: unknown): TwitchGame[] {
  return Array.isArray(value)
    ? value.map(normalizeStoredGame).filter((game): game is TwitchGame => game !== null)
    : [];
}

const RECOVERY_REASONS = new Set([
  'twitch-auth',
  'twitch-integrity',
  'twitch-network',
  'twitch-rate-limit',
  'twitch-invalid-response',
  'twitch-data-unavailable',
  'stalled-progress',
  'open-failed',
  'directory-unavailable',
  'no-streamers',
  'drops-inactive',
  'wrong-game',
  'wrong-channel',
  'offline',
]);
const STOP_REASONS = new Set([
  'user-stop',
  'queue-complete',
  'farming-complete',
  'sign-in-required',
  'stall-skipped',
  'queue-retries-exhausted',
  'no-active-campaigns',
  'unverifiable-twitch',
]);

export function normalizeStoredAppState(value: unknown): AppState {
  if (!isRecord(value)) {
    return createInitialState();
  }
  const defaults = createInitialState();
  const migratesLegacyAuthRecovery = value.isRunning === true && value.recoveryReason === 'sign-in-required';
  const recoveryReason =
    !migratesLegacyAuthRecovery &&
    typeof value.recoveryReason === 'string' &&
    RECOVERY_REASONS.has(value.recoveryReason)
      ? value.recoveryReason
      : null;
  const lastStopReason =
    typeof value.lastStopReason === 'string' && STOP_REASONS.has(value.lastStopReason)
      ? value.lastStopReason
      : null;
  const hiddenGames = normalizeHiddenGames(value.hiddenGames);
  const hiddenIdentityKeys = new Set(
    hiddenGames.flatMap((entry) => [entry.gameId, ...(entry.identityKeys ?? [])]),
  );
  const { autoResumeOnStartup: _legacyAutoResumeOnStartup, ...persistedValue } = value;
  const storedState: AppState = {
    ...createInitialState(),
    ...persistedValue,
    queue: normalizeStoredGames(value.queue),
    selectedGame: normalizeStoredGame(value.selectedGame),
    availableGames: normalizeStoredGames(value.availableGames),
    allDrops: normalizeStoredDrops(value.allDrops),
    pendingDrops: normalizeStoredDrops(value.pendingDrops),
    completedDrops: normalizeStoredDrops(value.completedDrops),
    currentDrop: normalizeStoredDrops([value.currentDrop])[0] ?? null,
    isRunning:
      (value.isRunning === true || (value.isPaused === true && value.manualQueueAuthorized === true)) &&
      lastStopReason !== 'user-stop',
    isPaused: value.isPaused === true,
    wasRunning: value.wasRunning === true,
    tabId:
      typeof value.tabId === 'number' && Number.isInteger(value.tabId) && value.tabId > 0
        ? value.tabId
        : null,
    activeStreamer: normalizeStoredStreamer(value.activeStreamer),
    lastStopReason,
    lastStopMessage:
      lastStopReason && typeof value.lastStopMessage === 'string'
        ? value.lastStopMessage.slice(0, 500)
        : null,
    favoriteGames: normalizeFavoriteGames(value.favoriteGames).filter(
      (entry) => ![entry.gameId, ...(entry.identityKeys ?? [])].some((key) => hiddenIdentityKeys.has(key)),
    ),
    hiddenGames,
    campaignPriorityMode:
      value.campaignPriorityMode === 'ending-soonest' || value.campaignPriorityMode === 'priority-list-only'
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
    manualQueueAuthorized: value.manualQueueAuthorized === true,
    queueResumeOnAvailability: value.queueResumeOnAvailability === true,
    forcedCampaignKey:
      typeof value.forcedCampaignKey === 'string' && value.forcedCampaignKey.trim().length > 0
        ? value.forcedCampaignKey
        : null,
    farmingSessionOrigin:
      value.farmingSessionOrigin === 'manual' || value.farmingSessionOrigin === 'automatic'
        ? value.farmingSessionOrigin
        : value.isRunning === true && value.manualQueueAuthorized !== true
          ? 'automatic'
          : null,
    queueEntryMetadataByKey: normalizeQueueMetadata(value.queueEntryMetadataByKey),
    queueAcquisitionRound: normalizeQueueAcquisitionRound(value.queueAcquisitionRound),
    stalledCampaignBlocksByKey: normalizeStalledCampaignBlocks(value.stalledCampaignBlocksByKey),
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
    campaignEvidenceUserId:
      typeof value.campaignEvidenceUserId === 'string' && value.campaignEvidenceUserId.trim()
        ? value.campaignEvidenceUserId.trim()
        : undefined,
    acquiredCampaignIds: Array.isArray(value.acquiredCampaignIds)
      ? [
          ...new Set(
            value.acquiredCampaignIds.filter(
              (id): id is string => typeof id === 'string' && id.trim().length > 0,
            ),
          ),
        ]
      : [],
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
    recoveryReason,
    recoveryBackoffUntil:
      !recoveryReason ||
      typeof value.recoveryBackoffUntil !== 'number' ||
      !Number.isFinite(value.recoveryBackoffUntil)
        ? null
        : ['open-failed', 'no-streamers', 'directory-unavailable'].includes(recoveryReason)
          ? Math.min(value.recoveryBackoffUntil, Date.now() + 600_000)
          : Math.min(value.recoveryBackoffUntil, Date.now() + 24 * 60 * 60_000),
    recoveryAttempts:
      !recoveryReason ||
      typeof value.recoveryAttempts !== 'number' ||
      !Number.isSafeInteger(value.recoveryAttempts) ||
      value.recoveryAttempts < 0
        ? null
        : Math.min(value.recoveryAttempts, 100),
    recoverySchedulerUnavailable: value.recoverySchedulerUnavailable === true,
  };
  restoreAuthorizedQueueRetry(storedState);
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
