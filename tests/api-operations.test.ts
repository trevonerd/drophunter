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

  test('returns an empty snapshot when Twitch reports no active campaigns', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../src/background/api-operations.ts');

    const state = createMinimalState();
    const session = createSession();

    originalFetch = installFetchMock([
      async () => buildDropsDashboardResponse([]),
      async () => buildInventoryResponse(),
    ]);

    const result = await fetchDropsSnapshotFromApi(state, session);

    expect(result).not.toBeNull();
    expect(result?.games).toEqual([]);
    expect(result?.drops).toEqual([]);
    expect(state.apiConsecutiveFailures).toBe(0);
    expect(state.apiBackoffUntil).toBe(0);
  });

  test('ViewerDropsDashboard does not request reward campaigns', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../src/background/api-operations.ts');

    const state = createMinimalState();
    const session = createSession();
    const game = createGame({ name: 'Test Game', campaignId: 'campaign-123', categorySlug: 'test-game' });
    const dashboardPayloads: Array<Record<string, unknown>> = [];

    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      let payload: unknown;

      if (Array.isArray(body)) {
        payload = buildCampaignDetailsResponse();
      } else if (body?.operationName === 'ViewerDropsDashboard') {
        dashboardPayloads.push(body);
        payload = buildDropsDashboardResponse([game]);
      } else if (body?.operationName === 'Inventory') {
        payload = buildInventoryResponse();
      } else {
        throw new Error(`Unexpected request: ${JSON.stringify(body)}`);
      }

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as FetchMock;

    const result = await fetchDropsSnapshotFromApi(state, session);

    expect(result?.games).toHaveLength(1);
    expect(dashboardPayloads).toHaveLength(1);
    expect(dashboardPayloads[0]?.variables).toEqual({ fetchRewardCampaigns: false });
  });

  test('marks simultaneous campaign drops claimed from historical gameEventDrops', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../src/background/api-operations.ts');

    const state = createMinimalState();
    const session = createSession();
    const endsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const claimedBenefit = { id: 'benefit-il-jacket', name: 'Pilot Jacket' };
    const campaign = {
      id: 'campaign-il',
      status: 'ACTIVE',
      endAt: endsAt,
      game: {
        displayName: 'IL',
        name: 'IL',
        slug: 'il',
        boxArtURL: 'https://example.com/il.png',
      },
      timeBasedDrops: ['drop-il-a', 'drop-il-b'].map((id) => ({
        id,
        name: 'Pilot Jacket Drop',
        requiredMinutesWatched: 60,
        endAt: endsAt,
        benefitEdges: [{ benefit: claimedBenefit }],
        self: {
          currentMinutesWatched: 0,
          isClaimed: false,
          isClaimable: false,
        },
      })),
      eventBasedDrops: [],
    };

    originalFetch = installFetchMock([
      async () => ({ data: { currentUser: { dropCampaigns: [campaign] } } }),
      async () => ({
        data: {
          currentUser: {
            inventory: {
              dropCampaignsInProgress: [],
              gameEventDrops: [
                {
                  ...claimedBenefit,
                  game: { displayName: 'IL' },
                },
              ],
            },
          },
        },
      }),
      async () => [{ data: { user: { dropCampaign: campaign } } }],
    ]);

    const result = await fetchDropsSnapshotFromApi(state, session);

    expect(result?.drops).toHaveLength(2);
    expect(result?.drops.every((drop) => drop.claimed)).toBe(true);
    expect(result?.drops.every((drop) => drop.claimable === false)).toBe(true);
    expect(result?.drops.every((drop) => drop.progress === 100)).toBe(true);
    expect(result?.drops.every((drop) => drop.remainingMinutes === 0)).toBe(true);
    expect(result?.drops.every((drop) => drop.status === 'completed')).toBe(true);
  });

  test('marks badge drops claimed from gameEventDrops when awarded during the drop window', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../src/background/api-operations.ts');

    const state = createMinimalState();
    const session = createSession();
    const startsAt = '2026-05-18T06:00:00.000Z';
    const endsAt = '2026-05-29T21:29:00.000Z';
    const benefit = {
      id: 'benefit-road-to-twitchcon-badge',
      name: 'RoadToTwitchCon26 Badge',
      distributionType: 'BADGE',
    };
    const campaign = {
      id: 'campaign-road-to-twitchcon-badge',
      name: 'RoadtoTwitchCon26',
      status: 'ACTIVE',
      startAt: startsAt,
      endAt: endsAt,
      game: {
        displayName: 'IRL',
        name: 'IRL',
        slug: 'irl',
        boxArtURL: 'https://example.com/irl.png',
      },
      timeBasedDrops: [
        {
          id: 'road-to-twitchcon-badge-drop',
          name: 'RoadToTwitchCon26',
          startAt: startsAt,
          endAt: endsAt,
          requiredMinutesWatched: 60,
          benefitEdges: [{ benefit }],
          self: {
            currentMinutesWatched: 58,
            isClaimed: false,
            isClaimable: false,
          },
        },
      ],
      eventBasedDrops: [],
    };

    originalFetch = installFetchMock([
      async () => ({ data: { currentUser: { dropCampaigns: [campaign] } } }),
      async () => ({
        data: {
          currentUser: {
            inventory: {
              dropCampaignsInProgress: [],
              gameEventDrops: [
                {
                  id: benefit.id,
                  name: benefit.name,
                  lastAwardedAt: '2026-05-19T08:00:00.000Z',
                  game: { displayName: 'IRL' },
                },
              ],
            },
          },
        },
      }),
      async () => [{ data: { user: { dropCampaign: campaign } } }],
    ]);

    const result = await fetchDropsSnapshotFromApi(state, session);
    const drop = result?.drops[0];

    expect(drop?.claimed).toBe(true);
    expect(drop?.progress).toBe(100);
    expect(drop?.remainingMinutes).toBe(0);
    expect(drop?.status).toBe('completed');
  });

  test('does not mark a drop claimed when the awarded timestamp is outside the drop window', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../src/background/api-operations.ts');

    const state = createMinimalState();
    const session = createSession();
    const startsAt = '2026-05-18T06:00:00.000Z';
    const endsAt = '2026-05-29T21:29:00.000Z';
    const benefit = { id: 'benefit-windowed-badge', name: 'Windowed Badge', distributionType: 'BADGE' };
    const campaign = {
      id: 'campaign-windowed-badge',
      status: 'ACTIVE',
      startAt: startsAt,
      endAt: endsAt,
      game: {
        displayName: 'IRL',
        name: 'IRL',
        slug: 'irl',
        boxArtURL: 'https://example.com/irl.png',
      },
      timeBasedDrops: [
        {
          id: 'windowed-badge-drop',
          name: 'Windowed Badge',
          startAt: startsAt,
          endAt: endsAt,
          requiredMinutesWatched: 60,
          benefitEdges: [{ benefit }],
          self: {
            currentMinutesWatched: 58,
            isClaimed: false,
            isClaimable: false,
          },
        },
      ],
      eventBasedDrops: [],
    };

    originalFetch = installFetchMock([
      async () => ({ data: { currentUser: { dropCampaigns: [campaign] } } }),
      async () => ({
        data: {
          currentUser: {
            inventory: {
              dropCampaignsInProgress: [],
              gameEventDrops: [
                {
                  id: benefit.id,
                  name: benefit.name,
                  lastAwardedAt: '2026-05-17T08:00:00.000Z',
                  game: { displayName: 'IRL' },
                },
              ],
            },
          },
        },
      }),
      async () => [{ data: { user: { dropCampaign: campaign } } }],
    ]);

    const result = await fetchDropsSnapshotFromApi(state, session);
    const drop = result?.drops[0];

    expect(drop?.claimed).toBe(false);
    expect(drop?.progress).toBe(96);
    expect(drop?.remainingMinutes).toBe(2);
  });

  test('does not mark a drop claimed when the awarded timestamp is invalid', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../src/background/api-operations.ts');

    const state = createMinimalState();
    const session = createSession();
    const startsAt = '2026-05-18T06:00:00.000Z';
    const endsAt = '2026-05-29T21:29:00.000Z';
    const benefit = { id: 'benefit-invalid-award', name: 'Invalid Award Badge', distributionType: 'BADGE' };
    const campaign = {
      id: 'campaign-invalid-award',
      status: 'ACTIVE',
      startAt: startsAt,
      endAt: endsAt,
      game: {
        displayName: 'IRL',
        name: 'IRL',
        slug: 'irl',
        boxArtURL: 'https://example.com/irl.png',
      },
      timeBasedDrops: [
        {
          id: 'invalid-award-badge-drop',
          name: 'Invalid Award Badge',
          startAt: startsAt,
          endAt: endsAt,
          requiredMinutesWatched: 60,
          benefitEdges: [{ benefit }],
          self: {
            currentMinutesWatched: 58,
            isClaimed: false,
            isClaimable: false,
          },
        },
      ],
      eventBasedDrops: [],
    };

    originalFetch = installFetchMock([
      async () => ({ data: { currentUser: { dropCampaigns: [campaign] } } }),
      async () => ({
        data: {
          currentUser: {
            inventory: {
              dropCampaignsInProgress: [],
              gameEventDrops: [
                {
                  id: benefit.id,
                  name: benefit.name,
                  lastAwardedAt: 'not-a-date',
                  game: { displayName: 'IRL' },
                },
              ],
            },
          },
        },
      }),
      async () => [{ data: { user: { dropCampaign: campaign } } }],
    ]);

    const result = await fetchDropsSnapshotFromApi(state, session);
    const drop = result?.drops[0];

    expect(drop?.claimed).toBe(false);
    expect(drop?.progress).toBe(96);
    expect(drop?.remainingMinutes).toBe(2);
  });

  test('marks external rewards claimed by global benefit id when timestamp is inside the window', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../src/background/api-operations.ts');

    const state = createMinimalState();
    const session = createSession();
    const startsAt = '2026-05-18T06:00:00.000Z';
    const endsAt = '2026-05-29T21:29:00.000Z';
    const benefit = {
      id: 'benefit-external-windowed',
      name: 'External Windowed Reward',
      distributionType: 'DIRECT_ENTITLEMENT',
    };
    const campaign = {
      id: 'campaign-external-windowed',
      status: 'ACTIVE',
      startAt: startsAt,
      endAt: endsAt,
      game: {
        displayName: 'External Game',
        name: 'External Game',
        slug: 'external-game',
        boxArtURL: 'https://example.com/external.png',
      },
      timeBasedDrops: [
        {
          id: 'external-windowed-drop',
          name: 'External Windowed Reward',
          startAt: startsAt,
          endAt: endsAt,
          requiredMinutesWatched: 60,
          benefitEdges: [{ benefit }],
          self: {
            currentMinutesWatched: 58,
            isClaimed: false,
            isClaimable: false,
          },
        },
      ],
      eventBasedDrops: [],
    };

    originalFetch = installFetchMock([
      async () => ({ data: { currentUser: { dropCampaigns: [campaign] } } }),
      async () => ({
        data: {
          currentUser: {
            inventory: {
              dropCampaignsInProgress: [],
              gameEventDrops: [
                {
                  id: benefit.id,
                  name: benefit.name,
                  lastAwardedAt: '2026-05-19T08:00:00.000Z',
                  game: { displayName: 'Different External Game Name' },
                },
              ],
            },
          },
        },
      }),
      async () => [{ data: { user: { dropCampaign: campaign } } }],
    ]);

    const result = await fetchDropsSnapshotFromApi(state, session);
    const drop = result?.drops[0];

    expect(drop?.claimed).toBe(true);
    expect(drop?.progress).toBe(100);
    expect(drop?.remainingMinutes).toBe(0);
  });

  test('does not globally claim external rewards without an awarded timestamp', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../src/background/api-operations.ts');

    const state = createMinimalState();
    const session = createSession();
    const startsAt = '2026-05-18T06:00:00.000Z';
    const endsAt = '2026-05-29T21:29:00.000Z';
    const benefit = {
      id: 'benefit-external-missing-timestamp',
      name: 'External Missing Timestamp Reward',
      distributionType: 'DIRECT_ENTITLEMENT',
    };
    const campaign = {
      id: 'campaign-external-missing-timestamp',
      status: 'ACTIVE',
      startAt: startsAt,
      endAt: endsAt,
      game: {
        displayName: 'External Game',
        name: 'External Game',
        slug: 'external-game',
        boxArtURL: 'https://example.com/external.png',
      },
      timeBasedDrops: [
        {
          id: 'external-missing-timestamp-drop',
          name: 'External Missing Timestamp Reward',
          startAt: startsAt,
          endAt: endsAt,
          requiredMinutesWatched: 60,
          benefitEdges: [{ benefit }],
          self: {
            currentMinutesWatched: 58,
            isClaimed: false,
            isClaimable: false,
          },
        },
      ],
      eventBasedDrops: [],
    };

    originalFetch = installFetchMock([
      async () => ({ data: { currentUser: { dropCampaigns: [campaign] } } }),
      async () => ({
        data: {
          currentUser: {
            inventory: {
              dropCampaignsInProgress: [],
              gameEventDrops: [
                {
                  id: benefit.id,
                  name: benefit.name,
                  game: { displayName: 'Different External Game Name' },
                },
              ],
            },
          },
        },
      }),
      async () => [{ data: { user: { dropCampaign: campaign } } }],
    ]);

    const result = await fetchDropsSnapshotFromApi(state, session);
    const drop = result?.drops[0];

    expect(drop?.claimed).toBe(false);
    expect(drop?.progress).toBe(96);
    expect(drop?.remainingMinutes).toBe(2);
  });

  test('does not claim direct entitlements by matching only the reward name', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../src/background/api-operations.ts');

    const state = createMinimalState();
    const session = createSession();
    const endsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const campaign = {
      id: 'campaign-direct-name-only',
      status: 'ACTIVE',
      endAt: endsAt,
      game: {
        displayName: 'External Game',
        name: 'External Game',
        slug: 'external-game',
        boxArtURL: 'https://example.com/external.png',
      },
      timeBasedDrops: [
        {
          id: 'direct-name-only-drop',
          name: 'Shared Reward Name',
          requiredMinutesWatched: 60,
          benefitEdges: [
            {
              benefit: {
                id: 'benefit-direct-campaign',
                name: 'Shared Reward Name',
                distributionType: 'DIRECT_ENTITLEMENT',
              },
            },
          ],
          self: {
            currentMinutesWatched: 58,
            isClaimed: false,
            isClaimable: false,
          },
        },
      ],
      eventBasedDrops: [],
    };

    originalFetch = installFetchMock([
      async () => ({ data: { currentUser: { dropCampaigns: [campaign] } } }),
      async () => ({
        data: {
          currentUser: {
            inventory: {
              dropCampaignsInProgress: [],
              gameEventDrops: [
                {
                  id: 'different-benefit-id',
                  name: 'Shared Reward Name',
                  game: { displayName: 'External Game' },
                },
              ],
            },
          },
        },
      }),
      async () => [{ data: { user: { dropCampaign: campaign } } }],
    ]);

    const result = await fetchDropsSnapshotFromApi(state, session);
    const drop = result?.drops[0];

    expect(drop?.claimed).toBe(false);
    expect(drop?.progress).toBe(96);
    expect(drop?.remainingMinutes).toBe(2);
  });

  test('marks fully watched but locked drops completed without inventing claimability', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../src/background/api-operations.ts');

    const state = createMinimalState();
    const session = createSession();
    const game = createGame({
      id: 'game-subnautica',
      name: 'Subnautica',
      campaignId: 'campaign-subnautica',
      categorySlug: 'subnautica',
    });
    const campaign = {
      id: game.campaignId,
      status: 'ACTIVE',
      endAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      self: {
        isAccountConnected: false,
      },
      game: {
        displayName: game.name,
        name: game.name,
        slug: game.categorySlug,
        boxArtURL: game.imageUrl,
      },
      timeBasedDrops: [
        {
          id: 'subnautica-locked-reward',
          name: 'Locked Account Reward',
          requiredMinutesWatched: 60,
          benefitEdges: [{ benefit: { id: 'benefit-subnautica-locked', name: 'Locked Account Reward' } }],
          self: {
            currentMinutesWatched: 0,
            isClaimed: false,
            isClaimable: false,
          },
        },
      ],
      eventBasedDrops: [],
    };

    originalFetch = installFetchMock([
      async () => ({ data: { currentUser: { dropCampaigns: [campaign] } } }),
      async () =>
        buildInventoryResponse([
          {
            campaignId: game.campaignId!,
            gameName: game.name,
            drops: [
              {
                dropId: 'subnautica-locked-reward',
                currentMinutes: 60,
                requiredMinutes: 60,
                isClaimed: false,
                isClaimable: false,
              },
            ],
          },
        ]),
      async () => [{ data: { user: { dropCampaign: campaign } } }],
    ]);

    const result = await fetchDropsSnapshotFromApi(state, session);
    const drop = result?.drops[0];

    expect(result?.games[0].isConnected).toBe(false);
    expect(drop?.claimed).toBe(false);
    expect(drop?.claimable).toBe(false);
    expect(drop?.progress).toBe(100);
    expect(drop?.remainingMinutes).toBe(0);
    expect(drop?.status).toBe('completed');
  });

  test('does not lock TwitchCon campaigns when Twitch reports no account connection', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../src/background/api-operations.ts');

    const state = createMinimalState();
    const session = createSession();
    const endsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const campaign = {
      id: 'campaign-road-to-twitchcon-26',
      name: 'RoadtoTwitchCon26',
      status: 'ACTIVE',
      endAt: endsAt,
      self: {
        isAccountConnected: false,
      },
      game: {
        displayName: 'IRL',
        name: 'IRL',
        slug: 'irl',
        boxArtURL: 'https://example.com/irl.png',
      },
      timeBasedDrops: [
        {
          id: 'road-to-twitchcon-26-reward',
          name: 'RoadToTwitchCon26',
          requiredMinutesWatched: 60,
          self: {
            currentMinutesWatched: 0,
            isClaimed: false,
            isClaimable: false,
          },
        },
      ],
      eventBasedDrops: [],
    };

    originalFetch = installFetchMock([
      async () => ({ data: { currentUser: { dropCampaigns: [campaign] } } }),
      async () => buildInventoryResponse(),
      async () => [{ data: { user: { dropCampaign: campaign } } }],
    ]);

    const result = await fetchDropsSnapshotFromApi(state, session);

    expect(result?.games).toHaveLength(1);
    expect(result?.games[0].isConnected).toBe(true);
    expect(result?.drops).toHaveLength(1);
  });

  test('does not lock IRL badge campaigns when Twitch reports no account connection', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../src/background/api-operations.ts');

    const state = createMinimalState();
    const session = createSession();
    const endsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const campaign = {
      id: 'campaign-irl-native-reward',
      status: 'ACTIVE',
      endAt: endsAt,
      self: {
        isAccountConnected: false,
      },
      game: {
        displayName: 'IRL',
        name: 'IRL',
        slug: 'irl',
        boxArtURL: 'https://example.com/irl.png',
      },
      timeBasedDrops: [
        {
          id: 'irl-native-reward',
          name: 'Community Reward',
          requiredMinutesWatched: 60,
          benefitEdges: [
            {
              benefit: {
                id: 'benefit-irl-badge',
                name: 'Community Badge',
                distributionType: 'BADGE',
              },
            },
          ],
          self: {
            currentMinutesWatched: 0,
            isClaimed: false,
            isClaimable: false,
          },
        },
      ],
      eventBasedDrops: [],
    };

    originalFetch = installFetchMock([
      async () => ({ data: { currentUser: { dropCampaigns: [campaign] } } }),
      async () => buildInventoryResponse(),
      async () => [{ data: { user: { dropCampaign: campaign } } }],
    ]);

    const result = await fetchDropsSnapshotFromApi(state, session);

    expect(result?.games).toHaveLength(1);
    expect(result?.games[0].isConnected).toBe(true);
    expect(result?.drops).toHaveLength(1);
  });

  test('keeps plain IRL campaigns locked when only the category looks native', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../src/background/api-operations.ts');

    const state = createMinimalState();
    const session = createSession();
    const endsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const campaign = {
      id: 'campaign-irl-external-reward',
      status: 'ACTIVE',
      endAt: endsAt,
      self: {
        isAccountConnected: false,
      },
      game: {
        displayName: 'IRL',
        name: 'IRL',
        slug: 'irl',
        boxArtURL: 'https://example.com/irl.png',
      },
      timeBasedDrops: [
        {
          id: 'irl-external-reward',
          name: 'Partner Account Reward',
          requiredMinutesWatched: 60,
          benefitEdges: [
            {
              benefit: {
                id: 'benefit-irl-external',
                name: 'Partner Account Reward',
                distributionType: 'DIRECT_ENTITLEMENT',
              },
            },
          ],
          self: {
            currentMinutesWatched: 0,
            isClaimed: false,
            isClaimable: false,
          },
        },
      ],
      eventBasedDrops: [],
    };

    originalFetch = installFetchMock([
      async () => ({ data: { currentUser: { dropCampaigns: [campaign] } } }),
      async () => buildInventoryResponse(),
      async () => [{ data: { user: { dropCampaign: campaign } } }],
    ]);

    const result = await fetchDropsSnapshotFromApi(state, session);

    expect(result?.games).toHaveLength(1);
    expect(result?.games[0].isConnected).toBe(false);
    expect(result?.drops).toHaveLength(1);
  });

  test('returns an authoritative empty snapshot when refreshed campaign data has no games or drops', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../src/background/api-operations.ts');

    const state = createMinimalState();
    const session = createSession();

    originalFetch = installFetchMock([
      async () => ({ data: { currentUser: { dropCampaigns: [] } } }),
      async () => buildInventoryResponse(),
    ]);

    const result = await fetchDropsSnapshotFromApi(state, session);

    expect(result).not.toBeNull();
    expect(result?.games).toEqual([]);
    expect(result?.drops).toEqual([]);
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

  test('rethrows auth errors so wrappers can refresh the Twitch session', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../src/background/api-operations.ts');

    const state = createMinimalState({ apiConsecutiveFailures: 0 });
    const session = createSession();

    originalFetch = installFetchMock([
      async () => { throw new Error('401 unauthorized'); },
    ]);

    await expect(fetchDropsSnapshotFromApi(state, session)).rejects.toThrow('401 unauthorized');
    expect(state.apiConsecutiveFailures).toBe(0);
    expect(state.apiBackoffUntil).toBe(0);
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

  test('wrapper stops running farming when auth still fails after forced session refresh', async () => {
    const { fetchDropsSnapshotFromApiWrapper } = await import('../src/background/api-operations.ts');
    const { TwitchApiClient } = await import('../src/background/twitch-api/client.ts');

    const session = createSession();
    const state = createMinimalState({
      appState: { ...createInitialState(), isRunning: true },
      twitchSessionCache: session,
    });
    const ensureCalls: boolean[] = [];
    let stopReason: string | undefined;

    let dashboardCalls = 0;
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      if (body?.operationName === 'ViewerDropsDashboard') {
        dashboardCalls += 1;
        throw new Error(dashboardCalls === 1 ? '401 unauthorized' : 'invalid oauth token');
      }
      return {
        ok: true,
        status: 200,
        json: async () => buildInventoryResponse(),
        text: async () => JSON.stringify(buildInventoryResponse()),
      } as Response;
    }) as FetchMock;

    const result = await fetchDropsSnapshotFromApiWrapper(
      state,
      false,
      {
        onEnsureTwitchSession: async (forceRefresh = false) => {
          ensureCalls.push(forceRefresh);
          return session;
        },
        onEnsureSessionIntegrity: async () => session,
        onPersistTwitchSession: async () => undefined,
        onStopFarmingSession: async (options) => {
          stopReason = options.stopReason;
        },
        onIsLikelyAuthError: (error) => /401|invalid oauth token/i.test(String(error)),
        onClearTwitchSessionCache: (nextState) => {
          nextState.twitchSessionCache = null;
        },
      },
      {
        TwitchApiClient,
        sessionDebugSummary: (nextSession) => ({ available: Boolean(nextSession) }),
        PROGRESS_POLL_MS: 60_000,
        logDebug: () => undefined,
        logWarn: () => undefined,
        logInfo: () => undefined,
      },
    );

    expect(result).toBeNull();
    expect(ensureCalls).toEqual([false, true]);
    expect(stopReason).toBe('sign-in-required');
    expect(state.apiConsecutiveFailures).toBe(0);
    expect(state.apiBackoffUntil).toBe(0);
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

  test('rethrows inventory auth errors so wrappers can refresh the Twitch session', async () => {
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
      },
    ];

    originalFetch = installFetchMock([
      async () => { throw new Error('403 forbidden'); },
    ]);

    await expect(fetchInventorySnapshotFromApi(state, session, cachedDrops)).rejects.toThrow(
      '403 forbidden',
    );
    expect(state.apiConsecutiveFailures).toBe(0);
    expect(state.apiBackoffUntil).toBe(0);
  });

  test('wrapper stops running farming when inventory auth still fails after forced session refresh', async () => {
    const { fetchInventorySnapshotFromApiWrapper } = await import('../src/background/api-operations.ts');

    const session = createSession();
    const state = createMinimalState({
      appState: { ...createInitialState(), isRunning: true },
      twitchSessionCache: session,
    });
    const ensureCalls: boolean[] = [];
    let stopReason: string | undefined;
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
      },
    ];

    originalFetch = installFetchMock([
      async () => { throw new Error('403 forbidden'); },
      async () => { throw new Error('invalid oauth token'); },
    ]);

    const result = await fetchInventorySnapshotFromApiWrapper(
      state,
      cachedDrops,
      false,
      {
        onEnsureTwitchSession: async (forceRefresh = false) => {
          ensureCalls.push(forceRefresh);
          return session;
        },
        onStopFarmingSession: async (options) => {
          stopReason = options.stopReason;
        },
        onIsLikelyAuthError: (error) => /403|invalid oauth token/i.test(String(error)),
        onClearTwitchSessionCache: (nextState) => {
          nextState.twitchSessionCache = null;
        },
      },
      { logWarn: () => undefined },
    );

    expect(result).toBeNull();
    expect(ensureCalls).toEqual([false, true]);
    expect(stopReason).toBe('sign-in-required');
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
