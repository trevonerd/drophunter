import type { AppState } from '../types';

const TWITCH_DROPS_PAGE_URL = 'https://www.twitch.tv/drops/campaigns';

interface DropsPageState {
  appState: Pick<AppState, 'availableGames'>;
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

export function createDropsPageRefresher(state: DropsPageState, options: DropsPageRefreshOptions) {
  const getTabsApi = () => options.tabsApi ?? chrome.tabs;
  let refreshInFlight: Promise<DropsPageRefreshResult> | null = null;

  const findOrOpenDropsPageTab = async (): Promise<{ tabId: number | null; opened: boolean }> => {
    const existingTabs = await getTabsApi()
      .query({ url: ['https://www.twitch.tv/drops/campaigns*', 'https://twitch.tv/drops/campaigns*'] })
      .catch(() => []);
    const existing = existingTabs.find((tab) => typeof tab.id === 'number');
    if (existing?.id) {
      await getTabsApi()
        .update(existing.id, { active: true })
        .catch(() => undefined);
      return { tabId: existing.id, opened: false };
    }

    const created = await getTabsApi()
      .create({ url: TWITCH_DROPS_PAGE_URL, active: true })
      .catch(() => null);
    return { tabId: created?.id ?? null, opened: true };
  };

  const openDropsPageAndRefresh = () => {
    if (refreshInFlight) {
      return refreshInFlight;
    }

    refreshInFlight = (async () => {
      await options.trackActivity('open-drops-page-and-refresh');
      await options.ensureStateHydratedForCache();

      const { tabId, opened } = await findOrOpenDropsPageTab();
      if (!tabId) {
        return {
          success: false,
          opened: false,
          refreshed: false,
          gamesCount: state.appState.availableGames.length,
          error: 'Unable to open the Twitch Drops page.',
        };
      }

      await options.waitForTabComplete(tabId);
      const sessionFromTab = await options.persistSessionFromDropsPage(tabId);
      await options.refreshGamesCacheFromHiddenFetch({ forceSessionRefresh: !sessionFromTab });
      await options.saveState();
      options.broadcastStateUpdate(state.appState as AppState);

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
    })().finally(() => {
      refreshInFlight = null;
    });

    return refreshInFlight;
  };

  return { openDropsPageAndRefresh };
}
