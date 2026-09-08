export type TwitchApiFailureKind = 'auth' | 'integrity' | 'network' | 'rate-limit' | 'invalid-response';

export interface TwitchApiFailure {
  readonly kind: TwitchApiFailureKind;
  readonly message: string;
  readonly retryAfterMs?: number;
}

export type TwitchEndpoint = 'gql' | 'integrity';

export class TwitchHttpError extends Error {
  readonly name = 'TwitchHttpError';

  constructor(
    readonly endpoint: TwitchEndpoint,
    readonly status: number,
    readonly retryAfterMs?: number,
  ) {
    super(`Twitch ${endpoint} HTTP ${status}`);
  }
}

export class TwitchInvalidResponseError extends Error {
  readonly name = 'TwitchInvalidResponseError';
}

export class TwitchDirectoryUnavailableError extends Error {
  readonly name = 'TwitchDirectoryUnavailableError';

  constructor(readonly cause: unknown) {
    super(`Twitch streamer search unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

function retryAfterMs(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const retryAt = Date.parse(value);
  return Number.isFinite(retryAt) && retryAt > now ? retryAt - now : undefined;
}

export function createTwitchHttpError(endpoint: TwitchEndpoint, response: Response): TwitchHttpError {
  return new TwitchHttpError(
    endpoint,
    response.status,
    retryAfterMs(response.headers?.get('Retry-After') ?? null),
  );
}

export function classifyTwitchApiFailure(error: unknown): TwitchApiFailure {
  if (error instanceof TwitchHttpError) {
    if (error.status === 429) {
      return {
        kind: 'rate-limit',
        message: error.message,
        ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
      };
    }
    if (error.endpoint === 'integrity') return { kind: 'integrity', message: error.message };
    if (error.status === 401) return { kind: 'auth', message: error.message };
    return { kind: 'network', message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/\bintegrity\b/i.test(message)) return { kind: 'integrity', message };
  if (/\b401\b|unauthorized|invalid oauth token/i.test(message)) return { kind: 'auth', message };
  if (error instanceof TwitchInvalidResponseError) {
    return { kind: 'invalid-response', message };
  }
  return { kind: 'network', message };
}

export function isTwitchAuthFailure(error: unknown): boolean {
  return classifyTwitchApiFailure(error).kind === 'auth';
}
