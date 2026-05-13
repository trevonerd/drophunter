import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { setupChromeMocks, type ChromeMocks } from './mocks/chrome.ts';
import { createInitialState } from '../src/shared/utils.ts';
import type { ServiceWorkerState } from '../src/background/service-worker.ts';
import type { TwitchSession } from '../src/background/twitch-api/types.ts';
import type { TwitchDrop, TwitchGame } from '../src/types/index.ts';

let chromeMocks: ChromeMocks;

function createMinimalState(overrides: Partial<ServiceWorkerState> = {}): ServiceWorkerState {
  return {
    appState: createInitialState(),
    monitorTickInFlight: false,
    invalidStreamChecks: 0,
    lastStreamRotationAt: 0,
    streamValidationGraceUntil: 0,
    lastTrackedProgress: 0,
    lastTrackedMinutes: 0,
    lastTrackedDropKey: null,
    lastProgressAdvanceAt: 0,
    noProgressRotationAttempts: 0,
    playbackAttentionWarningSent: false,
    gamesCacheRefreshInFlight: null,
    twitchSessionCache: null,
    twitchSessionFetchInFlight: null,
    twitchSessionLastAttemptAt: 0,
    cachedDropsSnapshot: [],
    previousAllDropsCount: 0,
    cachedCampaignChannelsMap: {},
    lastFullRefreshAt: 0,
    dropClaimInFlight: false,
    dropClaimRetryAtById: new Map(),
    lastActivityAt: 0,
    apiConsecutiveFailures: 0,
    apiBackoffUntil: 0,
    integrityFallbackActive: false,
    integrityFallbackActiveUntil: 0,
    recoveryBackoffUntil: 0,
    lastRecoveryAttemptAt: 0,
    stalledRecoveryAttempts: 0,
    recoveryNotificationSent: false,
    lastGamesCacheRefreshAt: 0,
    ...overrides,
  };
}

function createSession(overrides: Partial<TwitchSession> = {}): TwitchSession {
  return {
    oauthToken: 'test-token-at-least-20-chars-long',
    userId: '123456789',
    deviceId: 'device-id-test-abc-12345678',
    uuid: 'test-uuid-abc',
    clientId: 'kimne78kx3ncx6brgo4mv6wki5h1ko',
    clientIntegrity: 'test-integrity-token',
    ...overrides,
  };
}

function createGame(overrides: Partial<TwitchGame> = {}): TwitchGame {
  return {
    id: 'game-123',
    name: 'Test Game',
    displayName: 'Test Game',
    imageUrl: 'https://example.com/game.png',
    categorySlug: 'test-game',
    dropCount: 2,
    ...overrides,
  };
}

type FetchMock = typeof globalThis.fetch;

function installFetchMock(responses: Array<() => Promise<unknown>>): FetchMock {
  let callIndex = 0;
  const original = globalThis.fetch;
  const mock: FetchMock = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const factory = responses[callIndex++];
    if (!factory) throw new Error('Unexpected fetch call - no more mocks');
    const result = await factory();
    if (result instanceof Error) throw result;

    const bodyStr = init?.body as string | undefined;
    const isBatchRequest = bodyStr ? bodyStr.trim().startsWith('[') : false;

    let finalResult = result;
    if (isBatchRequest && !Array.isArray(result)) {
      finalResult = [result];
    } else if (!isBatchRequest && Array.isArray(result)) {
      finalResult = (result as unknown[])[0];
    }

    return {
      ok: true,
      status: 200,
      json: async () => finalResult,
      text: async () => JSON.stringify(finalResult),
    } as Response;
  };
  globalThis.fetch = mock;
  return original;
}

function restoreFetch(original: FetchMock | undefined) {
  if (original) {
    globalThis.fetch = original;
  }
}

function buildDropsDashboardResponse(games: TwitchGame[]): unknown {
  return {
    data: {
      currentUser: {
        dropCampaigns: games.map((game) => ({
          id: game.campaignId ?? 'campaign-1',
          status: 'ACTIVE',
          endAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          game: {
            displayName: game.name,
            name: game.name,
            slug: game.categorySlug,
            boxArtURL: game.imageUrl,
          },
          timeBasedDrops: [
            {
              id: 'drop-1',
              name: 'Test Drop 1',
              requiredMinutesWatched: 60,
              self: {
                currentMinutesWatched: 30,
                isClaimed: false,
                isClaimable: false,
              },
            },
          ],
          eventBasedDrops: [],
        })),
      },
    },
  };
}

