import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { TwitchDrop } from '../../src/types/index.ts';
import {
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

  test('keeps sibling-reused Twitch benefits unverified during inventory-only refresh', async () => {
    // Given: cached sibling campaigns share a badge benefit and inventory reports one matching award.
    const { fetchInventorySnapshotFromApi } = await import('../../src/background/api-operations.ts');
    const startsAt = '2026-05-18T06:00:00.000Z';
    const endsAt = '2026-05-29T21:29:00.000Z';
    const cachedDrops: TwitchDrop[] = ['a', 'b'].map((suffix) => ({
      id: `sibling-inventory-drop-${suffix}`,
      name: 'Shared Inventory Badge',
      gameId: `sibling-inventory-campaign-${suffix}`,
      gameName: 'IRL',
      imageUrl: 'https://example.com/drop.png',
      progress: 96,
      currentMinutes: 58,
      claimed: false,
      campaignId: `sibling-inventory-campaign-${suffix}`,
      startsAt,
      endsAt,
      requiredMinutes: 60,
      remainingMinutes: 2,
      acquisitionMethod: 'watch-time',
      rewardKind: 'twitch-badge',
      verificationState: 'unassessed',
      benefitIds: ['sibling-inventory-benefit'],
      rewardDistributionTypes: ['BADGE'],
    }));
    originalFetch = installFetchMock([
      async () => ({
        data: {
          currentUser: {
            inventory: {
              dropCampaignsInProgress: cachedDrops.map((drop) => ({
                id: drop.campaignId,
                timeBasedDrops: [
                  {
                    id: drop.id,
                    requiredMinutesWatched: 60,
                    self: {
                      currentMinutesWatched: 58,
                      isClaimed: false,
                      isClaimable: false,
                    },
                  },
                ],
              })),
              gameEventDrops: [
                {
                  id: 'sibling-inventory-benefit',
                  name: 'Shared Inventory Badge',
                  lastAwardedAt: '2026-05-19T08:00:00.000Z',
                  game: { displayName: 'IRL' },
                },
              ],
            },
          },
        },
      }),
    ]);

    // When: post-inventory early-award normalization runs across both cached drops.
    const result = await fetchInventorySnapshotFromApi(createMinimalState(), createSession(), cachedDrops);

    // Then: the reused benefit cannot claim, complete, or verify either sibling.
    expect({
      drops: result?.drops.length,
      claimed: result?.drops.filter((drop) => drop.claimed).length,
      completed: result?.drops.filter((drop) => drop.progress === 100).length,
      verified: result?.drops.filter((drop) => drop.verificationState === 'verified').length,
    }).toEqual({ drops: 2, claimed: 0, completed: 0, verified: 0 });
  });
});
