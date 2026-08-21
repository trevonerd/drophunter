import { browser } from '../shared/browser-api.ts';
import { resolveCategorySlug as resolveCategorySlugExt } from '../shared/game-selection.ts';
import type { DropsSnapshot, TwitchDrop, TwitchGame, TwitchStreamer } from '../types/index.ts';
import {
  fetchDirectoryStreamersFromApiWrapper,
  fetchDropsSnapshotFromApiWrapper,
  fetchInventorySnapshotFromApiWrapper,
} from './api-operations.ts';
import { PROGRESS_POLL_MS } from './constants.ts';
import type { StreamContext } from './farming-session.ts';
import { logDebug, logInfo, logWarn } from './logging.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import {
  clearTwitchSessionCache,
  ensureSessionIntegrity,
  ensureTwitchSession as ensureTwitchSessionExt,
  persistTwitchSession,
  readTwitchSessionViaExecuteScript,
} from './session-management.ts';
import { createSessionOrchestrator } from './session-orchestrator.ts';
import { sessionDebugSummary } from './state-persistence.ts';
import { type FetchDropsSnapshotOptions, TwitchApiClient } from './twitch-api/client.ts';
import { createTwitchSpadeHeartbeat } from './twitch-api/spade-heartbeat.ts';
import {
  DEFAULT_TWITCH_CLIENT_ID,
  isLikelyAuthError,
  sanitizeTwitchSession,
  type TwitchSession,
} from './twitch-api/types.ts';
import { dropsForFarmingTarget } from './watch-target.ts';
import type { FarmingTarget, TablessHeartbeat } from './watch-transport.ts';

const GAMES_STALE_THRESHOLD_MS = 60 * 60_000;

interface ServiceWorkerTwitchGatewayDependencies {
  readonly recoverTwitchSession: (options: {
    readonly notification?: { readonly title: string; readonly message: string };
    readonly stopReason?: string;
    readonly stopMessage?: string | null;
  }) => Promise<void>;
}