function buildInventoryResponse(
  campaigns: Array<{
    campaignId: string;
    gameName?: string;
    drops: Array<{
      dropId: string;
      currentMinutes: number;
      requiredMinutes: number;
      isClaimed?: boolean;
      isClaimable?: boolean;
      dropInstanceID?: string;
    }>;
  }> = [],
): unknown {
  return {
    data: {
      currentUser: {
        inventory: {
          dropCampaignsInProgress: campaigns.map((campaign) => ({
            id: campaign.campaignId,
            game: campaign.gameName ? { displayName: campaign.gameName } : undefined,
            timeBasedDrops: campaign.drops.map((drop) => ({
              id: drop.dropId,
              requiredMinutesWatched: drop.requiredMinutes,
              self: {
                currentMinutesWatched: drop.currentMinutes,
                isClaimed: drop.isClaimed ?? false,
                isClaimable: drop.isClaimable ?? false,
                dropInstanceID: drop.dropInstanceID,
              },
            })),
          })),
          gameEventDrops: [],
        },
      },
    },
  };
}

function buildCampaignDetailsResponse(): unknown {
  return [
    {
      data: {
        user: {
          dropCampaign: {
            id: 'campaign-1',
            game: { slug: 'test-game' },
            timeBasedDrops: [
              {
                id: 'drop-1',
                name: 'Test Drop 1',
                requiredMinutesWatched: 60,
                self: {
                  currentMinutesWatched: 30,
                  isClaimed: false,
                  isClaimable: false,
                },
              },
            ],
            eventBasedDrops: [],
          },
        },
      },
    },
  ];
}

function buildDirectoryResponse(streamers: Array<{ id: string; name: string; displayName: string; viewersCount?: number; broadcasterLanguage?: string }>, language?: string): unknown {
  return {
    data: {
      game: {
        streams: {
          edges: streamers.map((s) => ({
            node: {
              broadcaster: {
                login: s.name,
                displayName: s.displayName,
              },
              viewersCount: s.viewersCount ?? 100,
              broadcasterLanguage: s.broadcasterLanguage,
            },
          })),
        },
      },
    },
  };
}

function buildIntegrityResponse(): unknown {
  return { token: 'mock-integrity-token' };
}

