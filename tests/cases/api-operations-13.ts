import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { TwitchDrop } from '../../src/types/index.ts';
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

describe('fetchInventorySnapshotFromApi', () => {
  let originalFetch: FetchMock | undefined;

  beforeEach(() => {
    chromeMocks = setupChromeMocks();
  });

  afterEach(() => {
    restoreFetch(originalFetch);
    chromeMocks.teardown();
  });

  test('updates cached drop progress with inventory only', async () => {
    const { fetchInventorySnapshotFromApi } = await import('../../src/background/api-operations.ts');

    const state = createMinimalState();
    const session = createSession();
    const cachedDrops: TwitchDrop[] = [
      {
        id: 'drop-1',
        name: 'For Honor Drop',
        gameId: 'campaign-for-honor',
        gameName: 'For Honor',
        imageUrl: 'https://example.com/drop.png',
        progress: 50,
        currentMinutes: 120,
        claimed: false,
        campaignId: 'campaign-for-honor',
        requiredMinutes: 240,
        remainingMinutes: 120,
        acquisitionMethod: 'watch-time',
        rewardKind: 'in-game',
        verificationState: 'unassessed',
      },
    ];

    originalFetch = installFetchMock([
      async () =>
        buildInventoryResponse([
          {
            campaignId: 'campaign-for-honor',
            gameName: 'For Honor',
            drops: [
              {
                dropId: 'drop-1',
                currentMinutes: 180,
                requiredMinutes: 240,
              },
            ],
          },
        ]),
    ]);

    const result = await fetchInventorySnapshotFromApi(state, session, cachedDrops);

    expect(result).not.toBeNull();
    expect(result?.games).toEqual([]);
    expect(result?.drops).toHaveLength(1);
    expect(result?.drops[0].currentMinutes).toBe(180);
    expect(result?.drops[0].progress).toBe(75);
    expect(result?.drops[0].remainingMinutes).toBe(60);
    expect(result?.drops[0].progressSource).toBe('inventory');
    expect(state.apiConsecutiveFailures).toBe(0);
  });

  test('marks early-awarded emote drops claimed during inventory-only refresh', async () => {
    const { fetchInventorySnapshotFromApi } = await import('../../src/background/api-operations.ts');

    const state = createMinimalState();
    const session = createSession();
    const startsAt = '2026-05-18T06:00:00.000Z';
    const endsAt = '2026-05-29T21:29:00.000Z';
    const cachedDrops: TwitchDrop[] = [
      {
        id: 'twitch-emote-drop',
        name: 'Twitch Emote',
        gameId: 'campaign-twitch-emote',
        gameName: 'IRL',
        imageUrl: 'https://example.com/drop.png',
        progress: 98,
        currentMinutes: 58,
        claimed: false,
        campaignId: 'campaign-twitch-emote',
        startsAt,
        endsAt,
        requiredMinutes: 60,
        remainingMinutes: 2,
        acquisitionMethod: 'watch-time',
        rewardKind: 'twitch-emote',
        verificationState: 'unassessed',
        benefitIds: ['benefit-twitch-emote'],
        rewardDistributionTypes: ['EMOTE'],
      },
    ];

    originalFetch = installFetchMock([
      async () => ({
        data: {
          currentUser: {
            inventory: {
              dropCampaignsInProgress: [
                {
                  id: 'campaign-twitch-emote',
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
                  id: 'benefit-twitch-emote',
                  name: 'Twitch Emote',
                  lastAwardedAt: '2026-05-19T08:00:00.000Z',
                  game: { displayName: 'IRL' },
                },
              ],
            },
          },
        },
      }),
    ]);

    const result = await fetchInventorySnapshotFromApi(state, session, cachedDrops);

    expect(result).not.toBeNull();
    expect(result?.drops[0].claimed).toBe(true);
    expect(result?.drops[0].progress).toBe(100);
    expect(result?.drops[0].status).toBe('completed');
    expect(result?.drops[0].verificationState).toBe('verified');
  });
});
