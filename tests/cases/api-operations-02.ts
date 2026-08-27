import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isRewardAutomatable } from '../../src/shared/reward-semantics.ts';
import {
  buildCampaignDetailsResponse,
  buildDropsDashboardResponse,
  buildInventoryResponse,
  createGame,
  createMinimalState,
  createSession,
  type FetchMock,
  installFetchMock,
  restoreFetch,
} from '../api-operations-fixtures.ts';
import { type ChromeMocks, setupChromeMocks } from '../mocks/chrome.ts';

let chromeMocks: ChromeMocks;

describe('fetchDropsSnapshotFromApi', () => {
  let originalFetch: FetchMock | undefined;

  beforeEach(() => {
    chromeMocks = setupChromeMocks();
  });

  afterEach(() => {
    restoreFetch(originalFetch);
    chromeMocks.teardown();
  });

  test('keeps a subscription-only active campaign selectable without making its reward automatable', async () => {
    // Given: Twitch exposes one usable campaign whose only reward requires a subscription.
    const { TwitchApiClient } = await import('../../src/background/twitch-api/client.ts');
    const campaign = {
      id: 'subscription-only',
      status: 'ACTIVE',
      startAt: '2026-07-01T00:00:00.000Z',
      endAt: '2099-08-01T00:00:00.000Z',
      game: {
        id: 'subscriber-game',
        displayName: 'Subscriber Game',
        name: 'Subscriber Game',
        slug: 'subscriber-game',
        boxArtURL: 'https://example.com/subscriber-game.png',
      },
      timeBasedDrops: [
        {
          id: 'subscription-drop',
          name: 'Subscriber Reward',
          requiredMinutesWatched: 0,
          benefitEdges: [
            {
              benefit: {
                id: 'subscription-benefit',
                name: 'Subscriber Reward',
                distributionType: 'DIRECT_ENTITLEMENT',
              },
            },
          ],
        },
      ],
      eventBasedDrops: [],
    };
    originalFetch = installFetchMock([
      async () => ({ data: { currentUser: { dropCampaigns: [campaign] } } }),
      async () => buildInventoryResponse(),
      async () => [{ data: { user: { dropCampaign: campaign } } }],
    ]);

    // When: the full client fetches and parses the dashboard, inventory, and campaign details.
    const result = await new TwitchApiClient(createSession()).fetchDropsSnapshot();

    // Then: campaign identity stays selectable while reward automation semantics stay unchanged.
    expect({
      games: result.games.map(({ campaignId, dropCount }) => ({ campaignId, dropCount })),
      drops: result.drops.map((drop) => ({
        campaignId: drop.campaignId,
        acquisitionMethod: drop.acquisitionMethod,
        rewardKind: drop.rewardKind,
        automatable: isRewardAutomatable(drop),
      })),
    }).toEqual({
      games: [{ campaignId: 'subscription-only', dropCount: 1 }],
      drops: [
        {
          campaignId: 'subscription-only',
          acquisitionMethod: 'subscription',
          rewardKind: 'in-game',
          automatable: false,
        },
      ],
    });
  });

  test('classifies the Twitch event bucket as subscription without inferring another event', async () => {
    // Given: Twitch places an ordinary entitlement in eventBasedDrops with a misleading minute field.
    const { fetchDropsSnapshotFromApi } = await import('../../src/background/api-operations.ts');
    const campaign = {
      id: 'campaign-event-subscription',
      status: 'ACTIVE',
      startAt: '2026-07-01T00:00:00.000Z',
      endAt: '2026-08-31T00:00:00.000Z',
      game: {
        displayName: 'Event Game',
        name: 'Event Game',
        slug: 'event-game',
        boxArtURL: 'https://example.com/event-game.png',
      },
      timeBasedDrops: [],
      eventBasedDrops: [
        {
          id: 'event-subscription-drop',
          name: 'Event Reward',
          requiredMinutesWatched: 999,
          benefitEdges: [
            {
              benefit: {
                id: 'event-subscription-benefit',
                name: 'Event Reward',
                distributionType: 'DIRECT_ENTITLEMENT',
              },
            },
          ],
        },
      ],
    };
    originalFetch = installFetchMock([
      async () => ({ data: { currentUser: { dropCampaigns: [campaign] } } }),
      async () => buildInventoryResponse(),
      async () => [{ data: { user: { dropCampaign: campaign } } }],
    ]);

    // When: a full snapshot crosses the real dashboard, details, and parser path.
    const result = await fetchDropsSnapshotFromApi(createMinimalState(), createSession());

    // Then: the source bucket decides subscription and ordinary verification stays unassessed.
    expect({
      acquisitionMethod: result?.drops[0]?.acquisitionMethod,
      rewardKind: result?.drops[0]?.rewardKind,
      verificationState: result?.drops[0]?.verificationState,
    }).toEqual({
      acquisitionMethod: 'subscription',
      rewardKind: 'in-game',
      verificationState: 'unassessed',
    });
  });

  test('ViewerDropsDashboard does not request reward campaigns', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../../src/background/api-operations.ts');

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
});
