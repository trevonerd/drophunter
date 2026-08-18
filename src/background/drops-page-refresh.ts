import { browser } from '../shared/browser-api.ts';
import type { AppState } from '../types';
import type { GamesCacheRefreshResult } from './games-cache-refresh-state.ts';

const TWITCH_DROPS_PAGE_URL = 'https://www.twitch.tv/drops/campaigns';
const DEFAULT_DROPS_PAGE_READY_TIMEOUT_MS = 60_000;
const DEFAULT_CAMPAIGN_REFRESH_ATTEMPTS = 3;
const DEFAULT_CAMPAIGN_REFRESH_RETRY_DELAY_MS = 500;

interface DropsPageState {
  appState: AppState;
}

interface TwitchTab {
  id?: number;
}

interface TabsApi {
  query(queryInfo: { url: string[] }): Promise<TwitchTab[]>;
  update(tabId: number, updateProperties: { active: boolean }): Promise<unknown>;
  create(createProperties: { url: string; active: boolean }): Promise<TwitchTab | null>;
}

interface DropsPageRefreshOptions {
  tabsApi?: TabsApi;
  trackActivity: (reason: string) => Promise<unknown> | unknown;
  ensureStateHydratedForCache: () => Promise<unknown> | unknown;
  waitForTabComplete: (tabId: number, timeoutMs?: number) => Promise<unknown> | unknown;
  persistSessionFromDropsPage: (tabId: number) => Promise<unknown>;
  refreshGamesCacheFromHiddenFetch: (options: {
    forceSessionRefresh?: boolean;
    acceptAuthoritativeEmpty?: boolean;
    requireFreshSnapshot?: boolean;
  }) => Promise<GamesCacheRefreshResult>;
  saveState: () => Promise<unknown> | unknown;
  broadcastStateUpdate: (appState: AppState) => void;
  dropsPageReadyTimeoutMs?: number;
  campaignRefreshAttempts?: number;
  campaignRefreshRetryDelayMs?: number;
}

export interface DropsPageRefreshResult {
  success: boolean;
  opened: boolean;
  refreshed: boolean;
  gamesCount: number;
  appState?: AppState;
  error?: string;
}

interface OpenDropsPageRefreshOptions {
  waitForRefresh?: boolean;
  active?: boolean;
}

