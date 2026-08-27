import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
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

  test('does not claim direct entitlements by matching only the reward name', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../../src/background/api-operations.ts');

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
    const { fetchDropsSnapshotFromApi } = await import('../../src/background/api-operations.ts');

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
    const campaignId = game.campaignId;
    if (!campaignId) throw new Error('Expected campaign id in test fixture');

    originalFetch = installFetchMock([
      async () => ({ data: { currentUser: { dropCampaigns: [campaign] } } }),
      async () =>
        buildInventoryResponse([
          {
            campaignId,
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
});
