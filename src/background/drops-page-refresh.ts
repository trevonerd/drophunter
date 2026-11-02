import type { AppState } from '../types';
import {
  DEFAULT_DROPS_PAGE_READY_TIMEOUT_MS,
  refreshDropsPageCampaigns,
} from './drops-page-campaign-refresh.ts';
import {
  activateDropsPageTab,
  createDropsPageTabConsumers,
  type DropsPageRefreshOptions,
  type DropsPageState,
  publishDropsPageRefreshState,
} from './drops-page-tab-lifecycle.ts';
import { classifyTwitchApiFailure, type TwitchApiFailure } from './twitch-api/errors.ts';

const DROPS_PAGE_OPERATION_TIMEOUT_MS = 75_000;

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

interface DropsPageRetention {
  keep: boolean;
  active: boolean;
  openIfMissing: boolean;
  isCurrent: () => boolean;
}

export function createDropsPageRefresher(state: DropsPageState, options: DropsPageRefreshOptions) {
  let openAndRefreshInFlight: Promise<DropsPageRefreshResult> | null = null;
  // Foreground clicks share native acquisition without waiting for the shared refresh.
  let openingReady: Promise<DropsPageRefreshResult> | null = null;
  let refreshInFlight: Promise<DropsPageRefreshResult> | null = null;
  let openIsCurrent: (() => boolean) | null = null;
  let refreshIsCurrent: (() => boolean) | null = null;
  let openRetention: DropsPageRetention | null = null;
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

  const openAndRefresh = async (
    waitForExistingTabMs: number,
    isCurrent: () => boolean,
    retention: DropsPageRetention,
    onOpened: (result: DropsPageRefreshResult) => void,
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
    const { tabId, opened, windowId } = await consumers.acquire(
      requestedActive,
      () => retention.openIfMissing,
      waitForExistingTabMs,
      isCurrent,
      retention,
    );
    if (!tabId) {
      const error = retention.openIfMissing
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
        await activateDropsPageTab(options, tabId, windowId, isCurrent);
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
      onOpened({ success: true, opened, refreshed: false, gamesCount: state.appState.availableGames.length });

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
    const retention = {
      keep: openOptions.closeAfterRefresh !== true || active,
      active,
      openIfMissing,
      isCurrent: () => Date.now() < deadline && externalIsCurrent(),
    };
    const isCurrent = () => retention.isCurrent();
    const waitForRefresh = openOptions.waitForRefresh !== false;

    if (openAndRefreshInFlight && openIsCurrent?.()) {
      if (retention.keep) {
        const activate = active && (openRetention?.active === false || !waitForRefresh);
        if (openRetention) {
          openRetention.keep = true;
          openRetention.active ||= active;
          openRetention.openIfMissing ||= openIfMissing;
          const previousIsCurrent = openRetention.isCurrent;
          openRetention.isCurrent = () => previousIsCurrent() || isCurrent();
        }
        const retained = consumers.retain(activate, isCurrent);
        if (activate) {
          const operation = waitForRefresh
            ? openAndRefreshInFlight
            : (openingReady ?? openAndRefreshInFlight);
          return retained.then(() => operation);
        }
      }
      return waitForRefresh ? openAndRefreshInFlight : (openingReady ?? openAndRefreshInFlight);
    }

    openIsCurrent = isCurrent;
    openRetention = retention;
    let resolveOpening: (result: DropsPageRefreshResult) => void = () => {};
    let rejectOpening: (error: unknown) => void = () => {};
    const ready = new Promise<DropsPageRefreshResult>((resolve, reject) => {
      resolveOpening = resolve;
      rejectOpening = reject;
    });
    openingReady = ready;
    void ready.catch(() => undefined);
    const operation = openAndRefresh(waitForExistingTabMs, isCurrent, retention, resolveOpening).finally(
      () => {
        if (openAndRefreshInFlight === operation) {
          openAndRefreshInFlight = null;
          openIsCurrent = null;
          openRetention = null;
          openingReady = null;
        }
      },
    );
    openAndRefreshInFlight = operation;
    void operation.then(resolveOpening, rejectOpening);
    return waitForRefresh ? operation : ready;
  };

  return { openDropsPageAndRefresh };
}
