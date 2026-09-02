import { browser } from '../shared/browser-api.ts';
import type { AppState } from '../types';
import type { TwitchSession } from './twitch-api/types';

const DEFAULT_SESSION_READ_ATTEMPTS = 3;
const DEFAULT_SESSION_READ_RETRY_DELAY_MS = 350;

export type SessionRecoveryMode = 'passive' | 'background-tab';

export interface TwitchApiRequestOptions {
  readonly sessionRecoveryMode?: SessionRecoveryMode;
}

interface TwitchTab {
  id?: number;
  url?: string;
  active?: boolean;
}

interface TabsApi {
  query(queryInfo: { url?: string | string[] }): Promise<TwitchTab[]>;
  create(createProperties: { url: string; active: boolean }): Promise<TwitchTab | null>;
  remove?(tabId: number): Promise<void>;
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
  waitForTabComplete?: (tabId: number) => Promise<unknown> | unknown;
  closeTemporaryTabIfSafe?: (tabId: number) => Promise<boolean>;
  sessionReadAttempts?: number;
  sessionReadRetryDelayMs?: number;
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
  const wait = (delayMs: number) =>
    delayMs <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, delayMs));

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

  const findTwitchSessionInOpenTabs = async (): Promise<TwitchSession | null> => {
    const tabs = await getTabsApi().query({
      url: ['https://www.twitch.tv/*', 'https://twitch.tv/*', 'https://player.twitch.tv/*'],
    });

    const sortedTabs = tabs.slice().sort((left, right) => {
      const leftUrl = left.url ?? '';
      const rightUrl = right.url ?? '';
      const leftIsMain = leftUrl.includes('://www.twitch.tv/') || leftUrl.includes('://twitch.tv/');
      const rightIsMain = rightUrl.includes('://www.twitch.tv/') || rightUrl.includes('://twitch.tv/');
      if (leftIsMain !== rightIsMain) {
        return leftIsMain ? -1 : 1;
      }
      if (Boolean(left.active) !== Boolean(right.active)) {
        return left.active ? -1 : 1;
      }
      return 0;
    });

    for (const tab of sortedTabs) {
      if (!tab.id) {
        continue;
      }
      options.logDebug('Trying Twitch session extraction from tab', {
        tabId: tab.id,
        url: tab.url ?? null,
        active: Boolean(tab.active),
      });
      const session = await readTwitchSessionFromTab(tab.id).catch(() => null);
      if (session) {
        return session;
      }
    }
    return null;
  };

  const persistSessionFromDropsPage = async (tabId: number): Promise<TwitchSession | null> => {
    await ensureContentScriptOnTab(tabId);
    const attempts = Math.max(1, Math.floor(options.sessionReadAttempts ?? DEFAULT_SESSION_READ_ATTEMPTS));
    const retryDelayMs = Math.max(0, options.sessionReadRetryDelayMs ?? DEFAULT_SESSION_READ_RETRY_DELAY_MS);
    let session: TwitchSession | null = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      session = await readTwitchSessionFromTab(tabId).catch(() => null);
      if (session || attempt === attempts) {
        break;
      }
      options.logDebug('Retrying Twitch session extraction from Drops tab', {
        tabId,
        attempt,
        attempts,
      });
      await wait(retryDelayMs);
    }
    if (!session) {
      return null;
    }
    state.twitchSessionCache = session;
    state.twitchSessionLastAttemptAt = 0;
    await options.persistTwitchSession(session);
    return session;
  };

  const recoverTwitchSessionAfterAuthError = async (
    _mode: SessionRecoveryMode,
  ): Promise<TwitchSession | null> => {
    if (authRecoveryInFlight) {
      return authRecoveryInFlight;
    }

    authRecoveryInFlight = (async () => {
      const fromOpenTabs = await findTwitchSessionInOpenTabs().catch(() => null);
      if (fromOpenTabs) {
        state.twitchSessionCache = fromOpenTabs;
        state.twitchSessionLastAttemptAt = 0;
        await options.persistTwitchSession(fromOpenTabs);
        return fromOpenTabs;
      }

      return null;
    })().finally(() => {
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
