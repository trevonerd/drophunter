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
  windowId?: number;
  url?: string;
  pendingUrl?: string;
  active?: boolean;
}
export interface TabsApi {
  query(queryInfo: { url: string[] } | { windowId: number }): Promise<TwitchTab[]>;
  update(tabId: number, updateProperties: { active?: boolean; url?: string }): Promise<unknown>;
  create(createProperties: { url: string; active: boolean }): Promise<TwitchTab | null>;
  get?(tabId: number): Promise<TwitchTab>;
  remove?(tabId: number): Promise<unknown>;
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
    isCurrent?: () => boolean;
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

const TWITCH_DROPS_TAB_PATTERNS = [
  'https://www.twitch.tv/drops/campaigns*',
  'https://twitch.tv/drops/campaigns*',
  'https://www.twitch.tv/drops/inventory*',
  'https://twitch.tv/drops/inventory*',
];

export function createDropsPageTabConsumers(state: DropsPageState, options: DropsPageRefreshOptions) {
  const leases = new Map<number, { users: number; opened: boolean; keep: boolean }>();
  let pending = 0;
  const cleanup = async () => {
    for (const [tabId, lease] of leases) {
      if (pending > 0 || lease.users > 0) continue;
      if (lease.opened && !lease.keep)
        await closeAutomaticDropsPageTab(
          options,
          tabId,
          () => pending === 0 && leases.get(tabId) === lease && lease.users === 0 && !lease.keep,
        );
      if (pending === 0 && leases.get(tabId) === lease && lease.users === 0) leases.delete(tabId);
    }
  };
  return {
    async acquire(
      active: boolean,
      openIfMissing: boolean,
      waitMs: number,
      isCurrent: () => boolean,
      retention: { keep: boolean },
    ) {
      pending += 1;
      try {
        const acquired = await findOrOpenDropsPageTab(options, active, openIfMissing, waitMs, isCurrent);
        if (acquired.tabId) {
          const lease = leases.get(acquired.tabId) ?? { users: 0, opened: acquired.opened, keep: false };
          lease.users += 1;
          lease.keep ||= retention.keep;
          leases.set(acquired.tabId, lease);
        }
        return acquired;
      } finally {
        pending -= 1;
        await cleanup();
      }
    },
    async release(
      tabId: number,
      result: { success: boolean; error?: string; failure?: { kind: string } },
      retention: { keep: boolean },
    ) {
      const lease = leases.get(tabId);
      if (!lease) return;
      lease.keep ||=
        retention.keep ||
        result.failure?.kind === 'auth' ||
        /sign in|detect your session/i.test(result.error ?? '') ||
        (!result.success && !result.error && !state.appState.twitchSessionDetected);
      if (--lease.users === 0) await cleanup();
    },
    retain(activate: boolean) {
      for (const [tabId, lease] of leases) {
        lease.keep = true;
        if (activate)
          void (options.tabsApi ?? browser.tabs).update(tabId, { active: true }).catch(() => undefined);
      }
    },
  };
}

export async function closeAutomaticDropsPageTab(
  options: DropsPageRefreshOptions,
  tabId: number,
  canClose: () => boolean = () => true,
): Promise<void> {
  const tabs = options.tabsApi ?? browser.tabs;
  if (!tabs.get || !tabs.remove) return;
  try {
    const tab = await tabs.get(tabId);
    if (tab.url !== TWITCH_DROPS_PAGE_URL || tab.pendingUrl || tab.active || typeof tab.windowId !== 'number')
      return;
    if (!(await tabs.query({ windowId: tab.windowId })).some((other) => other.id !== tabId)) return;
    const current = await tabs.get(tabId);
    if (
      canClose() &&
      current.windowId === tab.windowId &&
      current.url === TWITCH_DROPS_PAGE_URL &&
      !current.pendingUrl &&
      !current.active
    )
      await tabs.remove(tabId);
  } catch {
    // Cleanup cannot turn a completed campaign refresh into a failure.
  }
}

export async function findOrOpenDropsPageTab(
  options: DropsPageRefreshOptions,
  active: boolean,
  openIfMissing: boolean,
  waitForExistingTabMs: number,
  isCurrent: () => boolean = () => true,
): Promise<{ tabId: number | null; opened: boolean }> {
  const tabsApi = options.tabsApi ?? browser.tabs;
  const deadline = Date.now() + Math.max(0, waitForExistingTabMs);
  let existing: TwitchTab | undefined;
  do {
    const tabs = await tabsApi
      .query({
        url: TWITCH_DROPS_TAB_PATTERNS,
      })
      .catch(() => []);
    if (!isCurrent()) return { tabId: null, opened: false };
    existing = tabs.find((tab) => typeof tab.id === 'number');
    if (existing || Date.now() >= deadline) break;
    await waitForDropsDelay(Math.min(250, deadline - Date.now()));
  } while (!existing);
  if (existing?.id) {
    if (existing.discarded)
      await tabsApi.update(existing.id, { url: TWITCH_DROPS_PAGE_URL }).catch(() => undefined);
    if (!isCurrent()) return { tabId: null, opened: false };
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
