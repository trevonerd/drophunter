export interface TwitchSession {
  oauthToken: string;
  userId: string;
  deviceId: string;
  uuid: string;
  clientId?: string;
  clientIntegrity?: string;
}

export interface TwitchGraphQLError {
  message?: string;
}

export interface TwitchGraphQLResponse<T> {
  data?: T;
  errors?: TwitchGraphQLError[];
}

export const DEFAULT_TWITCH_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

function stripWrappingQuotes(value: string): string {
  let current = value.trim();
  let changed = true;
  while (changed && current.length >= 2) {
    changed = false;
    const starts = current[0];
    const ends = current[current.length - 1];
    if ((starts === '"' && ends === '"') || (starts === "'" && ends === "'") || (starts === '`' && ends === '`')) {
      current = current.slice(1, -1).trim();
      changed = true;
    }
  }
  return current;
}

function cleanCredential(value: string): string {
  if (!value) {
    return '';
  }
  let current = value.trim();
  try {
    const parsed = JSON.parse(current) as unknown;
    if (typeof parsed === 'string') {
      current = parsed;
    }
  } catch {
    // Not a JSON encoded string, keep raw value.
  }
  current = stripWrappingQuotes(current);
  current = current
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\`/g, '`');
  current = stripWrappingQuotes(current);
  current = current.trim();
  return current;
}

function normalizeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'string') {
    return cleanCredential(value);
  }
  return '';
}

function normalizeOAuthToken(value: unknown): string {
  const raw = normalizeValue(value);
  if (!raw) {
    return '';
  }
  const stripped = raw.replace(/^oauth:/i, '').replace(/^oauth\s+/i, '').trim();
  return stripped.replace(/["'\\]/g, '').trim();
}

export function sanitizeTwitchSession(input: unknown): TwitchSession | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const source = input as Record<string, unknown>;
  const oauthToken = normalizeOAuthToken(source.oauthToken);
  const userId = normalizeValue(source.userId) || normalizeValue(source.userID) || normalizeValue(source.id);
  const deviceId = normalizeValue(source.deviceId);
  const uuid = normalizeValue(source.uuid) || crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const clientId = normalizeValue(source.clientId) || DEFAULT_TWITCH_CLIENT_ID;
  const clientIntegrity = normalizeValue(source.clientIntegrity);

  if (!oauthToken || !deviceId) {
    return null;
  }

  return {
    oauthToken,
    userId: userId || '',
    deviceId,
    uuid,
    clientId,
    clientIntegrity: clientIntegrity || undefined,
  };
}

export function isLikelyAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('401') ||
    message.includes('403') ||
    message.includes('unauthorized') ||
    message.includes('forbidden') ||
    message.includes('invalid oauth token') ||
    message.includes('failed integrity check')
  );
}
