import { browser } from '../shared/browser-api.ts';
import { campaignRejectionReason } from '../shared/campaign-eligibility.ts';
import { gameKey, resolveCategorySlug as resolveCategorySlugExt } from '../shared/game-selection.ts';
import { isRewardAcquired } from '../shared/reward-semantics.ts';
import type { DropsSnapshot, TwitchDrop, TwitchGame, TwitchStreamer } from '../types/index.ts';
import {
  applyApiBackoff,
  clearLastTwitchApiFailure,
  fetchDirectoryStreamersFromApiWrapper,
  fetchDropsSnapshotFromApiWrapper,
  fetchInventorySnapshotFromApiWrapper,
  getLastTwitchApiFailure,
} from './api-operations.ts';
import { PROGRESS_POLL_MS } from './constants.ts';
import { normalizeFarmingAutomationSnapshot } from './farming-automation-normalization.ts';
import type { StreamContext } from './farming-session.ts';
import { currentFarmingSessionEpoch } from './farming-session-revision.ts';
import { logDebug, logInfo, logWarn } from './logging.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { bindCampaignEvidenceAccount } from './session-account-evidence.ts';
import {
  clearTwitchSessionCache,
  currentTwitchSessionRevision,
  discardPersistedTwitchSessionIfMatches,
  ensureSessionIntegrity,
  ensureTwitchSession as ensureTwitchSessionExt,
  persistTwitchSession,
  readTwitchSessionViaExecuteScript,
} from './session-management.ts';
import { createSessionOrchestrator, type TwitchApiRequestOptions } from './session-orchestrator.ts';
import { sessionDebugSummary } from './state-persistence.ts';
import { waitForTabComplete } from './tab-management.ts';
import { type FetchDropsSnapshotOptions, TwitchApiClient } from './twitch-api/client.ts';
import { classifyTwitchApiFailure, type TwitchApiFailure } from './twitch-api/errors.ts';
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

export function normalizeFreshFarmableGame(snapshot: DropsSnapshot, game: TwitchGame) {
  const normalizedSnapshot = normalizeFarmingAutomationSnapshot(snapshot);
  const normalizedGame = normalizedSnapshot.games.find(
    (candidate) =>
      gameKey({
        ...candidate,
        allowedChannels: candidate.allowedChannels
          ? [...candidate.allowedChannels]
          : candidate.allowedChannels,
      }) === gameKey(game),
  );
  const candidate = normalizedGame
    ? {
        ...normalizedGame,
        allowedChannels: normalizedGame.allowedChannels
          ? [...normalizedGame.allowedChannels]
          : normalizedGame.allowedChannels,
      }
    : null;
  if (
    !candidate ||
    campaignRejectionReason(candidate) !== null ||
    candidate.rewardSummary?.completion !== 'farmable'
  ) {
    return null;
  }
  return {
    game: candidate,
    snapshot: normalizedSnapshot,
  };
}

interface ServiceWorkerTwitchGatewayDependencies {
  readonly recoverTwitchSession: (options: {
    readonly notification?: { readonly title: string; readonly message: string };
    readonly stopReason?: string;
    readonly stopMessage?: string | null;
  }) => Promise<void>;
  readonly resumeAfterAuthRecovery?: () => Promise<void>;
}

