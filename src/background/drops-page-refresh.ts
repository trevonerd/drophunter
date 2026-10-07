import { browser } from '../shared/browser-api.ts';
import type { AppState } from '../types';
import { refreshDropsPageCampaigns } from './drops-page-campaign-refresh.ts';
import {
  createDropsPageTabConsumers,
  type DropsPageRefreshOptions,
  type DropsPageState,
  publishDropsPageRefreshState,
} from './drops-page-tab-lifecycle.ts';
import { classifyTwitchApiFailure, type TwitchApiFailure } from './twitch-api/errors.ts';

const DEFAULT_DROPS_PAGE_READY_TIMEOUT_MS = 10_000;
const DROPS_PAGE_OPERATION_TIMEOUT_MS = 60_000;

export interface DropsPageRefreshResult {
  success: boolean;
  opened: boolean;
  refreshed: boolean;
  gamesCount: number;
  appState?: AppState;
  error?: string;
  inventoryVerified?: boolean;
  failure?: TwitchApiFailure;
}

interface OpenDropsPageRefreshOptions {
  waitForRefresh?: boolean;
  active?: boolean;
  openIfMissing?: boolean;
  waitForExistingTabMs?: number;
  isCurrent?: () => boolean;
  closeAfterRefresh?: boolean;
}

export function createDropsPageRefresher(state: DropsPageState, options: DropsPageRefreshOptions) {
  let openAndRefreshInFlight: Promise<DropsPageRefreshResult> | null = null;
  let refreshInFlight: Promise<DropsPageRefreshResult> | null = null;
  let openIsCurrent: (() => boolean) | null = null;
  let refreshIsCurrent: (() => boolean) | null = null;
  let openRetention: { keep: boolean; active: boolean } | null = null;
  const consumers = createDropsPageTabConsumers(state, options);
  const cancelledResult = (): DropsPageRefreshResult => ({
    success: false,
    opened: false,
    refreshed: false,
    gamesCount: state.appState.availableGames.length,
  });
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
    if (refreshInFlight && refreshIsCurrent?.()) {
      return refreshInFlight;
    }

    refreshIsCurrent = isCurrent;
    const operation = (async () => {
      let result: DropsPageRefreshResult;
      try {
        const startedAt = Date.now();
        await options.waitForTabComplete(
          tabId,
          options.dropsPageReadyTimeoutMs ?? DEFAULT_DROPS_PAGE_READY_TIMEOUT_MS,
        );
        if (!isCurrent()) return cancelledResult();
        const { gamesCount, sawSession, snapshotAvailable, inventoryVerified, failure } =
          await refreshDropsPageCampaigns({
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
          inventoryVerified,
          ...(failure ? { failure } : {}),
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
          failure: classifyTwitchApiFailure(error),
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
      if (refreshInFlight === operation) {
        refreshInFlight = null;
        refreshIsCurrent = null;
      }
    });
    refreshInFlight = operation;
    return operation;
  };

  const openAndMaybeRefresh = async (
    waitForRefresh: boolean,
    openIfMissing: boolean,
    waitForExistingTabMs: number,
    isCurrent: () => boolean,
    retention: { keep: boolean; active: boolean },
  ): Promise<DropsPageRefreshResult> => {
    if (!isCurrent())
      return {
        success: false,
        opened: false,
        refreshed: false,
        gamesCount: state.appState.availableGames.length,
      };
    await options.trackActivity('open-drops-page-and-refresh');
    if (!isCurrent()) return cancelledResult();
    await options.ensureStateHydratedForCache();
    if (!isCurrent()) return cancelledResult();

    const requestedActive = retention.active;
    const { tabId, opened } = await consumers.acquire(
      requestedActive,
      openIfMissing,
      waitForExistingTabMs,
      isCurrent,
      retention,
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

    let refreshOwnsRelease = false;
    try {
      if (!isCurrent()) return cancelledResult();
      if (retention.active && !requestedActive)
        await (options.tabsApi ?? browser.tabs).update(tabId, { active: true }).catch(() => undefined);
      if (!isCurrent()) return cancelledResult();
      await publishRefreshState(true, {
        attemptAt: Date.now(),
        error: null,
      });
      if (!isCurrent()) return cancelledResult();

      const refreshPromise = refreshFromDropsPageTab(tabId, opened, isCurrent);
      const ownedRefresh = refreshPromise.then(
        async (result) => {
          await consumers.release(tabId, result, retention);
          return result;
        },
        async (error: unknown) => {
          await consumers.release(tabId, cancelledResult(), retention);
          throw error;
        },
      );
      refreshOwnsRelease = true;
      if (!waitForRefresh) {
        ownedRefresh.catch(() => undefined);
        return {
          success: true,
          opened,
          refreshed: false,
          gamesCount: state.appState.availableGames.length,
        };
      }

      return await ownedRefresh;
    } finally {
      if (!refreshOwnsRelease) await consumers.release(tabId, cancelledResult(), retention);
    }
  };

  const openDropsPageAndRefresh = (
    openOptions: OpenDropsPageRefreshOptions = {},
  ): Promise<DropsPageRefreshResult> => {
    const active = openOptions.active !== false;
    const openIfMissing = openOptions.openIfMissing !== false;
    const waitForExistingTabMs = Math.max(0, openOptions.waitForExistingTabMs ?? 0);
    const externalIsCurrent = openOptions.isCurrent ?? (() => true);
    const deadline = Date.now() + DROPS_PAGE_OPERATION_TIMEOUT_MS;
    const isCurrent = () => Date.now() < deadline && externalIsCurrent();
    const retention = { keep: openOptions.closeAfterRefresh !== true || active, active };
    if (openOptions.waitForRefresh === false) {
      return openAndMaybeRefresh(false, openIfMissing, waitForExistingTabMs, isCurrent, retention);
    }

    if (openAndRefreshInFlight && openIsCurrent?.()) {
      if (retention.keep) {
        const activate = active && openRetention?.active === false;
        if (openRetention) {
          openRetention.keep = true;
          openRetention.active ||= active;
        }
        consumers.retain(activate);
      }
      return openAndRefreshInFlight;
    }

    openIsCurrent = isCurrent;
    openRetention = retention;
    const operation = openAndMaybeRefresh(
      true,
      openIfMissing,
      waitForExistingTabMs,
      isCurrent,
      retention,
    ).finally(() => {
      if (openAndRefreshInFlight === operation) {
        openAndRefreshInFlight = null;
        openIsCurrent = null;
        openRetention = null;
      }
    });
    openAndRefreshInFlight = operation;
    return operation;
  };

  return { openDropsPageAndRefresh };
}
