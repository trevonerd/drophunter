import { browser } from '../shared/browser-api.ts';
import { logDebug, logWarn } from './logging.ts';
import { sessionDebugSummary } from './state-persistence.ts';
import { sanitizeTwitchSession, type TwitchSession } from './twitch-api/types.ts';

export function trySanitizeSessionCandidate(candidate: unknown): TwitchSession | null {
  return sanitizeTwitchSession(candidate);
}

export function findSessionCandidateDeep(value: unknown, depth = 0): TwitchSession | null {
  if (depth > 4 || value == null) return null;
  const direct = trySanitizeSessionCandidate(value);
  if (direct) return direct;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return null;
    try {
      return findSessionCandidateDeep(JSON.parse(trimmed), depth + 1);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const session = findSessionCandidateDeep(item, depth + 1);
      if (session) return session;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      const session = findSessionCandidateDeep(nested, depth + 1);
      if (session) return session;
    }
  }
  return null;
}

export async function recoverTwitchSessionFromStorageKeys(): Promise<TwitchSession | null> {
  const [localAll, syncAll] = await Promise.all([
    browser.storage.local.get(null).catch(() => ({})),
    browser.storage.sync.get(null).catch(() => ({})),
  ]);
  const local = localAll as Record<string, unknown>;
  const sync = syncAll as Record<string, unknown>;
  const directCandidate = trySanitizeSessionCandidate({
    oauthToken:
      local.oauthToken ??
      sync.oauthToken ??
      local.authToken ??
      sync.authToken ??
      local.accessToken ??
      sync.accessToken ??
      local.token ??
      sync.token,
    userId: local.userId ?? sync.userId ?? local.userID ?? sync.userID,
    deviceId:
      local.deviceId ??
      sync.deviceId ??
      local.local_copy_unique_id ??
      sync.local_copy_unique_id ??
      local.device_id ??
      sync.device_id,
    uuid:
      local.uuid ??
      sync.uuid ??
      local.clientSessionId ??
      sync.clientSessionId ??
      local['client-session-id'] ??
      sync['client-session-id'],
    clientIntegrity:
      local.clientIntegrity ?? sync.clientIntegrity ?? local['client-integrity'] ?? sync['client-integrity'],
    clientId: local.clientId ?? sync.clientId,
  });
  if (directCandidate) {
    logDebug('Recovered Twitch session from flat storage keys', sessionDebugSummary(directCandidate));
    return directCandidate;
  }
  for (const [key, value] of [...Object.entries(local), ...Object.entries(sync)]) {
    const session = findSessionCandidateDeep(value);
    if (session) {
      logDebug('Recovered Twitch session from storage entry', { key, ...sessionDebugSummary(session) });
      return session;
    }
  }
  logWarn('No Twitch session recovered from storage keys');
  return null;
}