export function createDropsPageRefresher(state: DropsPageState, options: DropsPageRefreshOptions) {
  const getTabsApi = () => options.tabsApi ?? browser.tabs;
  let openAndRefreshInFlight: Promise<DropsPageRefreshResult> | null = null;
  let refreshInFlight: Promise<DropsPageRefreshResult> | null = null;
  const wait = (delayMs: number) =>
    delayMs <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, delayMs));

  const findOrOpenDropsPageTab = async (
    active: boolean,
  ): Promise<{ tabId: number | null; opened: boolean }> => {
    const existingTabs = await getTabsApi()
      .query({ url: ['https://www.twitch.tv/drops/campaigns*', 'https://twitch.tv/drops/campaigns*'] })
      .catch(() => []);
    const existing = existingTabs.find((tab) => typeof tab.id === 'number');
    if (existing?.id) {
      if (active) {
        await getTabsApi()
          .update(existing.id, { active })
          .catch(() => undefined);
      }
      return { tabId: existing.id, opened: false };
    }

    const created = await getTabsApi()
      .create({ url: TWITCH_DROPS_PAGE_URL, active })
      .catch(() => null);
    return { tabId: created?.id ?? null, opened: true };
  };

  const publishRefreshState = async (
    inProgress: boolean,
    stateOptions: {
      attemptAt?: number;
      completedAt?: number | null;
      campaignCount?: number | null;
      error?: string | null;
    } = {},
  ) => {
    state.appState.dropsPageRefreshInProgress = inProgress;
    if (stateOptions.attemptAt !== undefined) {
      state.appState.lastDropsPageRefreshAttemptAt = stateOptions.attemptAt;
    }
    if (stateOptions.completedAt !== undefined) {
      state.appState.lastDropsPageRefreshCompletedAt = stateOptions.completedAt;
    }
    if (stateOptions.campaignCount !== undefined) {
      state.appState.lastDropsPageRefreshCampaignCount = stateOptions.campaignCount;
    }
    if ('error' in stateOptions) {
      state.appState.lastDropsPageRefreshError = stateOptions.error;
    }
    await options.saveState();
    options.broadcastStateUpdate(state.appState as AppState);
  };

  const refreshCampaignsUntilReady = async (
    tabId: number,
    startedAt: number,
  ): Promise<{ gamesCount: number; sawSession: boolean; snapshotAvailable: boolean }> => {
    const attempts = Math.max(
      1,
      Math.floor(options.campaignRefreshAttempts ?? DEFAULT_CAMPAIGN_REFRESH_ATTEMPTS),
    );
    const retryDelayMs = Math.max(
      0,
      options.campaignRefreshRetryDelayMs ?? DEFAULT_CAMPAIGN_REFRESH_RETRY_DELAY_MS,
    );
    const readyTimeoutMs = Math.max(
      1,
      options.dropsPageReadyTimeoutMs ?? DEFAULT_DROPS_PAGE_READY_TIMEOUT_MS,
    );
    const deadline = startedAt + readyTimeoutMs;
    let sawSession = false;
    let gamesCount = 0;
    let snapshotAvailable = false;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const isFinalAttemptByCount = attempt === attempts;
      const isFinalAttemptByTime = Date.now() >= deadline;
      const sessionFromTab = await options.persistSessionFromDropsPage(tabId);
      sawSession = sawSession || Boolean(sessionFromTab);
      const refreshResult = await options.refreshGamesCacheFromHiddenFetch({
        forceSessionRefresh: !sessionFromTab,
        acceptAuthoritativeEmpty: isFinalAttemptByCount || isFinalAttemptByTime,
        requireFreshSnapshot: true,
      });

      if (refreshResult.kind === 'refreshed') {
        gamesCount = refreshResult.games.length;
      } else {
        gamesCount = state.appState.availableGames.length;
      }
      if (refreshResult.kind === 'refreshed' && gamesCount > 0) {
        snapshotAvailable = true;
        break;
      }
      if (refreshResult.kind === 'refreshed' && (isFinalAttemptByCount || isFinalAttemptByTime)) {
        snapshotAvailable = true;
        break;
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        break;
      }
      await wait(Math.min(retryDelayMs, remainingMs));
    }

    return { gamesCount, sawSession, snapshotAvailable };
  };

  const refreshFromDropsPageTab = (tabId: number, opened: boolean): Promise<DropsPageRefreshResult> => {
    if (refreshInFlight) {
      return refreshInFlight;
    }

    refreshInFlight = (async () => {
      let result: DropsPageRefreshResult;
      try {
        const startedAt = Date.now();
        await options.waitForTabComplete(
          tabId,
          options.dropsPageReadyTimeoutMs ?? DEFAULT_DROPS_PAGE_READY_TIMEOUT_MS,
        );
        const { gamesCount, sawSession, snapshotAvailable } = await refreshCampaignsUntilReady(
          tabId,
          startedAt,
        );

        result = {
          success: snapshotAvailable,
          opened,
          refreshed: snapshotAvailable,
          gamesCount,
        };
        if (!snapshotAvailable) {
          result.error = sawSession
            ? 'Twitch campaign data is temporarily unavailable. Try again.'
            : 'Open Twitch and sign in so DropHunter can detect your session.';
        }
      } catch (error) {
        result = {
          success: false,
          opened,
          refreshed: false,
          gamesCount: state.appState.availableGames.length,
          error: String(error),
        };
      }

      await publishRefreshState(false, {
        completedAt: result.success ? Date.now() : undefined,
        campaignCount: result.success ? result.gamesCount : undefined,
        error: result.success ? null : result.error || 'Refresh failed.',
      });
      return {
        ...result,
        appState: state.appState,
      };
    })().finally(() => {
      refreshInFlight = null;
    });

    return refreshInFlight;
  };

  const openAndMaybeRefresh = async (
    waitForRefresh: boolean,
    active: boolean,
  ): Promise<DropsPageRefreshResult> => {
    await options.trackActivity('open-drops-page-and-refresh');
    await options.ensureStateHydratedForCache();

    const { tabId, opened } = await findOrOpenDropsPageTab(active);
    if (!tabId) {
      const error = 'Unable to open the Twitch Drops page.';
      await publishRefreshState(false, {
        attemptAt: Date.now(),
        error,
      });
      return {
        success: false,
        opened: false,
        refreshed: false,
        gamesCount: state.appState.availableGames.length,
        error,
      };
    }

    await publishRefreshState(true, {
      attemptAt: Date.now(),
      error: null,
    });

    if (!waitForRefresh) {
      const refreshPromise = refreshFromDropsPageTab(tabId, opened);
      refreshPromise.catch(() => undefined);
      return {
        success: true,
        opened,
        refreshed: false,
        gamesCount: state.appState.availableGames.length,
      };
    }

    const refreshPromise = refreshFromDropsPageTab(tabId, opened);
    return refreshPromise;
  };

  const openDropsPageAndRefresh = (
    openOptions: OpenDropsPageRefreshOptions = {},
  ): Promise<DropsPageRefreshResult> => {
    const active = openOptions.active !== false;
    if (openOptions.waitForRefresh === false) {
      return openAndMaybeRefresh(false, active);
    }

    if (openAndRefreshInFlight) {
      return openAndRefreshInFlight;
    }

    openAndRefreshInFlight = openAndMaybeRefresh(true, active).finally(() => {
      openAndRefreshInFlight = null;
    });
    return openAndRefreshInFlight;
  };

  return { openDropsPageAndRefresh };
}
