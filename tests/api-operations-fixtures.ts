import type { ServiceWorkerState } from '../src/background/service-worker.ts';
import type { TwitchSession } from '../src/background/twitch-api/types.ts';
import { createInitialState } from '../src/shared/utils.ts';
import type { TwitchGame } from '../src/types/index.ts';

export function createMinimalState(overrides: Partial<ServiceWorkerState> = {}): ServiceWorkerState {
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
    queueMissingStreak: new Map(),
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

export function createSession(overrides: Partial<TwitchSession> = {}): TwitchSession {
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

export function createGame(overrides: Partial<TwitchGame> = {}): TwitchGame {
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

export type FetchMock = typeof globalThis.fetch;

export function installFetchMock(responses: Array<() => Promise<unknown>>): FetchMock {
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
      finalResult = result[0];
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

export function restoreFetch(original: FetchMock | undefined) {
  if (original) {
    globalThis.fetch = original;
  }
}

export function buildDropsDashboardResponse(games: TwitchGame[]): unknown {
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

export function buildInventoryResponse(
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

export function buildCampaignDetailsResponse(): unknown {
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

export function buildDirectoryResponse(
  streamers: Array<{
    id: string;
    name: string;
    displayName: string;
    viewersCount?: number;
    broadcasterLanguage?: string;
  }>,
  _language?: string,
): unknown {
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

export function _buildIntegrityResponse(): unknown {
  return { token: 'mock-integrity-token' };
}
