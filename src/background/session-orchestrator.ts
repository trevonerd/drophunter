import type { AppState } from '../types';
import type { TwitchSession } from './twitch-api/types';

interface TwitchTab {
  id?: number;
  url?: string;
  active?: boolean;
}

interface TabsApi {
  query(queryInfo: { url?: string | string[] }): Promise<TwitchTab[]>;
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
}

interface ScriptingApi {
  executeScript(details: { target: { tabId: number }; files: string[] }): Promise<unknown>;
}

interface SessionOrchestratorState {
  appState: Pick<AppState, 'availableGames' | 'lastSuccessfulRefreshAt'>;
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
  const getTabsApi = () => options.tabsApi ?? chrome.tabs;
  const getScriptingApi = () => options.scriptingApi ?? chrome.scripting;

  const ensureContentScriptOnTab = async (tabId: number) => {
    try {
      await getScriptingApi().executeScript({
        target: { tabId },
        files: ['content.js'],
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
    const session = await readTwitchSessionFromTab(tabId).catch(() => null);
    if (!session) {
      return null;
    }
    state.twitchSessionCache = session;
    state.twitchSessionLastAttemptAt = 0;
    await options.persistTwitchSession(session);
    return session;
  };

  const shouldRefreshCampaignsAfterSessionSync = (staleThresholdMs: number, now = Date.now()): boolean =>
    state.appState.availableGames.length === 0 ||
    now - (state.appState.lastSuccessfulRefreshAt ?? 0) > staleThresholdMs;

  return {
    ensureContentScriptOnTab,
    findTwitchSessionInOpenTabs,
    persistSessionFromDropsPage,
    readTwitchSessionFromTab,
    shouldRefreshCampaignsAfterSessionSync,
  };
}
