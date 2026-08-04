import { afterEach, describe, expect, test } from 'bun:test';
import { TwitchApiClient } from '../src/background/twitch-api/client.ts';
import type { TwitchSession } from '../src/background/twitch-api/types.ts';

type CampaignFixture = {
  readonly id: string;
  readonly gameName: string;
};

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: (value) => resolvePromise(value),
    reject: (reason) => rejectPromise(reason),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function responseFor(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createSession(): TwitchSession {
  return {
    oauthToken: 'test-token-at-least-20-chars-long',
    userId: '123456789',
    deviceId: 'device-id-test-abc-12345678',
    uuid: 'test-uuid-abc',
    clientId: 'test-client-id',
  };
}

function createCampaigns(count: number): CampaignFixture[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `campaign-${index + 1}`,
    gameName: `Game ${index + 1}`,
  }));
}

function dashboardResponse(campaigns: readonly CampaignFixture[]): unknown {
  return {
    data: {
      currentUser: {
        dropCampaigns: campaigns.map((campaign) => ({
          id: campaign.id,
          status: 'ACTIVE',
          game: {
            displayName: campaign.gameName,
            name: campaign.gameName,
            slug: campaign.gameName.toLowerCase().replaceAll(' ', '-'),
          },
        })),
      },
    },
  };
}

function inventoryResponse(): unknown {
  return {
    data: {
      currentUser: {
        inventory: {
          dropCampaignsInProgress: [],
          gameEventDrops: [],
        },
      },
    },
  };
}

function campaignDetailsResponse(campaignIds: readonly string[]): unknown {
  return campaignIds.map((campaignId) => ({
    data: {
      user: {
        dropCampaign: {
          id: campaignId,
          timeBasedDrops: [
            {
              id: `${campaignId}-drop`,
              name: `${campaignId} Drop`,
              requiredMinutesWatched: 60,
              self: {
                currentMinutesWatched: 15,
                isClaimed: false,
                isClaimable: false,
              },
            },
          ],
          eventBasedDrops: [],
        },
      },
    },
  }));
}

function campaignIdsFromPayload(payload: unknown): string[] {
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload.flatMap((entry) => {
    if (!isRecord(entry) || !isRecord(entry.variables)) {
      return [];
    }
    const dropId = entry.variables.dropID;
    return typeof dropId === 'string' ? [dropId] : [];
  });
}

let originalFetch: typeof globalThis.fetch | undefined;

afterEach(() => {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = undefined;
  }
});

