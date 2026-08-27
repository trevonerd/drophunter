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

  test('marks emote drops claimed from gameEventDrops when inventory still shows partial progress', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../../src/background/api-operations.ts');

    const state = createMinimalState();
    const session = createSession();
    const startsAt = '2026-05-18T06:00:00.000Z';
    const endsAt = '2026-05-29T21:29:00.000Z';
    const benefit = {
      id: 'benefit-twitch-emote',
      name: 'Twitch Emote',
      distributionType: 'EMOTE',
    };
    const campaign = {
      id: 'campaign-twitch-emote',
      name: 'Twitch Emote Campaign',
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
          id: 'twitch-emote-drop',
          name: 'Twitch Emote',
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
                      id: 'twitch-emote-drop',
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
    expect(drop?.rewardDistributionTypes).toContain('EMOTE');
    expect(drop?.verificationState).toBe('verified');
  });

  test('does not verify a Twitch benefit reused by overlapping sibling campaigns', async () => {
    // Given: sibling campaigns reuse one badge benefit for the same game and overlapping window.
    const { fetchDropsSnapshotFromApi } = await import('../../src/background/api-operations.ts');
    const startsAt = '2026-05-18T06:00:00.000Z';
    const endsAt = '2026-05-29T21:29:00.000Z';
    const benefit = { id: 'shared-sibling-badge', name: 'Shared Badge', distributionType: 'BADGE' };
    const makeCampaign = (campaignId: string, dropId: string) => ({
      id: campaignId,
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
          id: dropId,
          name: 'Shared Badge',
          startAt: startsAt,
          endAt: endsAt,
          requiredMinutesWatched: 60,
          benefitEdges: [{ benefit }],
          self: { currentMinutesWatched: 58, isClaimed: false, isClaimable: false },
        },
      ],
      eventBasedDrops: [],
    });
    const campaigns = [
      makeCampaign('sibling-campaign-a', 'sibling-drop-a'),
      makeCampaign('sibling-campaign-b', 'sibling-drop-b'),
    ];
    originalFetch = installFetchMock([
      async () => ({ data: { currentUser: { dropCampaigns: campaigns } } }),
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
      async () => campaigns.map((campaign) => ({ data: { user: { dropCampaign: campaign } } })),
    ]);

    // When: the full snapshot parser evaluates the single award against both campaigns.
    const result = await fetchDropsSnapshotFromApi(createMinimalState(), createSession());

    // Then: neither sibling receives claimed progress or verified acquisition from ambiguous proof.
    expect({
      drops: result?.drops.length,
      claimed: result?.drops.filter((drop) => drop.claimed).length,
      completed: result?.drops.filter((drop) => drop.progress === 100).length,
      verified: result?.drops.filter((drop) => drop.verificationState === 'verified').length,
    }).toEqual({ drops: 2, claimed: 0, completed: 0, verified: 0 });
  });
});
