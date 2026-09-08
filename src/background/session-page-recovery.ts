import type { TwitchSession } from './twitch-api/types.ts';

export interface DropsPageSessionReader {
  readonly ensureContentScriptOnTab: (tabId: number) => Promise<void>;
  readonly readTwitchSessionFromTab: (tabId: number) => Promise<TwitchSession | null>;
  readonly attempts: number;
  readonly retryDelayMs: number;
  readonly logDebug: (...args: unknown[]) => void;
}

export async function readSessionFromDropsPage(
  tabId: number,
  reader: DropsPageSessionReader,
): Promise<TwitchSession | null> {
  await reader.ensureContentScriptOnTab(tabId);
  for (let attempt = 1; attempt <= reader.attempts; attempt += 1) {
    const session = await reader.readTwitchSessionFromTab(tabId).catch(() => null);
    if (session || attempt === reader.attempts) return session;
    reader.logDebug('Retrying Twitch session extraction from Drops tab', {
      tabId,
      attempt,
      attempts: reader.attempts,
    });
    if (reader.retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, reader.retryDelayMs));
  }
  return null;
}

export async function readAndMaybePersistSessionFromDropsPage(
  tabId: number,
  reader: DropsPageSessionReader,
  state: { twitchSessionCache: TwitchSession | null; twitchSessionLastAttemptAt: number },
  persist: (session: TwitchSession) => Promise<unknown> | unknown,
  publish: boolean,
): Promise<TwitchSession | null> {
  const session = await readSessionFromDropsPage(tabId, reader);
  if (!session || !publish) return session;
  await persist(session);
  state.twitchSessionCache = session;
  state.twitchSessionLastAttemptAt = 0;
  return session;
}
