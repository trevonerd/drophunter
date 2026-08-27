import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
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

  test('returns snapshot when API call succeeds', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../../src/background/api-operations.ts');

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
    const { fetchDropsSnapshotFromApi } = await import('../../src/background/api-operations.ts');

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

  test('skips malformed campaign reward members and keeps valid time and event siblings', async () => {
    // Given: the dashboard has one campaign whose details contain malformed and valid reward members.
    const { TwitchApiClient } = await import('../../src/background/twitch-api/client.ts');
    const campaign = {
      id: 'campaign-null-reward-members',
      status: 'ACTIVE',
      startAt: '2026-07-01T00:00:00.000Z',
      endAt: '2099-08-01T00:00:00.000Z',
      game: {
        id: 'null-reward-game',
        displayName: 'Null Reward Game',
        name: 'Null Reward Game',
        slug: 'null-reward-game',
        boxArtURL: 'https://example.com/null-reward-game.png',
      },
      timeBasedDrops: [],
      eventBasedDrops: [],
    };
    const details = {
      id: campaign.id,
      timeBasedDrops: [
        null,
        'wrong-shape-time-reward',
        {
          id: 'valid-time-reward',
          name: 'BADGE EMOTE text on an ordinary entitlement',
          requiredMinutesWatched: 60,
          benefitEdges: [
            {
              benefit: {
                id: 'valid-time-benefit',
                distributionType: 'DIRECT_ENTITLEMENT',
              },
            },
          ],
        },
      ],
      eventBasedDrops: [
        null,
        7,
        {
          id: 'valid-event-reward',
          name: 'Valid Event Reward',
          benefitEdges: [
            {
              benefit: {
                id: 'valid-event-benefit',
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
      async () => [{ data: { user: { dropCampaign: details } } }],
    ]);

    // When: the real Twitch API client performs the complete dashboard, inventory, and details refresh.
    const result = await new TwitchApiClient(createSession()).fetchDropsSnapshot();

    // Then: malformed members are skipped, both valid siblings parse, and reward kind uses structured fields.
    expect({
      games: result.games.map(({ campaignId, dropCount }) => ({ campaignId, dropCount })),
      drops: result.drops.map(({ id, name, rewardKind, acquisitionMethod }) => ({
        id,
        name,
        rewardKind,
        acquisitionMethod,
      })),
    }).toEqual({
      games: [{ campaignId: campaign.id, dropCount: 2 }],
      drops: [
        {
          id: 'valid-time-reward',
          name: 'BADGE EMOTE text on an ordinary entitlement',
          rewardKind: 'in-game',
          acquisitionMethod: 'watch-time',
        },
        {
          id: 'valid-event-reward',
          name: 'Valid Event Reward',
          rewardKind: 'in-game',
          acquisitionMethod: 'subscription',
        },
      ],
    });
  });
});
