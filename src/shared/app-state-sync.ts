import type { AppState } from '../types/index.ts';
import {
  normalizeAutomationActivity,
  normalizeCampaignAvailability,
  normalizeCampaignDrops,
  normalizeFavoriteGames,
  normalizeHiddenGames,
  normalizeQueueMetadata,
  normalizeStoredDrops,
} from './app-state-collection-normalizers.ts';
import {
  isRecord,
  normalizeCampaignFailureEpisodes,
  normalizeStoredGame,
  normalizeStoredGames,
  RECOVERY_REASONS,
  STOP_REASONS,
} from './app-state-normalization-values.ts';
import {
  normalizeCampaignSyncState,
  normalizeStoredStreamer,
  normalizeTwitchSessionSyncState,
  normalizeWatchHealth,
  restoreAuthorizedQueueRetry,
} from './app-state-runtime-normalizers.ts';
import { browser } from './browser-api.ts';
import { isCampaignAcquired } from './campaign-eligibility.ts';
import { gameKey } from './game-selection.ts';
import { isRuntimeRequest } from './messages.ts';
import { normalizeQueueAcquisitionRound } from './queue-acquisition-round.ts';
import { createInitialState } from './utils.ts';

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
  const {
    autoResumeOnStartup: _legacyAutoResumeOnStartup,
    stalledCampaignBlocksByKey: legacyStallBlocks,
    ...persistedValue
  } = value;
  const pendingGame = isRecord(value.pendingWatchTarget)
    ? normalizeStoredGame(value.pendingWatchTarget.game)
    : null;
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
    isPaused: value.isPaused === true && lastStopReason !== 'user-stop',
    wasRunning: value.wasRunning === true,
    tabId:
      typeof value.tabId === 'number' && Number.isInteger(value.tabId) && value.tabId > 0
        ? value.tabId
        : null,
    activeStreamer: normalizeStoredStreamer(value.activeStreamer),
    pendingWatchTarget:
      pendingGame &&
      isRecord(value.pendingWatchTarget) &&
      typeof value.pendingWatchTarget.channelName === 'string' &&
      /^[a-zA-Z0-9_]{1,25}$/.test(value.pendingWatchTarget.channelName)
        ? { game: pendingGame, channelName: value.pendingWatchTarget.channelName }
        : null,
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
    farmingSessionTargets: isRecord(value.farmingSessionTargets)
      ? Object.fromEntries(
          Object.values(value.farmingSessionTargets).flatMap((target) => {
            if (!isRecord(target)) return [];
            const game = normalizeStoredGame(target.game);
            return game ? [[gameKey(game), { game, acquired: isCampaignAcquired(game) }]] : [];
          }),
        )
      : {},
    campaignFailureEpisodesByKey: normalizeCampaignFailureEpisodes(value.campaignFailureEpisodesByKey),
    dismissedFarmingMessageIds: Array.isArray(value.dismissedFarmingMessageIds)
      ? [...new Set(value.dismissedFarmingMessageIds.filter((id): id is string => typeof id === 'string'))]
      : [],
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
  parkLegacyStalledCampaigns(storedState, legacyStallBlocks);
  restoreAuthorizedQueueRetry(storedState);
  if (storedState.isRunning && !storedState.selectedGame && storedState.queue.length > 0) {
    storedState.selectedGame = storedState.queue[0] ?? null;
  }
  return storedState;
}

// Beta builds through 4.0.0-beta.63 kept stalled campaigns in a separate block map. Fold each
// queued block into the shared stalled-progress park, retaining its known-streamer baseline.
function parkLegacyStalledCampaigns(state: AppState, blocks: unknown): void {
  if (!isRecord(blocks)) return;
  const now = Date.now();
  for (const game of state.queue) {
    const key = gameKey(game);
    const block = blocks[key];
    const metadata = state.queueEntryMetadataByKey[key];
    if (!isRecord(block) || metadata?.streamerRetryReason) continue;
    const knownNames = Array.isArray(block.eligibleStreamerNames) ? block.eligibleStreamerNames : [];
    state.queueEntryMetadataByKey[key] = {
      ...(metadata ?? {
        source: state.farmingSessionOrigin === 'automatic' ? 'favorite-auto' : 'manual',
        reason: state.farmingSessionOrigin === 'automatic' ? 'favorite-discovered' : 'user-added',
        addedAt: now,
      }),
      streamerRetryReason: 'stalled-progress',
      streamerRetryAt: now + 60_000,
      parkedStreamerNames: [
        ...new Set(
          knownNames
            .filter((name): name is string => typeof name === 'string')
            .map((name) => name.trim().toLowerCase())
            .filter(Boolean),
        ),
      ],
    };
  }
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
