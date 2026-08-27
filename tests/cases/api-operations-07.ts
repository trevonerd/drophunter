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

  test('marks external rewards claimed by global benefit id when timestamp is inside the window', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../../src/background/api-operations.ts');

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
    expect(drop?.rewardKind).toBe('in-game');
    expect(drop?.verificationState).toBe('unassessed');
  });

  test('does not globally claim external rewards without an awarded timestamp', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../../src/background/api-operations.ts');

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
});
