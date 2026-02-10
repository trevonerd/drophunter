import { DEFAULT_TWITCH_CLIENT_ID, TwitchGraphQLResponse, TwitchSession } from './types';

const GQL_ENDPOINT = 'https://gql.twitch.tv/gql';
const INTEGRITY_ENDPOINT = 'https://gql.twitch.tv/integrity';
const INTEGRITY_CLIENT_ID = 'ue6666qo983tsx6so1t0vnawi233wa';
const INTEGRITY_CLIENT_VERSION = 'da69d5f2-ac48-4169-9574-48fee4a96513';

function createErrorFromResponse(payload: unknown): Error {
  if (Array.isArray(payload)) {
    return new Error('Unexpected batched response from Twitch GQL.');
  }
  if (!payload || typeof payload !== 'object') {
    return new Error('Invalid Twitch GQL response.');
  }

  const response = payload as TwitchGraphQLResponse<unknown>;
  if (Array.isArray(response.errors) && response.errors.length > 0) {
    const firstMessage = response.errors.map((entry) => entry.message).find((message) => typeof message === 'string' && message.trim().length > 0);
    if (firstMessage) {
      return new Error(firstMessage);
    }
  }

  return new Error('Twitch GQL request failed.');
}

export class TwitchGqlTransport {
  private readonly session: TwitchSession;

  constructor(session: TwitchSession) {
    this.session = session;
  }

  private buildBaseHeaders(): Record<string, string> {
    return {
      'Content-Type': 'text/plain;charset=UTF-8',
      'Client-Id': this.session.clientId || DEFAULT_TWITCH_CLIENT_ID,
    };
  }

  private buildAuthorizedHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      ...this.buildBaseHeaders(),
      Authorization: `OAuth ${this.session.oauthToken}`,
      'X-Device-Id': this.session.deviceId,
      'Client-Session-Id': this.session.uuid,
    };

    if (this.session.clientIntegrity) {
      headers['Client-Integrity'] = this.session.clientIntegrity;
    }

    return headers;
  }

  async post<T>(payload: unknown): Promise<T> {
    const response = await fetch(GQL_ENDPOINT, {
      method: 'POST',
      headers: this.buildBaseHeaders(),
      body: JSON.stringify(payload),
    });

    const json = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`Twitch GQL HTTP ${response.status}`);
    }

    if (!json || Array.isArray(json) || typeof json !== 'object') {
      throw createErrorFromResponse(json);
    }

    const typed = json as TwitchGraphQLResponse<T>;
    if (typed.errors?.length) {
      throw createErrorFromResponse(json);
    }

    if (!typed.data) {
      throw new Error('Missing data in Twitch GQL response.');
    }

    return typed.data;
  }

  async postAuthorized<T>(payload: unknown): Promise<T> {
    const response = await fetch(GQL_ENDPOINT, {
      method: 'POST',
      headers: this.buildAuthorizedHeaders(),
      body: JSON.stringify(payload),
    });

    const json = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`Twitch GQL HTTP ${response.status}`);
    }

    if (!json || Array.isArray(json) || typeof json !== 'object') {
      throw createErrorFromResponse(json);
    }

    const typed = json as TwitchGraphQLResponse<T>;
    if (typed.errors?.length) {
      throw createErrorFromResponse(json);
    }

    if (!typed.data) {
      throw new Error('Missing data in Twitch GQL response.');
    }

    return typed.data;
  }

  async postAuthorizedBatch<T>(payloads: unknown[]): Promise<Array<TwitchGraphQLResponse<T>>> {
    const response = await fetch(GQL_ENDPOINT, {
      method: 'POST',
      headers: this.buildAuthorizedHeaders(),
      body: JSON.stringify(payloads),
    });

    const json = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`Twitch GQL HTTP ${response.status}`);
    }

    if (!Array.isArray(json)) {
      throw new Error('Expected batched response from Twitch GQL.');
    }

    return json as Array<TwitchGraphQLResponse<T>>;
  }
}

export async function fetchTwitchIntegrityToken(session: TwitchSession): Promise<string | null> {
  if (!session.oauthToken || !session.deviceId) {
    return null;
  }

  const response = await fetch(INTEGRITY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Client-Id': INTEGRITY_CLIENT_ID,
      Authorization: `OAuth ${session.oauthToken}`,
      'X-Device-Id': session.deviceId,
      'Client-Session-Id': session.uuid,
      'Client-Version': INTEGRITY_CLIENT_VERSION,
    },
  });

  if (!response.ok) {
    throw new Error(`Twitch integrity HTTP ${response.status}`);
  }

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const token = typeof payload.token === 'string' ? payload.token.trim() : '';
  return token || null;
}
