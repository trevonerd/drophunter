import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  buildInventoryResponse,
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

  test('keeps text-only TwitchCon campaigns locked when Twitch reports no account connection', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../../src/background/api-operations.ts');

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
    expect(result?.games[0].isConnected).toBe(false);
    expect(result?.drops).toHaveLength(1);
  });

  test('does not lock IRL badge campaigns when Twitch reports no account connection', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../../src/background/api-operations.ts');

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
    const { fetchDropsSnapshotFromApi } = await import('../../src/background/api-operations.ts');

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
});
