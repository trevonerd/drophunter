import type { AppState } from '../types';
import { refreshDropsPageCampaigns } from './drops-page-campaign-refresh.ts';
import {
  type DropsPageRefreshOptions,
  type DropsPageState,
  findOrOpenDropsPageTab,
  publishDropsPageRefreshState,
} from './drops-page-tab-lifecycle.ts';

const DEFAULT_DROPS_PAGE_READY_TIMEOUT_MS = 10_000;

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
  openIfMissing?: boolean;
  waitForExistingTabMs?: number;
  isCurrent?: () => boolean;
}

export function createDropsPageRefresher(state: DropsPageState, options: DropsPageRefreshOptions) {
  let openAndRefreshInFlight: Promise<DropsPageRefreshResult> | null = null;
  let refreshInFlight: Promise<DropsPageRefreshResult> | null = null;
  const publishRefreshState = async (
    inProgress: boolean,
    stateOptions: {
      attemptAt?: number;
      completedAt?: number | null;
      campaignCount?: number | null;
      error?: string | null;
    } = {},
  ) => {
    await publishDropsPageRefreshState(state, options, inProgress, stateOptions);
  };

  const refreshFromDropsPageTab = (
    tabId: number,
    opened: boolean,
    isCurrent: () => boolean,
  ): Promise<DropsPageRefreshResult> => {
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
        const { gamesCount, sawSession, snapshotAvailable } = await refreshDropsPageCampaigns({
          isCurrent,
          options,
          publishRefreshState,
          startedAt,
          state,
          tabId,
        });

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

      if (!isCurrent()) return result;
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
    openIfMissing: boolean,
    waitForExistingTabMs: number,
    isCurrent: () => boolean,
  ): Promise<DropsPageRefreshResult> => {
    if (!isCurrent())
      return {
        success: false,
        opened: false,
        refreshed: false,
        gamesCount: state.appState.availableGames.length,
      };
    await options.trackActivity('open-drops-page-and-refresh');
    await options.ensureStateHydratedForCache();

    const { tabId, opened } = await findOrOpenDropsPageTab(
      options,
      active,
      openIfMissing,
      waitForExistingTabMs,
    );
    if (!isCurrent())
      return {
        success: false,
        opened: false,
        refreshed: false,
        gamesCount: state.appState.availableGames.length,
      };
    if (!tabId) {
      const error = openIfMissing
        ? 'Unable to open the Twitch Drops page.'
        : 'Open Twitch Drops so DropHunter can detect your session.';
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
      const refreshPromise = refreshFromDropsPageTab(tabId, opened, isCurrent);
      refreshPromise.catch(() => undefined);
      return {
        success: true,
        opened,
        refreshed: false,
        gamesCount: state.appState.availableGames.length,
      };
    }

    const refreshPromise = refreshFromDropsPageTab(tabId, opened, isCurrent);
    return refreshPromise;
  };

  const openDropsPageAndRefresh = (
    openOptions: OpenDropsPageRefreshOptions = {},
  ): Promise<DropsPageRefreshResult> => {
    const active = openOptions.active !== false;
    const openIfMissing = openOptions.openIfMissing !== false;
    const waitForExistingTabMs = Math.max(0, openOptions.waitForExistingTabMs ?? 0);
    const isCurrent = openOptions.isCurrent ?? (() => true);
    if (openOptions.waitForRefresh === false) {
      return openAndMaybeRefresh(false, active, openIfMissing, waitForExistingTabMs, isCurrent);
    }

    if (openAndRefreshInFlight) {
      return openAndRefreshInFlight;
    }

    openAndRefreshInFlight = openAndMaybeRefresh(
      true,
      active,
      openIfMissing,
      waitForExistingTabMs,
      isCurrent,
    ).finally(() => {
      openAndRefreshInFlight = null;
    });
    return openAndRefreshInFlight;
  };

  return { openDropsPageAndRefresh };
}
