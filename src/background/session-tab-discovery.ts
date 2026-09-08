import { withRecoveryTimeout } from './session-recovery-lifecycle.ts';
import type { TwitchSession } from './twitch-api/types.ts';

export interface TwitchRecoveryTab {
  readonly id?: number;
  readonly url?: string;
  readonly active?: boolean;
}

export interface TwitchTabDiscoveryApi {
  query(queryInfo: { url?: string | string[] }): Promise<TwitchRecoveryTab[]>;
}

export async function findSessionInTwitchTabs(
  tabsApi: TwitchTabDiscoveryApi,
  readSession: (tabId: number) => Promise<TwitchSession | null>,
  waitForTabComplete: ((tabId: number) => Promise<unknown> | unknown) | undefined,
  logDebug: (...args: unknown[]) => void,
  timeoutMs?: number,
): Promise<TwitchSession | null> {
  const deadline = timeoutMs === undefined ? null : Date.now() + timeoutMs;
  const tabs = await tabsApi.query({
    url: ['https://www.twitch.tv/*', 'https://twitch.tv/*', 'https://player.twitch.tv/*'],
  });
  const sortedTabs = tabs.slice().sort((left, right) => {
    const leftMain =
      (left.url ?? '').includes('://www.twitch.tv/') || (left.url ?? '').includes('://twitch.tv/');
    const rightMain =
      (right.url ?? '').includes('://www.twitch.tv/') || (right.url ?? '').includes('://twitch.tv/');
    if (leftMain !== rightMain) return leftMain ? -1 : 1;
    return Boolean(left.active) === Boolean(right.active) ? 0 : left.active ? -1 : 1;
  });
  for (const tab of sortedTabs) {
    if (!tab.id || (deadline !== null && Date.now() >= deadline)) continue;
    logDebug('Trying Twitch session extraction from tab', {
      tabId: tab.id,
      url: tab.url ?? null,
      active: Boolean(tab.active),
    });
    const remaining = () => (deadline === null ? undefined : Math.max(0, deadline - Date.now()));
    const beforeWait = remaining();
    if (beforeWait === 0) return null;
    if (waitForTabComplete) {
      await (beforeWait === undefined
        ? waitForTabComplete(tab.id)
        : withRecoveryTimeout(Promise.resolve(waitForTabComplete(tab.id)), beforeWait));
    }
    const beforeRead = remaining();
    if (beforeRead === 0) return null;
    const session = await (beforeRead === undefined
      ? readSession(tab.id).catch(() => null)
      : withRecoveryTimeout(
          readSession(tab.id).catch(() => null),
          beforeRead,
        ));
    if (session) return session;
  }
  return null;
}
