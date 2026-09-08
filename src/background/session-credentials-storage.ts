import { browser } from '../shared/browser-api.ts';
import { TWITCH_SESSION_STORAGE_KEY } from './constants.ts';
import { sanitizeTwitchSession, type TwitchSession } from './twitch-api/types.ts';

export async function persistTwitchSession(session: TwitchSession | null) {
  if (session) {
    await browser.storage.local.set({ [TWITCH_SESSION_STORAGE_KEY]: session });
    return;
  }
  await browser.storage.local.remove(TWITCH_SESSION_STORAGE_KEY).catch(() => undefined);
}

function sessionsMatch(left: TwitchSession, right: TwitchSession): boolean {
  return (
    left.oauthToken === right.oauthToken &&
    left.userId === right.userId &&
    left.deviceId === right.deviceId &&
    left.uuid === right.uuid &&
    left.clientId === right.clientId &&
    left.clientIntegrity === right.clientIntegrity
  );
}

export async function discardPersistedTwitchSessionIfMatches(session: TwitchSession): Promise<void> {
  const stored: Record<string, unknown> = await browser.storage.local
    .get([TWITCH_SESSION_STORAGE_KEY])
    .catch(() => ({}));
  const persisted = sanitizeTwitchSession(stored[TWITCH_SESSION_STORAGE_KEY]);
  if (persisted && sessionsMatch(persisted, session)) await persistTwitchSession(null);
}