export function createServiceWorkerTwitchGateway(
  state: ServiceWorkerState,
  dependencies: ServiceWorkerTwitchGatewayDependencies,
) {
  const sessionOrchestrator = createSessionOrchestrator(state, {
    sanitizeTwitchSession,
    sessionDebugSummary,
    readTwitchSessionViaExecuteScript,
    persistTwitchSession,
    logDebug,
    logWarn,
  });
  const twitchSpadeHeartbeat = createTwitchSpadeHeartbeat({ clientId: DEFAULT_TWITCH_CLIENT_ID });
  let latestProgressSnapshot: DropsSnapshot | null = null;

  async function ensureContentScriptOnTab(tabId: number): Promise<void> {
    await sessionOrchestrator.ensureContentScriptOnTab(tabId);
  }

  async function ensureTwitchSession(forceRefresh = false): Promise<TwitchSession | null> {
    return ensureTwitchSessionExt(
      state,
      forceRefresh,
      { onFindTwitchSessionInOpenTabs: sessionOrchestrator.findTwitchSessionInOpenTabs },
      {
        sanitizeTwitchSession,
        sessionDebugSummary,
        persistTwitchSession,
        clearTwitchSessionCache,
      },
    );
  }

  async function fetchDropsSnapshot(forceSessionRefresh = false): Promise<DropsSnapshot | null> {
    return fetchDropsSnapshotFromApiWrapper(
      state,
      forceSessionRefresh,
      {
        onEnsureTwitchSession: ensureTwitchSession,
        onEnsureSessionIntegrity: ensureSessionIntegrity,
        onPersistTwitchSession: persistTwitchSession,
        onStopFarmingSession: dependencies.recoverTwitchSession,
        onIsLikelyAuthError: isLikelyAuthError,
        onClearTwitchSessionCache: clearTwitchSessionCache,
      },
      { TwitchApiClient, sessionDebugSummary, PROGRESS_POLL_MS, logDebug, logWarn, logInfo },
    );
  }

  async function fetchDropsSnapshotProgressively(
    forceSessionRefresh = false,
    options: FetchDropsSnapshotOptions = {},
  ): Promise<DropsSnapshot | null> {
    latestProgressSnapshot = null;
    const snapshot = await fetchDropsSnapshotFromApiWrapper(
      state,
      forceSessionRefresh,
      {
        onEnsureTwitchSession: ensureTwitchSession,
        onEnsureSessionIntegrity: ensureSessionIntegrity,
        onPersistTwitchSession: persistTwitchSession,
        onStopFarmingSession: dependencies.recoverTwitchSession,
        onIsLikelyAuthError: isLikelyAuthError,
        onClearTwitchSessionCache: clearTwitchSessionCache,
      },
      { TwitchApiClient, sessionDebugSummary, PROGRESS_POLL_MS, logDebug, logWarn, logInfo },
      {
        ...options,
        onProgress: async (snapshot) => {
          latestProgressSnapshot = snapshot;
          await options.onProgress?.(snapshot);
        },
      },
    );
    if (snapshot) latestProgressSnapshot = snapshot;
    return snapshot;
  }

  async function fetchInventorySnapshot(
    baseDrops: TwitchDrop[],
    forceSessionRefresh = false,
  ): Promise<DropsSnapshot | null> {
    return fetchInventorySnapshotFromApiWrapper(
      state,
      baseDrops,
      forceSessionRefresh,
      {
        onEnsureTwitchSession: ensureTwitchSession,
        onIsLikelyAuthError: isLikelyAuthError,
        onClearTwitchSessionCache: clearTwitchSessionCache,
        onStopFarmingSession: dependencies.recoverTwitchSession,
      },
      { logWarn },
    );
  }

  async function fetchDirectoryStreamers(
    game: TwitchGame,
    forceSessionRefresh = false,
    language = '',
  ): Promise<TwitchStreamer[] & { languageFilterApplied: boolean }> {
    return fetchDirectoryStreamersFromApiWrapper(
      state,
      game,
      forceSessionRefresh,
      language,
      {
        onEnsureTwitchSession: ensureTwitchSession,
        onIsLikelyAuthError: isLikelyAuthError,
        onClearTwitchSessionCache: clearTwitchSessionCache,
      },
      { logWarn },
    );
  }

  async function fetchStreamContext(tabId: number): Promise<StreamContext | null> {
    type StreamContextResponse = { readonly success?: boolean; readonly context?: StreamContext };
    const send = (): Promise<StreamContextResponse> =>
      browser.tabs.sendMessage(tabId, { type: 'GET_STREAM_CONTEXT' });
    const withTimeout = <T>(promise: Promise<T>): Promise<T | null> =>
      Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), 12_000))]);
    let response: StreamContextResponse | null = null;
    try {
      response = await withTimeout(send());
    } catch {
      await ensureContentScriptOnTab(tabId);
      response = await withTimeout(send()).catch(() => null);
    }
    return response?.success && response.context ? response.context : null;
  }

  async function currentInventoryProgress(target: FarmingTarget): Promise<number | null> {
    const cached = state.cachedDropsSnapshot.length > 0 ? state.cachedDropsSnapshot : state.appState.allDrops;
    const baseDrops = dropsForFarmingTarget(cached, target);
    if (baseDrops.length === 0) {
      return state.appState.currentDrop?.currentMinutes ?? null;
    }
    const snapshot = await fetchInventorySnapshot(baseDrops, true);
    const drops = snapshot?.drops ?? baseDrops;
    const progress = dropsForFarmingTarget(drops, target)
      .map((drop) => drop.currentMinutes)
      .filter((minutes) => Number.isFinite(minutes));
    return progress.length > 0 ? Math.max(...progress) : null;
  }

  async function heartbeat(target: FarmingTarget): Promise<TablessHeartbeat> {
    const session = state.twitchSessionCache ?? (await ensureTwitchSession());
    const userId = session?.userId?.trim();
    if (!userId) {
      return { accepted: false, isLive: true, reason: 'error' };
    }
    const result = await twitchSpadeHeartbeat.heartbeat(target, userId);
    return { ...result, progress: await currentInventoryProgress(target) };
  }

  return {
    ensureContentScriptOnTab,
    ensureTwitchSession,
    fetchDirectoryStreamers,
    fetchDropsSnapshot,
    fetchDropsSnapshotProgressively,
    getLatestProgressSnapshot: () => latestProgressSnapshot,
    fetchInventorySnapshot,
    fetchStreamContext,
    heartbeat,
    persistSessionFromDropsPage: sessionOrchestrator.persistSessionFromDropsPage,
    resolveCategorySlug: (game: TwitchGame) => resolveCategorySlugExt(game, state.appState.availableGames),
    shouldRefreshCampaignsAfterSessionSync: () =>
      sessionOrchestrator.shouldRefreshCampaignsAfterSessionSync(GAMES_STALE_THRESHOLD_MS),
  };
}
