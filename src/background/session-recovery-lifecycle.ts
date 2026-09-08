export interface RecoveryTab {
  readonly id?: number;
  readonly url?: string;
  readonly active?: boolean;
  readonly windowId?: number;
}

export interface RecoveryTabsApi {
  query(queryInfo: { readonly windowId: number }): Promise<readonly RecoveryTab[]>;
  remove(tabId: number): Promise<void>;
  get(tabId: number): Promise<RecoveryTab | null>;
}

export async function withRecoveryTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      onTimeout?.();
      resolve(null);
    }, timeoutMs);
  });
  const result = await Promise.race([promise, timeout]);
  if (timer) clearTimeout(timer);
  return result;
}

export async function closeUntouchedRecoveryTab(
  tab: RecoveryTab,
  tabsApi: RecoveryTabsApi | null,
): Promise<void> {
  if (!tab.id || !tab.windowId || !tabsApi) return;
  const current = await tabsApi.get(tab.id).catch(() => null);
  if (
    current?.id !== tab.id ||
    current.url !== tab.url ||
    current.active ||
    current.windowId !== tab.windowId
  )
    return;
  const windowTabs = await tabsApi.query({ windowId: tab.windowId }).catch(() => []);
  if (windowTabs.length > 1) await tabsApi.remove(tab.id).catch(() => undefined);
}

export async function publishValidatedRecoveredSession(
  state: { twitchSessionCache: TwitchSession | null; twitchSessionLastAttemptAt: number },
  session: TwitchSession,
  expectedRevision: number,
  dependencies: {
    readonly validate: (candidate: TwitchSession) => Promise<boolean>;
    readonly revision: () => number;
    readonly isCurrentAttempt: () => boolean;
    readonly persist: (candidate: TwitchSession) => Promise<unknown> | unknown;
    readonly discardPersistedIfMatches: (candidate: TwitchSession) => Promise<void>;
    readonly onStale: () => void;
  },
): Promise<TwitchSession | null> {
  if (!(await dependencies.validate(session))) return null;
  if (!dependencies.isCurrentAttempt() || dependencies.revision() !== expectedRevision) {
    dependencies.onStale();
    return null;
  }
  await dependencies.persist(session);
  if (!dependencies.isCurrentAttempt() || dependencies.revision() !== expectedRevision) {
    await dependencies.discardPersistedIfMatches(session);
    return null;
  }
  state.twitchSessionCache = session;
  state.twitchSessionLastAttemptAt = 0;
  return session;
}

import type { TwitchSession } from './twitch-api/types.ts';