describe.serial('Twitch campaign synchronization', () => {
  test.serial('preserves Twitch category identity and only safe external account-link URLs', async () => {
    const campaigns = [
      { id: 'campaign-safe', gameName: 'Cyberpunk 2077' },
      { id: 'campaign-twitch-link', gameName: 'Cyberpunk 2077' },
    ];
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
      const payload: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      if (isRecord(payload) && payload.operationName === 'ViewerDropsDashboard') {
        return responseFor({
          data: {
            currentUser: {
              dropCampaigns: campaigns.map((campaign) => ({
                id: campaign.id,
                status: 'ACTIVE',
                accountLinkURL:
                  campaign.id === 'campaign-safe'
                    ? 'https://accounts.cdprojektred.com/twitch/link'
                    : 'https://www.twitch.tv/drops/connections',
                self: { isAccountConnected: false },
                game: {
                  id: '509658',
                  displayName: campaign.gameName,
                  name: campaign.gameName,
                  slug: 'cyberpunk-2077',
                },
              })),
            },
          },
        });
      }
      if (isRecord(payload) && payload.operationName === 'Inventory') {
        return responseFor(inventoryResponse());
      }
      if (Array.isArray(payload)) {
        return responseFor(campaignDetailsResponse(campaignIdsFromPayload(payload)));
      }
      throw new Error('Unexpected Twitch GQL request');
    };

    const snapshot = await new TwitchApiClient(createSession()).fetchDropsSnapshot();
    const safe = snapshot.games.find((game) => game.campaignId === 'campaign-safe');
    const twitchHosted = snapshot.games.find((game) => game.campaignId === 'campaign-twitch-link');

    expect(safe).toMatchObject({
      categoryId: '509658',
      categorySlug: 'cyberpunk-2077',
      accountLinkUrl: 'https://accounts.cdprojektred.com/twitch/link',
      isConnected: false,
    });
    expect(twitchHosted?.categoryId).toBe('509658');
    expect(twitchHosted?.accountLinkUrl).toBeUndefined();
  });

  test.serial('limits campaign detail batch requests to two workers while draining every batch', async () => {
    const campaigns = createCampaigns(41);
    const firstBatch = createDeferred<unknown>();
    const secondBatch = createDeferred<unknown>();
    const thirdBatch = createDeferred<unknown>();
    const firstBatchStarted = createDeferred<void>();
    const thirdBatchStarted = createDeferred<void>();
    let detailBatchCalls = 0;
    let activeDetailBatches = 0;
    let maxActiveDetailBatches = 0;

    originalFetch = globalThis.fetch;
    const mockFetch: typeof globalThis.fetch = async (_input, init) => {
      const payload: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      if (isRecord(payload) && payload.operationName === 'ViewerDropsDashboard') {
        return responseFor(dashboardResponse(campaigns));
      }
      if (isRecord(payload) && payload.operationName === 'Inventory') {
        return responseFor(inventoryResponse());
      }
      if (Array.isArray(payload)) {
        detailBatchCalls += 1;
        const batchNumber = detailBatchCalls;
        activeDetailBatches += 1;
        maxActiveDetailBatches = Math.max(maxActiveDetailBatches, activeDetailBatches);
        if (batchNumber === 1) {
          firstBatchStarted.resolve();
        }
        const batchResponse =
          batchNumber === 1
            ? firstBatch.promise
            : batchNumber === 2
              ? secondBatch.promise
              : thirdBatch.promise.then((value) => {
                  activeDetailBatches -= 1;
                  return value;
                });
        if (batchNumber === 3) {
          thirdBatchStarted.resolve();
        }
        return batchResponse.then((value) => {
          if (batchNumber < 3) {
            activeDetailBatches -= 1;
          }
          return responseFor(value);
        });
      }
      throw new Error('Unexpected Twitch GQL request');
    };
    globalThis.fetch = mockFetch;

    const client = new TwitchApiClient(createSession());
    const refresh = client.fetchDropsSnapshot();
    await firstBatchStarted.promise;
    await Promise.resolve();

    expect({ detailBatchCalls, activeDetailBatches, maxActiveDetailBatches }).toEqual({
      detailBatchCalls: 2,
      activeDetailBatches: 2,
      maxActiveDetailBatches: 2,
    });

    firstBatch.resolve(campaignDetailsResponse(campaigns.slice(0, 20).map(({ id }) => id)));
    await thirdBatchStarted.promise;
    expect(maxActiveDetailBatches).toBe(2);

    secondBatch.resolve(campaignDetailsResponse(campaigns.slice(20, 40).map(({ id }) => id)));
    thirdBatch.resolve(campaignDetailsResponse(campaigns.slice(40).map(({ id }) => id)));

    const snapshot = await refresh;
    expect({ detailBatchCalls, games: snapshot.games.length, drops: snapshot.drops.length }).toEqual({
      detailBatchCalls: 3,
      games: 41,
      drops: 41,
    });
  });

  test.serial('coalesces concurrent full snapshot refreshes for one Twitch session', async () => {
    const campaigns = createCampaigns(1);
    const dashboardGate = createDeferred<unknown>();
    const dashboardStarted = createDeferred<void>();
    let dashboardCalls = 0;
    let inventoryCalls = 0;
    let detailBatchCalls = 0;

    originalFetch = globalThis.fetch;
    const mockFetch: typeof globalThis.fetch = async (_input, init) => {
      const payload: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      if (isRecord(payload) && payload.operationName === 'ViewerDropsDashboard') {
        dashboardCalls += 1;
        dashboardStarted.resolve();
        return dashboardGate.promise.then(responseFor);
      }
      if (isRecord(payload) && payload.operationName === 'Inventory') {
        inventoryCalls += 1;
        return responseFor(inventoryResponse());
      }
      if (Array.isArray(payload)) {
        detailBatchCalls += 1;
        return responseFor(campaignDetailsResponse(campaignIdsFromPayload(payload)));
      }
      throw new Error('Unexpected Twitch GQL request');
    };
    globalThis.fetch = mockFetch;

    const session = createSession();
    const firstRefresh = new TwitchApiClient(session).fetchDropsSnapshot();
    await dashboardStarted.promise;
    const secondRefresh = new TwitchApiClient(session).fetchDropsSnapshot();

    expect({ dashboardCalls, inventoryCalls, detailBatchCalls }).toEqual({
      dashboardCalls: 1,
      inventoryCalls: 1,
      detailBatchCalls: 0,
    });

    dashboardGate.resolve(dashboardResponse(campaigns));
    const [firstSnapshot, secondSnapshot] = await Promise.all([firstRefresh, secondRefresh]);
    expect(secondSnapshot).toBe(firstSnapshot);
    expect(detailBatchCalls).toBe(1);
  });

  test.serial('retains the last valid snapshot when a later detail refresh fails', async () => {
    const campaigns = createCampaigns(21);
    let detailBatchCalls = 0;

    originalFetch = globalThis.fetch;
    const mockFetch: typeof globalThis.fetch = async (_input, init) => {
      const payload: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      if (isRecord(payload) && payload.operationName === 'ViewerDropsDashboard') {
        return responseFor(dashboardResponse(campaigns));
      }
      if (isRecord(payload) && payload.operationName === 'Inventory') {
        return responseFor(inventoryResponse());
      }
      if (Array.isArray(payload)) {
        detailBatchCalls += 1;
        if (detailBatchCalls === 4) {
          throw new Error('temporary campaign detail outage');
        }
        return responseFor(campaignDetailsResponse(campaignIdsFromPayload(payload)));
      }
      throw new Error('Unexpected Twitch GQL request');
    };
    globalThis.fetch = mockFetch;

    const client = new TwitchApiClient(createSession());
    const firstSnapshot = await client.fetchDropsSnapshot();
    const recoveredSnapshot = await client.fetchDropsSnapshot();

    expect({
      detailBatchCalls,
      firstGames: firstSnapshot.games.length,
      firstDrops: firstSnapshot.drops.length,
      recoveredGames: recoveredSnapshot.games.length,
      recoveredDrops: recoveredSnapshot.drops.length,
    }).toEqual({
      detailBatchCalls: 4,
      firstGames: 21,
      firstDrops: 21,
      recoveredGames: 21,
      recoveredDrops: 21,
    });
  });
});
