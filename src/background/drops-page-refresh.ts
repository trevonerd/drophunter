import type { AppState } from '../types';
import {
  type DropsPageRefreshOptions,
  type DropsPageState,
  findOrOpenDropsPageTab,
  publishDropsPageRefreshState,
  waitForDropsDelay,
} from './drops-page-tab-lifecycle.ts';

const DEFAULT_DROPS_PAGE_READY_TIMEOUT_MS = 10_000;
const DEFAULT_CAMPAIGN_REFRESH_ATTEMPTS = 3;
const DEFAULT_CAMPAIGN_REFRESH_RETRY_DELAY_MS = 500;

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
    let initialSnapshotPublished = false;

    const publishInitialSnapshot = async () => {
      if (initialSnapshotPublished) return;
      initialSnapshotPublished = true;
      gamesCount = state.appState.availableGames.length;
      snapshotAvailable = true;
      // A verified campaign batch is enough to let the user act on the
      // visible Drops. Do not keep the popup's global loader hostage to
      // unrelated campaign detail requests that are still running.
      await publishRefreshState(false, {
        completedAt: Date.now(),
        campaignCount: gamesCount,
        error: null,
      });
    };

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const isFinalAttemptByCount = attempt === attempts;
      const isFinalAttemptByTime = Date.now() >= deadline;
      const sessionFromTab = await options.persistSessionFromDropsPage(tabId);
      sawSession = sawSession || Boolean(sessionFromTab);
      const refreshResult = await options.refreshGamesCacheFromHiddenFetch({
        forceSessionRefresh: !sessionFromTab,
        acceptAuthoritativeEmpty: isFinalAttemptByCount || isFinalAttemptByTime,
        requireFreshSnapshot: true,
        onProgressiveSnapshotApplied: publishInitialSnapshot,
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
      await waitForDropsDelay(Math.min(retryDelayMs, remainingMs));
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
    openIfMissing: boolean,
    waitForExistingTabMs: number,
  ): Promise<DropsPageRefreshResult> => {
    await options.trackActivity('open-drops-page-and-refresh');
    await options.ensureStateHydratedForCache();

    const { tabId, opened } = await findOrOpenDropsPageTab(
      options,
      active,
      openIfMissing,
      waitForExistingTabMs,
    );
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
    const openIfMissing = openOptions.openIfMissing !== false;
    const waitForExistingTabMs = Math.max(0, openOptions.waitForExistingTabMs ?? 0);
    if (openOptions.waitForRefresh === false) {
      return openAndMaybeRefresh(false, active, openIfMissing, waitForExistingTabMs);
    }

    if (openAndRefreshInFlight) {
      return openAndRefreshInFlight;
    }

    openAndRefreshInFlight = openAndMaybeRefresh(true, active, openIfMissing, waitForExistingTabMs).finally(
      () => {
        openAndRefreshInFlight = null;
      },
    );
    return openAndRefreshInFlight;
  };

  return { openDropsPageAndRefresh };
}
