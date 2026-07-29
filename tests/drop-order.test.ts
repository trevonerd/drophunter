import { expect, test } from 'bun:test';
import {
  buildClaimedRewardLookup,
  buildGlobalClaimedRewardEntry,
  buildInventoryDropMaps,
  parseCampaignDrops,
} from '../src/background/twitch-api/client.ts';
import { pickNearestDrop, sortPendingDrops } from '../src/shared/drop-order.js';
import type { TwitchDrop, TwitchGame } from '../src/types/index.ts';

function createDrop(overrides: Partial<TwitchDrop> = {}): TwitchDrop {
  return {
    id: 'drop-1',
    name: 'Reward',
    gameId: 'game-1',
    gameName: 'Game',
    imageUrl: '',
    progress: 0,
    currentMinutes: 0,
    claimed: false,
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
    ...overrides,
  };
}

test('sortPendingDrops prioritizes lower ETA first', () => {
  const drops = [
    createDrop({ name: 'B', remainingMinutes: 45, expiresInMs: 1000 }),
    createDrop({ name: 'A', remainingMinutes: 10, expiresInMs: 1000 }),
    createDrop({ name: 'C', remainingMinutes: 80, expiresInMs: 1000 }),
  ];

  const ordered = sortPendingDrops(drops);
  expect(ordered[0].name).toBe('A');
  expect(ordered[1].name).toBe('B');
  expect(ordered[2].name).toBe('C');
});

test('sortPendingDrops uses nearest expiry when ETA ties', () => {
  const drops = [
    createDrop({ name: 'Late', remainingMinutes: 10, expiresInMs: 60_000 }),
    createDrop({ name: 'Soon', remainingMinutes: 10, expiresInMs: 30_000 }),
  ];

  const ordered = sortPendingDrops(drops);
  expect(ordered[0].name).toBe('Soon');
  expect(ordered[1].name).toBe('Late');
});

test('sortPendingDrops prefers higher progress if ETA and expiry tie', () => {
  const drops = [
    createDrop({ name: 'Low', remainingMinutes: 10, expiresInMs: 30_000, progress: 20 }),
    createDrop({ name: 'High', remainingMinutes: 10, expiresInMs: 30_000, progress: 70 }),
  ];

  const ordered = sortPendingDrops(drops);
  expect(ordered[0].name).toBe('High');
  expect(ordered[1].name).toBe('Low');
});

test('pickNearestDrop returns null for empty collections', () => {
  expect(pickNearestDrop([])).toBe(null);
});

test('sortPendingDrops puts non-automatable rewards after automatable rewards', () => {
  const drops = [
    createDrop({ name: 'SubscriptionDrop', acquisitionMethod: 'subscription', remainingMinutes: 1 }),
    createDrop({ name: 'TimeDrop1', remainingMinutes: 60, expiresInMs: 100_000 }),
    createDrop({ name: 'TimeDrop2', remainingMinutes: 30, expiresInMs: 100_000 }),
  ];

  const ordered = sortPendingDrops(drops);
  expect(ordered[0].name).toBe('TimeDrop2');
  expect(ordered[1].name).toBe('TimeDrop1');
  expect(ordered[2].name).toBe('SubscriptionDrop');
});

test('pickNearestDrop keeps an unknown reward on the normal farming path', () => {
  const drops = [
    createDrop({ name: 'UnknownDrop', acquisitionMethod: 'unknown', remainingMinutes: null }),
    createDrop({ name: 'TimeDrop', remainingMinutes: 30, expiresInMs: 100_000 }),
  ];

  const nearest = pickNearestDrop(drops);
  expect(nearest).not.toBeNull();
  expect(nearest!.name).toBe('TimeDrop');
});

test('pickNearestDrop keeps a fresh Twitch-native reward on the normal farming path', () => {
  const drops = [
    createDrop({
      name: 'Fresh Twitch badge',
      rewardKind: 'twitch-badge',
      verificationState: 'unassessed',
      remainingMinutes: 15,
    }),
  ];

  expect(pickNearestDrop(drops)?.name).toBe('Fresh Twitch badge');
});

test('sortPendingDrops sorts null remainingMinutes after finite ETA', () => {
  const drops = [
    createDrop({ name: 'NullETA', remainingMinutes: null, expiresInMs: 100_000 }),
    createDrop({ name: 'FiniteETA', remainingMinutes: 30, expiresInMs: 100_000 }),
  ];

  const ordered = sortPendingDrops(drops);
  expect(ordered[0].name).toBe('FiniteETA');
  expect(ordered[1].name).toBe('NullETA');
});

test('pickNearestDrop keeps unknown and fresh Twitch-native rewards ahead of excluded rewards', () => {
  const drops = [
    createDrop({
      id: 'subscription',
      name: 'Subscription',
      acquisitionMethod: 'subscription',
      remainingMinutes: 1,
    }),
    createDrop({
      id: 'unverifiable',
      name: 'Unverifiable Twitch',
      rewardKind: 'twitch-badge',
      verificationState: 'unverifiable',
      remainingMinutes: 2,
    }),
    createDrop({
      id: 'unknown',
      name: 'Unknown reward',
      acquisitionMethod: 'unknown',
      rewardKind: 'unknown',
      remainingMinutes: 10,
    }),
    createDrop({
      id: 'fresh-native',
      name: 'Fresh Twitch emote',
      rewardKind: 'twitch-emote',
      verificationState: 'unassessed',
      remainingMinutes: 20,
    }),
  ];

  const nearest = pickNearestDrop(drops);

  expect(nearest?.id).toBe('unknown');
});

test('pickNearestDrop returns null when every reward is non-automatable', () => {
  const drops = [
    createDrop({
      acquisitionMethod: 'subscription',
      remainingMinutes: 1,
    }),
    createDrop({
      rewardKind: 'twitch-emote',
      verificationState: 'unverifiable',
      remainingMinutes: 2,
    }),
  ];

  expect(pickNearestDrop(drops)).toBe(null);
});

test('pickNearestDrop ignores a parsed zero-minute subscription ahead of a watch reward', () => {
  const campaign = {
    id: 'campaign-parser-ordering',
    timeBasedDrops: [
      {
        id: 'subscription-zero',
        name: 'Subscriber Reward',
        requiredMinutesWatched: 0,
        benefitEdges: [
          {
            benefit: {
              id: 'subscription-benefit',
              name: 'Subscriber Reward',
              distributionType: 'DIRECT_ENTITLEMENT',
            },
          },
        ],
      },
      {
        id: 'watch-reward',
        name: 'Watch Reward',
        requiredMinutesWatched: 60,
        benefitEdges: [
          {
            benefit: {
              id: 'watch-benefit',
              name: 'Watch Reward',
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
  };
  const game: TwitchGame = {
    id: 'game-parser-ordering',
    name: 'Parser Ordering Game',
    imageUrl: '',
    campaignId: campaign.id,
  };

  const parsedDrops = parseCampaignDrops(
    campaign,
    game,
    buildInventoryDropMaps(null),
    buildClaimedRewardLookup(null),
    buildGlobalClaimedRewardEntry(null),
  );

  expect(parsedDrops.map((drop) => drop.id)).toEqual(['subscription-zero', 'watch-reward']);
  expect(pickNearestDrop(parsedDrops)?.id).toBe('watch-reward');
});