describe('fetchDropsSnapshotFromApi', () => {
  let originalFetch: FetchMock | undefined;

  beforeEach(() => {
    chromeMocks = setupChromeMocks();
  });

  afterEach(() => {
    restoreFetch(originalFetch);
    chromeMocks.teardown();
  });

  test('returns snapshot when API call succeeds', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../src/background/api-operations.ts');

    const state = createMinimalState();
    const session = createSession();
    const game = createGame({ name: 'Test Game', campaignId: 'campaign-123', categorySlug: 'test-game' });

    originalFetch = installFetchMock([
      async () => buildDropsDashboardResponse([game]),
      async () => buildInventoryResponse(),
      async () => buildCampaignDetailsResponse(),
      async () => buildDropsDashboardResponse([game]),
      async () => buildInventoryResponse(),
      async () => buildCampaignDetailsResponse(),
    ]);

    const result = await fetchDropsSnapshotFromApi(state, session);

    expect(result).not.toBeNull();
    expect(result?.games).toHaveLength(1);
    expect(state.apiConsecutiveFailures).toBe(0);
  });

  test('returns null when snapshot has no games or drops', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../src/background/api-operations.ts');

    const state = createMinimalState();
    const session = createSession();

    originalFetch = installFetchMock([
      async () => buildIntegrityResponse(),
      async () => ({ data: { currentUser: { dropCampaigns: [] } } }),
      async () => buildInventoryResponse(),
    ]);

    const result = await fetchDropsSnapshotFromApi(state, session);

    expect(result).toBeNull();
  });

  test('increments apiConsecutiveFailures and sets apiBackoffUntil on network error', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../src/background/api-operations.ts');

    const state = createMinimalState({ apiConsecutiveFailures: 0 });
    const session = createSession();

    originalFetch = installFetchMock([
      async () => { throw new Error('network error'); },
    ]);

    const before = Date.now();
    const result = await fetchDropsSnapshotFromApi(state, session);
    const after = Date.now();

    expect(result).toBeNull();
    expect(state.apiConsecutiveFailures).toBe(1);
    expect(state.apiBackoffUntil).toBeGreaterThanOrEqual(before);
    expect(state.apiBackoffUntil).toBeLessThanOrEqual(after + 60 * 1000);
  });

  test('backoff is capped at 10 minutes with high failure count', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../src/background/api-operations.ts');

    const state = createMinimalState({ apiConsecutiveFailures: 5 });
    const session = createSession();

    originalFetch = installFetchMock([
      async () => { throw new Error('network error'); },
    ]);

    await fetchDropsSnapshotFromApi(state, session);

    expect(state.apiBackoffUntil).toBeLessThanOrEqual(Date.now() + 10 * 60 * 1000 + 1000);
  });

  test('uses existing integrity token when integrityFallbackActive and not expired', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../src/background/api-operations.ts');

    const state = createMinimalState({
      integrityFallbackActive: true,
      integrityFallbackActiveUntil: Date.now() + 60_000,
    });
    const session = createSession({ clientIntegrity: 'some-token' });
    const game = createGame({ name: 'Test Game', campaignId: 'campaign-123', categorySlug: 'test-game' });

    originalFetch = installFetchMock([
      async () => buildDropsDashboardResponse([game]),
      async () => buildInventoryResponse(),
      async () => buildCampaignDetailsResponse(),
    ]);

    const result = await fetchDropsSnapshotFromApi(state, session);

    expect(result).not.toBeNull();
    expect(state.apiConsecutiveFailures).toBe(0);
  });

  test('calls ensureSessionIntegrity when integrityFallbackActive is expired', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../src/background/api-operations.ts');

    const state = createMinimalState({
      integrityFallbackActive: true,
      integrityFallbackActiveUntil: Date.now() - 1000,
    });
    const session = createSession({ clientIntegrity: 'some-token' });
    const game = createGame({ name: 'Test Game', campaignId: 'campaign-123', categorySlug: 'test-game' });

    originalFetch = installFetchMock([
      async () => buildDropsDashboardResponse([game]),
      async () => buildInventoryResponse(),
      async () => buildCampaignDetailsResponse(),
    ]);

    const result = await fetchDropsSnapshotFromApi(state, session);

    expect(result).not.toBeNull();
    expect(state.apiConsecutiveFailures).toBe(0);
  });

  test('handles integrity error by refreshing token and retrying', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../src/background/api-operations.ts');

    const state = createMinimalState();
    const session = createSession({ clientIntegrity: 'original-token' });
    const game = createGame({ name: 'Test Game', campaignId: 'campaign-123', categorySlug: 'test-game' });

    let fetchCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (): Promise<Response> => {
      fetchCount++;
      if (fetchCount <= 2) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: null, errors: [{ message: 'integrity check failed' }] }),
          text: async () => JSON.stringify({ data: null, errors: [{ message: 'integrity check failed' }] }),
        } as Response;
      }
      if (fetchCount === 3) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ token: 'refreshed-integrity-token' }),
          text: async () => JSON.stringify({ token: 'refreshed-integrity-token' }),
        } as Response;
      }
      const responses = [buildDropsDashboardResponse([game]), buildInventoryResponse(), buildCampaignDetailsResponse()];
      const response = responses[fetchCount - 4] ?? buildDropsDashboardResponse([game]);
      return {
        ok: true,
        status: 200,
        json: async () => response,
        text: async () => JSON.stringify(response),
      } as Response;
    };

    const result = await fetchDropsSnapshotFromApi(state, session);

    globalThis.fetch = originalFetch;

    expect(result).not.toBeNull();
    expect(state.apiConsecutiveFailures).toBe(0);
  });

  test('handles integrity errors by attempting retry logic', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../src/background/api-operations.ts');

    const state = createMinimalState();
    const session = createSession({ clientIntegrity: 'original-token' });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (): Promise<Response> => {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: null, errors: [{ message: 'integrity error' }] }),
        text: async () => JSON.stringify({ data: null, errors: [{ message: 'integrity error' }] }),
      } as Response;
    };

    const result = await fetchDropsSnapshotFromApi(state, session);

    globalThis.fetch = originalFetch;

    expect(result).toBeNull();
    expect(state.apiConsecutiveFailures).toBeGreaterThan(0);
  });
});

