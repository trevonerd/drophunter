import { browser } from '../shared/browser-api.ts';
import type { AppState } from '../types';
import { readAndMaybePersistSessionFromDropsPage } from './session-page-recovery.ts';
import {
  closeUntouchedRecoveryTab,
  publishValidatedRecoveredSession,
  withRecoveryTimeout,
} from './session-recovery-lifecycle.ts';
import { findSessionInTwitchTabs, type TwitchTabDiscoveryApi } from './session-tab-discovery.ts';
import type { TwitchSession } from './twitch-api/types';

const DEFAULT_SESSION_READ_ATTEMPTS = 3;
const DEFAULT_SESSION_READ_RETRY_DELAY_MS = 350;
const DEFAULT_OPEN_TAB_RECOVERY_TIMEOUT_MS = 10_000;
const DEFAULT_AUTH_RECOVERY_TIMEOUT_MS = 90_000;
const DEFAULT_TEMPORARY_RECOVERY_RETRY_MS = 60_000;
const DROPS_RECOVERY_URL = 'https://www.twitch.tv/drops/inventory';

export type SessionRecoveryMode = 'passive' | 'background-tab';

export interface TwitchApiRequestOptions {
  readonly sessionRecoveryMode?: SessionRecoveryMode;
}

interface TwitchTab {
  id?: number;
  url?: string;
  active?: boolean;
  windowId?: number;
}

interface TabsApi extends TwitchTabDiscoveryApi {
  query(queryInfo: { url?: string | string[]; windowId?: number }): Promise<TwitchTab[]>;
  create(createProperties: { url: string; active: boolean }): Promise<TwitchTab | null>;
  remove?(tabId: number): Promise<void>;
  get?(tabId: number): Promise<TwitchTab | null>;
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
}

interface ScriptingApi {
  executeScript(details: { target: { tabId: number }; files: string[] }): Promise<unknown>;
}

interface SessionOrchestratorState {
  appState: Pick<AppState, 'availableGames' | 'lastSuccessfulRefreshAt' | 'twitchSessionSyncState'>;
  twitchSessionCache: TwitchSession | null;
  twitchSessionLastAttemptAt: number;
}

interface SessionOrchestratorOptions {
  tabsApi?: TabsApi;
  scriptingApi?: ScriptingApi;
  sanitizeTwitchSession: (candidate: unknown) => TwitchSession | null;
  sessionDebugSummary: (session: TwitchSession | null) => Record<string, unknown>;
  readTwitchSessionViaExecuteScript: (tabId: number) => Promise<TwitchSession | null>;
  persistTwitchSession: (session: TwitchSession) => Promise<unknown> | unknown;
  discardPersistedTwitchSessionIfMatches: (session: TwitchSession) => Promise<void>;
  validateRecoveredTwitchSession: (session: TwitchSession) => Promise<boolean>;
  getSessionRevision: () => number;
  waitForTabComplete?: (tabId: number) => Promise<unknown> | unknown;
  sessionReadAttempts?: number;
  sessionReadRetryDelayMs?: number;
  openTabRecoveryTimeoutMs?: number;
  authRecoveryTimeoutMs?: number;
  now?: () => number;
  logDebug: (...args: unknown[]) => void;
  logWarn: (...args: unknown[]) => void;
}

interface TwitchSessionResponse {
  success?: boolean;
  session?: unknown;
}

