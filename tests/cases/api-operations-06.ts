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

  test('does not mark a drop claimed when the awarded timestamp is outside the drop window', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../../src/background/api-operations.ts');

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
    expect(drop?.verificationState).toBe('unassessed');
  });

  test('does not mark a drop claimed when the awarded timestamp is invalid', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../../src/background/api-operations.ts');

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
    expect(drop?.verificationState).toBe('unassessed');
  });
});
