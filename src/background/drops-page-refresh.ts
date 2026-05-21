import { browser } from '../shared/browser-api.ts';
import type { AppState } from '../types';

const TWITCH_DROPS_PAGE_URL = 'https://www.twitch.tv/drops/campaigns';

interface DropsPageState {
  appState: Pick<AppState, 'availableGames' | 'dropsPageRefreshInProgress'>;
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
  waitForTabComplete: (tabId: number) => Promise<unknown> | unknown;
  persistSessionFromDropsPage: (tabId: number) => Promise<unknown>;
  refreshGamesCacheFromHiddenFetch: (options: { forceSessionRefresh?: boolean }) => Promise<unknown>;
  saveState: () => Promise<unknown> | unknown;
  broadcastStateUpdate: (appState: AppState) => void;
}

export interface DropsPageRefreshResult {
  success: boolean;
  opened: boolean;
  refreshed: boolean;
  gamesCount: number;
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

  const publishRefreshProgress = async (inProgress: boolean) => {
    state.appState.dropsPageRefreshInProgress = inProgress;
    await options.saveState();
    options.broadcastStateUpdate(state.appState as AppState);
  };

  const refreshFromDropsPageTab = (tabId: number, opened: boolean): Promise<DropsPageRefreshResult> => {
    if (refreshInFlight) {
      return refreshInFlight;
    }

    refreshInFlight = (async () => {
      try {
        await options.waitForTabComplete(tabId);
        const sessionFromTab = await options.persistSessionFromDropsPage(tabId);
        await options.refreshGamesCacheFromHiddenFetch({ forceSessionRefresh: !sessionFromTab });

        const gamesCount = state.appState.availableGames.length;
        const result: DropsPageRefreshResult = {
          success: gamesCount > 0,
          opened,
          refreshed: true,
          gamesCount,
        };
        if (gamesCount === 0) {
          result.error = sessionFromTab
            ? 'No active Twitch Drops campaigns were detected.'
            : 'Open Twitch and sign in so DropHunter can detect your session.';
        }
        return result;
      } catch (error) {
        return {
          success: false,
          opened,
          refreshed: false,
          gamesCount: state.appState.availableGames.length,
          error: String(error),
        };
      } finally {
        await publishRefreshProgress(false);
      }
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
      return {
        success: false,
        opened: false,
        refreshed: false,
        gamesCount: state.appState.availableGames.length,
        error: 'Unable to open the Twitch Drops page.',
      };
    }

    await publishRefreshProgress(true);

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
