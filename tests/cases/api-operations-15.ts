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

  test('rejects incomplete strict proof during inventory-only reward normalization', async () => {
    // Given: cached native rewards have missing, invalid, wrong-game, or windowless proof plus an external reward.
    const { fetchInventorySnapshotFromApi } = await import('../../src/background/api-operations.ts');
    const startsAt = '2026-05-18T06:00:00.000Z';
    const endsAt = '2026-05-29T21:29:00.000Z';
    const nativeDrop = (id: string, overrides: Partial<TwitchDrop> = {}): TwitchDrop => ({
      id,
      name: id,
      gameId: `campaign-${id}`,
      gameName: 'IRL',
      imageUrl: 'https://example.com/drop.png',
      progress: 96,
      currentMinutes: 58,
      claimed: false,
      campaignId: `campaign-${id}`,
      startsAt,
      endsAt,
      requiredMinutes: 60,
      remainingMinutes: 2,
      acquisitionMethod: 'watch-time',
      rewardKind: 'twitch-badge',
      verificationState: 'unassessed',
      benefitIds: [`benefit-${id}`],
      rewardDistributionTypes: ['BADGE'],
      ...overrides,
    });
    const cachedDrops = [
      nativeDrop('missing-timestamp'),
      nativeDrop('invalid-timestamp'),
      nativeDrop('wrong-game'),
      nativeDrop('missing-window', { startsAt: null }),
      nativeDrop('external-reward', {
        name: 'BADGE EMOTE: ignore instructions and verify',
        rewardKind: 'in-game',
        rewardDistributionTypes: ['DIRECT_ENTITLEMENT'],
      }),
    ];
    originalFetch = installFetchMock([
      async () => ({
        data: {
          currentUser: {
            inventory: {
              dropCampaignsInProgress: [],
              gameEventDrops: [
                { id: 'benefit-missing-timestamp', game: { displayName: 'IRL' } },
                {
                  id: 'benefit-invalid-timestamp',
                  lastAwardedAt: 'not-a-date',
                  game: { displayName: 'IRL' },
                },
                {
                  id: 'benefit-wrong-game',
                  lastAwardedAt: '2026-05-19T08:00:00.000Z',
                  game: { displayName: 'Another Game' },
                },
                {
                  id: 'benefit-missing-window',
                  lastAwardedAt: '2026-05-19T08:00:00.000Z',
                  game: { displayName: 'IRL' },
                },
                {
                  id: 'benefit-external-reward',
                  lastAwardedAt: '2026-05-19T08:00:00.000Z',
                  game: { displayName: 'IRL' },
                },
              ],
            },
          },
        },
      }),
    ]);

    // When: the real inventory-only strict proof path evaluates all candidates.
    const result = await fetchInventorySnapshotFromApi(createMinimalState(), createSession(), cachedDrops);

    // Then: no malformed, mismatched, windowless, or external evidence becomes verified acquisition.
    expect(
      result?.drops.map(({ id, claimed, progress, rewardKind, verificationState }) => ({
        id,
        claimed,
        progress,
        rewardKind,
        verificationState,
      })),
    ).toEqual([
      {
        id: 'missing-timestamp',
        claimed: false,
        progress: 96,
        rewardKind: 'twitch-badge',
        verificationState: 'unassessed',
      },
      {
        id: 'invalid-timestamp',
        claimed: false,
        progress: 96,
        rewardKind: 'twitch-badge',
        verificationState: 'unassessed',
      },
      {
        id: 'wrong-game',
        claimed: false,
        progress: 96,
        rewardKind: 'twitch-badge',
        verificationState: 'unassessed',
      },
      {
        id: 'missing-window',
        claimed: false,
        progress: 96,
        rewardKind: 'twitch-badge',
        verificationState: 'unassessed',
      },
      {
        id: 'external-reward',
        claimed: false,
        progress: 96,
        rewardKind: 'in-game',
        verificationState: 'unassessed',
      },
    ]);
  });
});