describe('fetchInventorySnapshotFromApi', () => {
  let originalFetch: FetchMock | undefined;

  beforeEach(() => {
    chromeMocks = setupChromeMocks();
  });

  afterEach(() => {
    restoreFetch(originalFetch);
    chromeMocks.teardown();
  });

  test('updates cached drop progress with inventory only', async () => {
    const { fetchInventorySnapshotFromApi } = await import('../src/background/api-operations.ts');

    const state = createMinimalState();
    const session = createSession();
    const cachedDrops: TwitchDrop[] = [
      {
        id: 'drop-1',
        name: 'For Honor Drop',
        gameId: 'campaign-for-honor',
        gameName: 'For Honor',
        imageUrl: 'https://example.com/drop.png',
        progress: 50,
        currentMinutes: 120,
        claimed: false,
        campaignId: 'campaign-for-honor',
        requiredMinutes: 240,
        remainingMinutes: 120,
      },
    ];

    originalFetch = installFetchMock([
      async () =>
        buildInventoryResponse([
          {
            campaignId: 'campaign-for-honor',
            gameName: 'For Honor',
            drops: [
              {
                dropId: 'drop-1',
                currentMinutes: 180,
                requiredMinutes: 240,
              },
            ],
          },
        ]),
    ]);

    const result = await fetchInventorySnapshotFromApi(state, session, cachedDrops);

    expect(result).not.toBeNull();
    expect(result?.games).toEqual([]);
    expect(result?.drops).toHaveLength(1);
    expect(result?.drops[0].currentMinutes).toBe(180);
    expect(result?.drops[0].progress).toBe(75);
    expect(result?.drops[0].remainingMinutes).toBe(60);
    expect(result?.drops[0].progressSource).toBe('inventory');
    expect(state.apiConsecutiveFailures).toBe(0);
  });
});

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
    const { fetchDirectoryStreamersFromApi } = await import('../src/background/api-operations.ts');

    const state = createMinimalState();
    const game = createGame({ name: 'Test Game', categorySlug: 'test-game' });
    const session = createSession();
    const mockStreamers = [
      { id: 'streamer1', name: 'streamer1', displayName: 'Streamer One', viewersCount: 1000, broadcasterLanguage: 'en' },
      { id: 'streamer2', name: 'streamer2', displayName: 'Streamer Two', viewersCount: 500, broadcasterLanguage: 'es' },
    ];

    originalFetch = installFetchMock([
      async () => buildDirectoryResponse(mockStreamers),
    ]);

    const result = await fetchDirectoryStreamersFromApi(state, game, session);

    expect(result).toHaveLength(2);
  });

  test('returns empty array with languageFilterApplied=false when API returns empty', async () => {
    const { fetchDirectoryStreamersFromApi } = await import('../src/background/api-operations.ts');

    const state = createMinimalState();
    const game = createGame({ name: 'Test Game', categorySlug: 'test-game' });
    const session = createSession();

    originalFetch = installFetchMock([
      async () => buildDirectoryResponse([]),
    ]);

    const result = await fetchDirectoryStreamersFromApi(state, game, session);

    expect(result).toHaveLength(0);
    expect((result as unknown as { languageFilterApplied: boolean }).languageFilterApplied).toBe(false);
  });

  test('uses public client when session is null', async () => {
    const { fetchDirectoryStreamersFromApi } = await import('../src/background/api-operations.ts');

    const state = createMinimalState();
    const game = createGame({ name: 'Test Game', categorySlug: 'test-game' });
    const mockStreamers = [{ id: 'pub1', name: 'pub1', displayName: 'Public', viewersCount: 100 }];

    originalFetch = installFetchMock([
      async () => buildDirectoryResponse(mockStreamers),
    ]);

    const result = await fetchDirectoryStreamersFromApi(state, game, null);

    expect(result).toHaveLength(1);
  });

  test('returns empty array with languageFilterApplied=false on error', async () => {
    const { fetchDirectoryStreamersFromApi } = await import('../src/background/api-operations.ts');

    const state = createMinimalState();
    const game = createGame({ name: 'Test Game', categorySlug: 'test-game' });
    const session = createSession();

    originalFetch = installFetchMock([
      async () => { throw new Error('network failure'); },
    ]);

    const result = await fetchDirectoryStreamersFromApi(state, game, session);

    expect(result).toHaveLength(0);
    expect((result as unknown as { languageFilterApplied: boolean }).languageFilterApplied).toBe(false);
  });

  test('includes broadcasterLanguages in request when language is specified', async () => {
    const { fetchDirectoryStreamersFromApi } = await import('../src/background/api-operations.ts');

    const state = createMinimalState();
    const game = createGame({ name: 'Test Game', categorySlug: 'test-game' });
    const session = createSession();
    const mockStreamers = [{ id: 'eng1', name: 'eng1', displayName: 'English Streamer', viewersCount: 500, broadcasterLanguage: 'en' }];

    let capturedBody: Record<string, unknown> | null = null;
    const originalFetchMock = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      callCount++;
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

  test('clears session cache when isLikelyAuthError and session is present', async () => {
    const { fetchDirectoryStreamersFromApi } = await import('../src/background/api-operations.ts');

    const session = createSession();
    const state = createMinimalState({ twitchSessionCache: session });
    const game = createGame({ name: 'Test Game', categorySlug: 'test-game' });

    originalFetch = installFetchMock([
      async () => { throw new Error('401 unauthorized'); },
    ]);

    const result = await fetchDirectoryStreamersFromApi(state, game, session);

    expect(result).toHaveLength(0);
    expect((result as unknown as { languageFilterApplied: boolean }).languageFilterApplied).toBe(false);
  });
});
