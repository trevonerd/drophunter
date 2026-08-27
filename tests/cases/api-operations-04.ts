import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
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

  test('marks badge drops claimed from gameEventDrops when inventory still shows partial progress', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../../src/background/api-operations.ts');

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
              dropCampaignsInProgress: [
                {
                  id: campaign.id,
                  timeBasedDrops: [
                    {
                      id: 'road-to-twitchcon-badge-drop',
                      requiredMinutesWatched: 60,
                      self: {
                        currentMinutesWatched: 58,
                        isClaimed: false,
                        isClaimable: false,
                      },
                    },
                  ],
                },
              ],
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
    expect(drop?.rewardDistributionTypes).toContain('BADGE');
    expect(drop?.verificationState).toBe('verified');
  });
});
