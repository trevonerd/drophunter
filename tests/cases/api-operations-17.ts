import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  buildDirectoryResponse,
  createGame,
  createMinimalState,
  createSession,
  type FetchMock,
  installFetchMock,
  restoreFetch,
} from '../api-operations-fixtures.ts';
import { type ChromeMocks, setupChromeMocks } from '../mocks/chrome.ts';

let chromeMocks: ChromeMocks;

describe('fetchDirectoryStreamersFromApi', () => {
  let originalFetch: FetchMock | undefined;

  beforeEach(() => {
    chromeMocks = setupChromeMocks();
  });

  afterEach(() => {
    restoreFetch(originalFetch);
    chromeMocks.teardown();
  });

  test('returns streamers when API call succeeds', async () => {
    const { fetchDirectoryStreamersFromApi } = await import('../../src/background/api-operations.ts');

    const state = createMinimalState();
    state.apiConsecutiveFailures = 2;
    state.apiBackoffUntil = Date.now() + 60_000;
    const game = createGame({ name: 'Test Game', categorySlug: 'test-game' });
    const session = createSession();
    const mockStreamers = [
      {
        id: 'streamer1',
        name: 'streamer1',
        displayName: 'Streamer One',
        viewersCount: 1000,
        broadcasterLanguage: 'en',
      },
      {
        id: 'streamer2',
        name: 'streamer2',
        displayName: 'Streamer Two',
        viewersCount: 500,
        broadcasterLanguage: 'es',
      },
    ];

    originalFetch = installFetchMock([async () => buildDirectoryResponse(mockStreamers)]);

    const result = await fetchDirectoryStreamersFromApi(state, game, session);

    expect(result).toHaveLength(2);
    expect(state.apiConsecutiveFailures).toBe(0);
    expect(state.apiBackoffUntil).toBe(0);
  });

  test('returns empty array with languageFilterApplied=false when API returns empty', async () => {
    const { fetchDirectoryStreamersFromApi } = await import('../../src/background/api-operations.ts');

    const state = createMinimalState();
    const game = createGame({ name: 'Test Game', categorySlug: 'test-game' });
    const session = createSession();

    originalFetch = installFetchMock([async () => buildDirectoryResponse([])]);

    const result = await fetchDirectoryStreamersFromApi(state, game, session);

    expect(result).toHaveLength(0);
    expect(result.languageFilterApplied).toBe(false);
  });

  test('uses public client when session is null', async () => {
    const { fetchDirectoryStreamersFromApi } = await import('../../src/background/api-operations.ts');

    const state = createMinimalState();
    const game = createGame({ name: 'Test Game', categorySlug: 'test-game' });
    const mockStreamers = [{ id: 'pub1', name: 'pub1', displayName: 'Public', viewersCount: 100 }];

    originalFetch = installFetchMock([async () => buildDirectoryResponse(mockStreamers)]);

    const result = await fetchDirectoryStreamersFromApi(state, game, null);

    expect(result).toHaveLength(1);
  });

  test('does not report a directory request failure as an empty streamer list', async () => {
    const { fetchDirectoryStreamersFromApi } = await import('../../src/background/api-operations.ts');

    const state = createMinimalState();
    const game = createGame({ name: 'Test Game', categorySlug: 'test-game' });
    const session = createSession();

    originalFetch = installFetchMock([
      async () => {
        throw new Error('network failure');
      },
    ]);

    await expect(fetchDirectoryStreamersFromApi(state, game, session)).rejects.toThrow('network failure');
    expect(state.apiBackoffUntil).toBeGreaterThan(Date.now());
  });

  test('honors Twitch Retry-After when the directory is rate limited', async () => {
    const { fetchDirectoryStreamersFromApi } = await import('../../src/background/api-operations.ts');

    const state = createMinimalState();
    const game = createGame({ name: 'Test Game', categorySlug: 'test-game' });
    const session = createSession();
    const beforeRequest = Date.now();

    originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } });

    await expect(fetchDirectoryStreamersFromApi(state, game, session)).rejects.toThrow('HTTP 429');
    expect(state.apiBackoffUntil).toBeGreaterThanOrEqual(beforeRequest + 120_000);
  });

  test('includes broadcasterLanguages in request when language is specified', async () => {
    const { fetchDirectoryStreamersFromApi } = await import('../../src/background/api-operations.ts');

    const state = createMinimalState();
    const game = createGame({ name: 'Test Game', categorySlug: 'test-game' });
    const session = createSession();
    const mockStreamers = [
      {
        id: 'eng1',
        name: 'eng1',
        displayName: 'English Streamer',
        viewersCount: 500,
        broadcasterLanguage: 'en',
      },
    ];

    let capturedBody: Record<string, unknown> | null = null;
    const originalFetchMock = globalThis.fetch;
    let _callCount = 0;
    globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      _callCount++;
      if (init?.body && typeof init.body === 'string') {
        capturedBody = JSON.parse(init.body);
      }
      return {
        ok: true,
        status: 200,
        json: async () => buildDirectoryResponse(mockStreamers),
        text: async () => JSON.stringify(buildDirectoryResponse(mockStreamers)),
      } as Response;
    };

    await fetchDirectoryStreamersFromApi(state, game, session, 'en');

    globalThis.fetch = originalFetchMock;
    expect(capturedBody).not.toBeNull();
    const vars = capturedBody?.variables as Record<string, unknown> | undefined;
    const options = vars?.options as Record<string, unknown> | undefined;
    const langs = options?.broadcasterLanguages as string[] | undefined;
    expect(langs).toContain('EN');
  });

  test('backs off without clearing the cached session after a directory auth error', async () => {
    const { fetchDirectoryStreamersFromApi } = await import('../../src/background/api-operations.ts');

    const session = createSession();
    const state = createMinimalState({ twitchSessionCache: session });
    const game = createGame({ name: 'Test Game', categorySlug: 'test-game' });

    originalFetch = installFetchMock([
      async () => {
        throw new Error('401 unauthorized');
      },
    ]);

    await expect(fetchDirectoryStreamersFromApi(state, game, session)).rejects.toThrow('401 unauthorized');
    expect(state.twitchSessionCache).toBe(session);
    expect(state.apiBackoffUntil).toBeGreaterThan(Date.now());
  });

  test('directory wrapper preserves an unavailable response instead of reporting zero streamers', async () => {
    const { fetchDirectoryStreamersFromApiWrapper } = await import(
      '../../src/background/api-secondary-wrappers.ts'
    );
    const session = createSession();
    const state = createMinimalState({ twitchSessionCache: session });
    const game = createGame({ name: 'Test Game', categorySlug: 'test-game' });

    originalFetch = installFetchMock([
      async () => {
        throw new Error('directory unavailable');
      },
    ]);

    await expect(
      fetchDirectoryStreamersFromApiWrapper(
        state,
        game,
        false,
        '',
        {
          onEnsureTwitchSession: async () => session,
          onIsLikelyAuthError: () => false,
          onClearTwitchSessionCache: async () => undefined,
        },
        { logWarn: () => undefined },
      ),
    ).rejects.toThrow('directory unavailable');
  });
});
