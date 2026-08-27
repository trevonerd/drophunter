import { browser } from '../shared/browser-api.ts';
import type { AppState } from '../types';
import { TWITCH_DROPS_PAGE_URL } from './constants.ts';
import type { GamesCacheRefreshResult } from './games-cache-refresh-state.ts';

export interface DropsPageState {
  appState: AppState;
}
export interface TwitchTab {
  id?: number;
  discarded?: boolean;
}
export interface TabsApi {
  query(queryInfo: { url: string[] }): Promise<TwitchTab[]>;
  update(tabId: number, updateProperties: { active?: boolean; url?: string }): Promise<unknown>;
  create(createProperties: { url: string; active: boolean }): Promise<TwitchTab | null>;
}
export interface DropsPageRefreshOptions {
  tabsApi?: TabsApi;
  trackActivity: (reason: string) => Promise<unknown> | unknown;
  ensureStateHydratedForCache: () => Promise<unknown> | unknown;
  waitForTabComplete: (tabId: number, timeoutMs?: number) => Promise<unknown> | unknown;
  persistSessionFromDropsPage: (tabId: number) => Promise<unknown>;
  refreshGamesCacheFromHiddenFetch: (options: {
    forceSessionRefresh?: boolean;
    acceptAuthoritativeEmpty?: boolean;
    requireFreshSnapshot?: boolean;
    onProgressiveSnapshotApplied?: () => Promise<void> | void;
  }) => Promise<GamesCacheRefreshResult>;
  saveState: () => Promise<unknown> | unknown;
  broadcastStateUpdate: (appState: AppState) => void;
  dropsPageReadyTimeoutMs?: number;
  campaignRefreshAttempts?: number;
  campaignRefreshRetryDelayMs?: number;
}

export const waitForDropsDelay = (delayMs: number) =>
  delayMs <= 0 ? Promise.resolve() : new Promise<void>((resolve) => setTimeout(resolve, delayMs));

export async function findOrOpenDropsPageTab(
  options: DropsPageRefreshOptions,
  active: boolean,
  openIfMissing: boolean,
  waitForExistingTabMs: number,
): Promise<{ tabId: number | null; opened: boolean }> {
  const tabsApi = options.tabsApi ?? browser.tabs;
  const deadline = Date.now() + Math.max(0, waitForExistingTabMs);
  let existing: TwitchTab | undefined;
  do {
    const tabs = await tabsApi
      .query({
        url: ['https://www.twitch.tv/drops/campaigns*', 'https://twitch.tv/drops/campaigns*'],
      })
      .catch(() => []);
    existing = tabs.find((tab) => typeof tab.id === 'number');
    if (existing || Date.now() >= deadline) break;
    await waitForDropsDelay(Math.min(250, deadline - Date.now()));
  } while (!existing);
  if (existing?.id) {
    if (existing.discarded)
      await tabsApi.update(existing.id, { url: TWITCH_DROPS_PAGE_URL }).catch(() => undefined);
    if (active) await tabsApi.update(existing.id, { active }).catch(() => undefined);
    return { tabId: existing.id, opened: false };
  }
  if (!openIfMissing) return { tabId: null, opened: false };
  const created = await tabsApi.create({ url: TWITCH_DROPS_PAGE_URL, active }).catch(() => null);
  return { tabId: created?.id ?? null, opened: true };
}

export async function publishDropsPageRefreshState(
  state: DropsPageState,
  options: DropsPageRefreshOptions,
  inProgress: boolean,
  values: {
    attemptAt?: number;
    completedAt?: number | null;
    campaignCount?: number | null;
    error?: string | null;
  } = {},
) {
  state.appState.dropsPageRefreshInProgress = inProgress;
  if (values.attemptAt !== undefined) state.appState.lastDropsPageRefreshAttemptAt = values.attemptAt;
  if (values.completedAt !== undefined) state.appState.lastDropsPageRefreshCompletedAt = values.completedAt;
  if (values.campaignCount !== undefined)
    state.appState.lastDropsPageRefreshCampaignCount = values.campaignCount;
  if ('error' in values) state.appState.lastDropsPageRefreshError = values.error;
  await options.saveState();
  options.broadcastStateUpdate(state.appState);
}
