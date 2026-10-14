import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createMinimalState, createSession } from '../api-operations-fixtures.ts';
import { type ChromeMocks, setupChromeMocks } from '../mocks/chrome.ts';

let chromeMocks: ChromeMocks;
const originalFetch = globalThis.fetch;

// Twitch gates authorized web-client playback tokens behind Client-Integrity.
function twitch(options: { accepts: (integrity: string | null) => boolean; minted?: string | null }) {
  const tokenRequests: (string | null)[] = [];
  let mints = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (String(input).endsWith('/integrity')) {
      mints += 1;
      return Response.json(options.minted ? { token: options.minted } : {});
    }
    const integrity = headers.get('Client-Integrity');
    tokenRequests.push(integrity);
    return Response.json(
      options.accepts(integrity)
        ? { data: { streamPlaybackAccessToken: { value: 'value', signature: 'signature' } } }
        : { data: null, errors: [{ message: 'failed integrity check' }] },
    );
  }) as typeof fetch;
  return { tokenRequests, mints: () => mints };
}

describe('fetchPlaybackTokenFromApi', () => {
  beforeEach(() => {
    chromeMocks = setupChromeMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    chromeMocks.teardown();
  });

  test('refreshes a rejected integrity token and retries once', async () => {
    const { fetchPlaybackTokenFromApi } = await import('../../src/background/api-operations.ts');
    const session = createSession({ clientIntegrity: 'stale' });
    const state = createMinimalState({ twitchSessionCache: session });
    const api = twitch({ accepts: (integrity) => integrity === 'fresh', minted: 'fresh' });

    expect(await fetchPlaybackTokenFromApi(state, session, 'streamer')).toEqual({
      value: 'value',
      signature: 'signature',
    });
    expect(api.tokenRequests).toEqual(['stale', 'fresh']);
    expect(state.integrityFallbackActive).toBe(false);
  });

  test('falls back to no integrity when a fresh token cannot be minted', async () => {
    const { fetchPlaybackTokenFromApi } = await import('../../src/background/api-operations.ts');
    const session = createSession({ clientIntegrity: 'stale' });
    const state = createMinimalState({ twitchSessionCache: session });
    const api = twitch({ accepts: (integrity) => integrity === null, minted: null });

    expect(await fetchPlaybackTokenFromApi(state, session, 'streamer')).not.toBeNull();
    expect(api.tokenRequests).toEqual(['stale', null]);
    expect(state.integrityFallbackActive).toBe(true);
    expect(state.integrityFallbackActiveUntil).toBeGreaterThan(Date.now());
  });

  test('honors an active no-integrity fallback', async () => {
    const { fetchPlaybackTokenFromApi } = await import('../../src/background/api-operations.ts');
    const session = createSession({ clientIntegrity: 'stale' });
    const state = createMinimalState({
      twitchSessionCache: session,
      integrityFallbackActive: true,
      integrityFallbackActiveUntil: Date.now() + 60_000,
    });
    const api = twitch({ accepts: (integrity) => integrity === null });

    expect(await fetchPlaybackTokenFromApi(state, session, 'streamer')).not.toBeNull();
    expect(api.tokenRequests).toEqual([null]);
    expect(api.mints()).toBe(0);
  });

  test('fails without refreshing when every integrity variant is rejected', async () => {
    const { fetchPlaybackTokenFromApi } = await import('../../src/background/api-operations.ts');
    const session = createSession({ clientIntegrity: 'stale' });
    const state = createMinimalState({ twitchSessionCache: session });
    const api = twitch({ accepts: () => false, minted: null });

    await expect(fetchPlaybackTokenFromApi(state, session, 'streamer')).rejects.toThrow('integrity');
    expect(api.tokenRequests).toEqual(['stale', null]);
    expect(state.integrityFallbackActive).toBe(false);
  });

  test('rethrows other failures without minting integrity', async () => {
    const { fetchPlaybackTokenFromApi } = await import('../../src/background/api-operations.ts');
    const session = createSession({ clientIntegrity: 'current' });
    const state = createMinimalState({ twitchSessionCache: session });
    let mints = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/integrity')) mints += 1;
      return Response.json({ data: null, errors: [{ message: 'service unavailable' }] });
    }) as typeof fetch;

    await expect(fetchPlaybackTokenFromApi(state, session, 'streamer')).rejects.toThrow(
      'service unavailable',
    );
    expect(mints).toBe(0);
  });
});