export function createServiceWorkerTwitchGateway(
  state: ServiceWorkerState,
  dependencies: ServiceWorkerTwitchGatewayDependencies,
) {
  const sessionOrchestrator = createSessionOrchestrator(state, {
    authRecoveryTimeoutMs: 50_000,
    sanitizeTwitchSession,
    sessionDebugSummary,
    readTwitchSessionViaExecuteScript,
    persistTwitchSession: async (session) => {
      await bindCampaignEvidenceAccount(state, session.userId);
      await persistTwitchSession(session);
    },
    discardPersistedTwitchSessionIfMatches,
    validateRecoveredTwitchSession: async (session) => {
      try {
        const currentUserId = await new TwitchApiClient(session).fetchCurrentUserId();
        return currentUserId === session.userId;
      } catch (error) {
        logWarn('Recovered Twitch session failed semantic validation', { error: String(error) });
        if (classifyTwitchApiFailure(error).kind === 'auth') return false;
        throw error;
      }
    },
    getSessionRevision: () => currentTwitchSessionRevision(state),
    waitForTabComplete,
    logDebug,
    logWarn,
  });
  const twitchSpadeHeartbeat = createTwitchSpadeHeartbeat({ clientId: DEFAULT_TWITCH_CLIENT_ID });
  let latestProgressSnapshot: DropsSnapshot | null = null;
  let latestTwitchApiFailure: TwitchApiFailure | null = null;

  function authResumeGuard(): () => boolean {
    const epoch = currentFarmingSessionEpoch(state);
    const shouldResume =
      state.appState.lastStopReason === 'sign-in-required' ||
      (state.appState.isRunning && state.appState.twitchSessionSyncState.status === 'retrying');
    return () =>
      shouldResume &&
      currentFarmingSessionEpoch(state) === epoch &&
      !state.appState.isPaused &&
      (!state.appState.lastStopReason || state.appState.lastStopReason === 'sign-in-required');
  }

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

  async function fetchDropsSnapshot(
    requestOptions: TwitchApiRequestOptions = {},
  ): Promise<DropsSnapshot | null> {
    const shouldResume = authResumeGuard();
    clearLastTwitchApiFailure(state);
    const snapshot = await fetchDropsSnapshotFromApiWrapper(
      state,
      requestOptions,
      {
        onEnsureTwitchSession: ensureTwitchSession,
        onRecoverTwitchSessionAfterAuthError: sessionOrchestrator.recoverTwitchSessionAfterAuthError,
        onEnsureSessionIntegrity: ensureSessionIntegrity,
        onPersistTwitchSession: persistTwitchSession,
        onStopFarmingSession: dependencies.recoverTwitchSession,
        onIsLikelyAuthError: isLikelyAuthError,
        onClearTwitchSessionCache: clearTwitchSessionCache,
      },
      { TwitchApiClient, sessionDebugSummary, PROGRESS_POLL_MS, logDebug, logWarn, logInfo },
    );
    latestTwitchApiFailure = getLastTwitchApiFailure(state);
    if (snapshot && shouldResume()) await dependencies.resumeAfterAuthRecovery?.();
    return snapshot;
  }

  async function fetchDropsSnapshotProgressively(
    options: FetchDropsSnapshotOptions = {},
    requestOptions: TwitchApiRequestOptions = {},
  ): Promise<DropsSnapshot | null> {
    const shouldResume = authResumeGuard();
    latestProgressSnapshot = null;
    clearLastTwitchApiFailure(state);
    const snapshot = await fetchDropsSnapshotFromApiWrapper(
      state,
      requestOptions,
      {
        onEnsureTwitchSession: ensureTwitchSession,
        onRecoverTwitchSessionAfterAuthError: sessionOrchestrator.recoverTwitchSessionAfterAuthError,
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
    latestTwitchApiFailure = getLastTwitchApiFailure(state);
    if (snapshot) latestProgressSnapshot = snapshot;
    if (snapshot && shouldResume()) await dependencies.resumeAfterAuthRecovery?.();
    return snapshot;
  }

  async function fetchInventorySnapshot(
    baseDrops: TwitchDrop[],
    requestOptions: TwitchApiRequestOptions = {},
  ): Promise<DropsSnapshot | null> {
    return fetchInventorySnapshotFromApiWrapper(
      state,
      baseDrops,
      requestOptions,
      {
        onEnsureTwitchSession: ensureTwitchSession,
        onRecoverTwitchSessionAfterAuthError: sessionOrchestrator.recoverTwitchSessionAfterAuthError,
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
    isCurrent?: () => boolean,
    requestOptions?: {
      readonly sessionRecoveryMode?: 'passive' | 'background-tab';
      readonly preserveSessionOnAuthFailure?: boolean;
    },
  ): Promise<TwitchStreamer[] & { languageFilterApplied: boolean }> {
    return fetchDirectoryStreamersFromApiWrapper(
      state,
      game,
      forceSessionRefresh,
      language,
      {
        onEnsureTwitchSession: ensureTwitchSession,
        onRecoverTwitchSessionAfterAuthError: sessionOrchestrator.recoverTwitchSessionAfterAuthError,
        onStopFarmingSession: dependencies.recoverTwitchSession,
        onIsLikelyAuthError: isLikelyAuthError,
        onClearTwitchSessionCache: clearTwitchSessionCache,
        isCurrent,
      },
      { logWarn },
      requestOptions,
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

  function currentCachedProgress(target: FarmingTarget): number | null {
    const cached = state.cachedDropsSnapshot.length > 0 ? state.cachedDropsSnapshot : state.appState.allDrops;
    const baseDrops = dropsForFarmingTarget(cached, target);
    if (baseDrops.length === 0) {
      return state.appState.currentDrop?.currentMinutes ?? null;
    }
    const progress = baseDrops
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
    return { ...result, progress: currentCachedProgress(target) };
  }

  async function probeStreamInfo(channelName: string) {
    if (state.apiBackoffUntil > Date.now()) return { kind: 'unavailable' as const };
    try {
      return await twitchSpadeHeartbeat.probeStreamInfo(channelName);
    } catch (error) {
      const failure = classifyTwitchApiFailure(error);
      if (failure.kind === 'rate-limit') applyApiBackoff(state, failure.retryAfterMs);
      return { kind: 'unavailable' as const, cause: error };
    }
  }

  async function refreshVerifiedGame(game: TwitchGame, isCurrent: () => boolean = () => true) {
    if (!isCurrent() || state.apiBackoffUntil > Date.now()) return null;
    const initialUserId = state.twitchSessionCache?.userId ?? null;
    const refreshStartedAt = Date.now();
    const snapshot = await fetchDropsSnapshot({
      sessionRecoveryMode: 'background-tab',
      preserveSessionOnAuthFailure: true,
    });
    if (
      !snapshot ||
      !isCurrent() ||
      (state.twitchSessionCache?.userId ?? null) !== initialUserId ||
      snapshot.campaignsVerified !== true ||
      snapshot.inventoryVerified !== true ||
      snapshot.updatedAt < refreshStartedAt
    ) {
      return null;
    }
    const normalized = normalizeFreshFarmableGame(snapshot, game);
    if (!normalized) return null;
    const { game: refreshedGame, snapshot: normalizedSnapshot } = normalized;
    const campaignIds = new Set(
      normalizedSnapshot.drops
        .filter(
          (drop) =>
            drop.campaignId === game.campaignId &&
            !isRewardAcquired({
              ...drop,
              benefitIds: drop.benefitIds ? [...drop.benefitIds] : undefined,
              rewardDistributionTypes: drop.rewardDistributionTypes
                ? [...drop.rewardDistributionTypes]
                : undefined,
            }),
        )
        .map((drop) => drop.campaignId)
        .filter((campaignId): campaignId is string => Boolean(campaignId)),
    );
    let allowedChannels: string[] | null = refreshedGame.allowedChannels ?? null;
    if (campaignIds.size > 0) {
      let unrestricted = false;
      const restricted: string[] = [];
      for (const campaignId of campaignIds) {
        const channels = snapshot.campaignChannelsMap?.[campaignId];
        if (channels == null) unrestricted = true;
        else restricted.push(...channels);
      }
      allowedChannels = unrestricted ? null : [...new Set(restricted)];
    }
    return { ...refreshedGame, allowedChannels };
  }

  return {
    ensureContentScriptOnTab,
    ensureTwitchSession,
    fetchDirectoryStreamers,
    fetchDropsSnapshot,
    fetchDropsSnapshotProgressively,
    getLastTwitchApiFailure: () => latestTwitchApiFailure,
    getLatestProgressSnapshot: () => latestProgressSnapshot,
    fetchInventorySnapshot,
    fetchStreamContext,
    heartbeat,
    probeStreamInfo,
    refreshVerifiedGame,
    persistSessionFromDropsPage: sessionOrchestrator.persistSessionFromDropsPage,
    resolveCategorySlug: (game: TwitchGame) => resolveCategorySlugExt(game, state.appState.availableGames),
    shouldRefreshCampaignsAfterSessionSync: () =>
      sessionOrchestrator.shouldRefreshCampaignsAfterSessionSync(GAMES_STALE_THRESHOLD_MS),
  };
}