export function createSessionOrchestrator(
  state: SessionOrchestratorState,
  options: SessionOrchestratorOptions,
) {
  const getTabsApi = () => options.tabsApi ?? browser.tabs;
  const getScriptingApi = () => options.scriptingApi ?? browser.scripting;
  let authRecoveryInFlight: Promise<TwitchSession | null> | null = null;
  let activeAuthRecovery = 0;
  let failedTemporaryRecovery: { readonly revision: number; readonly retryAt: number } | null = null;
  const now = options.now ?? Date.now;

  const ensureContentScriptOnTab = async (tabId: number) => {
    try {
      await getScriptingApi().executeScript({
        target: { tabId },
        files: ['/content-scripts/content.js'],
      });
    } catch (error) {
      // Content script may already be injected or the tab may not allow scripting.
      options.logDebug('Content script injection skipped', { tabId, reason: String(error) });
    }
  };

  const readTwitchSessionFromTab = async (tabId: number): Promise<TwitchSession | null> => {
    const send = async () =>
      (await getTabsApi().sendMessage(tabId, { type: 'GET_TWITCH_SESSION' })) as TwitchSessionResponse;
    let response: TwitchSessionResponse | null = null;
    try {
      response = await send();
    } catch (error) {
      options.logWarn('GET_TWITCH_SESSION send failed on first attempt', {
        tabId,
        error: String(error),
      });
      await ensureContentScriptOnTab(tabId);
      response = await send().catch((secondError) => {
        options.logWarn('GET_TWITCH_SESSION send failed after injection', {
          tabId,
          error: String(secondError),
        });
        return null;
      });
    }

    if (!response?.success) {
      options.logWarn('GET_TWITCH_SESSION failed on tab', { tabId });
      return options.readTwitchSessionViaExecuteScript(tabId);
    }

    const session = options.sanitizeTwitchSession(response.session);
    if (!session) {
      options.logWarn('Received invalid Twitch session payload from tab', { tabId });
      return options.readTwitchSessionViaExecuteScript(tabId);
    }
    options.logDebug('Extracted Twitch session from tab', {
      tabId,
      ...options.sessionDebugSummary(session),
    });
    return session;
  };

  const findTwitchSessionInOpenTabs = (timeoutMs?: number) =>
    findSessionInTwitchTabs(
      getTabsApi(),
      readTwitchSessionFromTab,
      options.waitForTabComplete,
      options.logDebug,
      timeoutMs,
    );

  const persistSessionFromDropsPage = (tabId: number, publish = true): Promise<TwitchSession | null> => {
    const attempts = Math.max(1, Math.floor(options.sessionReadAttempts ?? DEFAULT_SESSION_READ_ATTEMPTS));
    const retryDelayMs = Math.max(0, options.sessionReadRetryDelayMs ?? DEFAULT_SESSION_READ_RETRY_DELAY_MS);
    return readAndMaybePersistSessionFromDropsPage(
      tabId,
      {
        ensureContentScriptOnTab,
        readTwitchSessionFromTab,
        attempts,
        retryDelayMs,
        logDebug: options.logDebug,
      },
      state,
      options.persistTwitchSession,
      publish,
    );
  };

  const recoverTwitchSessionAfterAuthError = async (
    mode: SessionRecoveryMode,
  ): Promise<TwitchSession | null> => {
    if (authRecoveryInFlight) {
      return authRecoveryInFlight;
    }
    const attempt = activeAuthRecovery + 1;
    activeAuthRecovery = attempt;
    const isCurrentAttempt = () => activeAuthRecovery === attempt;
    const timeoutMs = options.authRecoveryTimeoutMs ?? DEFAULT_AUTH_RECOVERY_TIMEOUT_MS;
    const recoveryDeadline = Date.now() + timeoutMs;

    authRecoveryInFlight = withRecoveryTimeout(
      (async () => {
        if (mode !== 'background-tab') {
          await getTabsApi().query({
            url: ['https://www.twitch.tv/*', 'https://twitch.tv/*', 'https://player.twitch.tv/*'],
          });
          return null;
        }
        const revision = options.getSessionRevision();
        const openTabTimeout = options.openTabRecoveryTimeoutMs ?? DEFAULT_OPEN_TAB_RECOVERY_TIMEOUT_MS;
        const fromOpenTabs = await findTwitchSessionInOpenTabs(openTabTimeout).catch(() => null);
        if (!isCurrentAttempt()) return null;
        if (fromOpenTabs) {
          return publishValidatedRecoveredSession(state, fromOpenTabs, revision, {
            validate: options.validateRecoveredTwitchSession,
            revision: options.getSessionRevision,
            isCurrentAttempt,
            persist: options.persistTwitchSession,
            discardPersistedIfMatches: options.discardPersistedTwitchSessionIfMatches,
            onStale: () => options.logDebug('Discarded stale recovered Twitch session'),
          });
        }
        if (failedTemporaryRecovery?.revision === revision && now() < failedTemporaryRecovery.retryAt)
          return null;
        if (Date.now() >= recoveryDeadline) return null;
        const temporaryTab = await getTabsApi()
          .create({ url: DROPS_RECOVERY_URL, active: false })
          .catch(() => null);
        if (!temporaryTab?.id) {
          failedTemporaryRecovery = {
            revision,
            retryAt: now() + DEFAULT_TEMPORARY_RECOVERY_RETRY_MS,
          };
          return null;
        }
        if (!isCurrentAttempt()) {
          const tabsApi = getTabsApi();
          await closeUntouchedRecoveryTab(
            temporaryTab,
            tabsApi.get && tabsApi.remove
              ? { get: tabsApi.get, remove: tabsApi.remove, query: tabsApi.query }
              : null,
          );
          return null;
        }
        let session: TwitchSession | null = null;
        try {
          const remainingAfterCreate = Math.max(0, recoveryDeadline - Date.now());
          if (remainingAfterCreate === 0) return null;
          if (options.waitForTabComplete) {
            await withRecoveryTimeout(
              Promise.resolve(options.waitForTabComplete(temporaryTab.id)),
              remainingAfterCreate,
            );
          }
          if (!isCurrentAttempt()) return null;
          const remainingBeforeRead = Math.max(0, recoveryDeadline - Date.now());
          if (remainingBeforeRead === 0) return null;
          session = await withRecoveryTimeout(
            persistSessionFromDropsPage(temporaryTab.id, false),
            remainingBeforeRead,
          );
        } finally {
          const tabsApi = getTabsApi();
          await closeUntouchedRecoveryTab(
            temporaryTab,
            tabsApi.get && tabsApi.remove
              ? { get: tabsApi.get, remove: tabsApi.remove, query: tabsApi.query }
              : null,
          );
        }
        if (!session) {
          failedTemporaryRecovery = {
            revision,
            retryAt: now() + DEFAULT_TEMPORARY_RECOVERY_RETRY_MS,
          };
          return null;
        }
        if (!isCurrentAttempt()) return null;
        const published = await publishValidatedRecoveredSession(state, session, revision, {
          validate: options.validateRecoveredTwitchSession,
          revision: options.getSessionRevision,
          isCurrentAttempt,
          persist: options.persistTwitchSession,
          discardPersistedIfMatches: options.discardPersistedTwitchSessionIfMatches,
          onStale: () => options.logDebug('Discarded stale recovered Twitch session'),
        });
        if (!published && isCurrentAttempt() && options.getSessionRevision() === revision) {
          failedTemporaryRecovery = {
            revision,
            retryAt: now() + DEFAULT_TEMPORARY_RECOVERY_RETRY_MS,
          };
        }
        return published;
      })(),
      timeoutMs,
      () => {
        if (isCurrentAttempt()) activeAuthRecovery += 1;
      },
    )
      .then((session) => session)
      .finally(() => {
        authRecoveryInFlight = null;
      });

    return authRecoveryInFlight;
  };

  const shouldRefreshCampaignsAfterSessionSync = (staleThresholdMs: number, now = Date.now()): boolean =>
    state.appState.availableGames.length === 0 ||
    now - (state.appState.lastSuccessfulRefreshAt ?? 0) > staleThresholdMs;

  return {
    ensureContentScriptOnTab,
    findTwitchSessionInOpenTabs,
    persistSessionFromDropsPage,
    readTwitchSessionFromTab,
    recoverTwitchSessionAfterAuthError,
    shouldRefreshCampaignsAfterSessionSync,
  };
}
