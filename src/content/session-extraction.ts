// Pure session/token extraction logic, factored out of content-script.ts so it can be
// unit tested without a real DOM (content-script.ts itself reads live document/window
// state that bun test doesn't provide).

export interface StorageLike {
  getItem(key: string): string | null;
}

const TWILIGHT_USER_KEYS = [
  'twilight-user',
  'twilight-user-data',
  'twilight-user-data-v2',
  '__twilight-user',
  'twilight-session',
];

function normalizeText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseTwilightUserEntry(stores: StorageLike[]): { oauthToken: string; userId: string } {
  for (const store of stores) {
    for (const key of TWILIGHT_USER_KEYS) {
      const raw = store.getItem(key);
      if (!raw) {
        continue;
      }
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const asText = (value: unknown): string => (typeof value === 'string' ? normalizeText(value) : '');
        const parsedUser =
          parsed.user && typeof parsed.user === 'object' ? (parsed.user as Record<string, unknown>) : null;
        const oauthToken =
          asText(parsed.authToken) ||
          asText(parsed.token) ||
          asText(parsed.accessToken) ||
          asText(parsed.oauthToken);
        const userId =
          asText(parsed.userID) || asText(parsed.userId) || asText(parsed.id) || asText(parsedUser?.id);
        if (oauthToken || userId) {
          return { oauthToken, userId };
        }
      } catch {
        // Ignore malformed entries.
      }
    }
  }
  return { oauthToken: '', userId: '' };
}

export function parseCookieValue(cookieString: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = cookieString.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

export interface ExtractTwitchSessionInput {
  cookieString: string;
  localStorage: StorageLike;
  sessionStorage: StorageLike;
  createSessionUuid: () => string;
}

export interface ExtractedTwitchSession {
  oauthToken: string;
  userId: string;
  deviceId: string;
  uuid: string;
  clientIntegrity: string | undefined;
}

export function extractTwitchSessionFrom(input: ExtractTwitchSessionInput): ExtractedTwitchSession | null {
  const twilight = parseTwilightUserEntry([input.localStorage, input.sessionStorage]);
  const oauthToken =
    twilight.oauthToken ||
    normalizeText(parseCookieValue(input.cookieString, 'auth-token')) ||
    normalizeText(parseCookieValue(input.cookieString, '__Secure-auth-token'));
  const userId = twilight.userId;
  const deviceId =
    normalizeText(input.localStorage.getItem('local_copy_unique_id')) ||
    normalizeText(input.localStorage.getItem('device_id')) ||
    normalizeText(input.localStorage.getItem('deviceId')) ||
    normalizeText(input.sessionStorage.getItem('local_copy_unique_id')) ||
    normalizeText(input.sessionStorage.getItem('device_id')) ||
    normalizeText(input.sessionStorage.getItem('deviceId')) ||
    normalizeText(parseCookieValue(input.cookieString, 'unique_id')) ||
    normalizeText(parseCookieValue(input.cookieString, '__Secure-unique_id')) ||
    normalizeText(parseCookieValue(input.cookieString, 'device_id'));
  const uuid =
    normalizeText(input.localStorage.getItem('client-session-id')) ||
    normalizeText(input.localStorage.getItem('clientSessionId')) ||
    normalizeText(input.sessionStorage.getItem('client-session-id')) ||
    normalizeText(input.sessionStorage.getItem('clientSessionId')) ||
    input.createSessionUuid();
  const clientIntegrity =
    normalizeText(input.localStorage.getItem('client-integrity')) ||
    normalizeText(input.localStorage.getItem('clientIntegrity'));

  if (!oauthToken || !deviceId) {
    return null;
  }

  return {
    oauthToken,
    userId: userId || '',
    deviceId,
    uuid,
    clientIntegrity: clientIntegrity || undefined,
  };
}
