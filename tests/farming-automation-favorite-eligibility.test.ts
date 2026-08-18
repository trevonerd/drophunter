import { expect, test } from 'bun:test';
import {
  createFarmingAutomationTwitchAdapter,
  type FarmingAutomationTwitchSource,
} from '../src/background/farming-automation-twitch.ts';
import type { DropsSnapshot, TwitchDrop, TwitchGame, TwitchSession } from '../src/types/index.ts';

const session: TwitchSession = {
  oauthToken: 'oauth-token',
  userId: 'viewer',
  deviceId: 'device',
  uuid: 'uuid',
};

function campaign(campaignId: string): TwitchGame {
  return {
    id: 'marvel-rivals',
    name: 'Marvel Rivals',
    imageUrl: '',
    categoryId: 'marvel-rivals',
    campaignId,
    campaignName: campaignId,
    dropCount: 1,
    endsAt: '2030-08-20T00:00:00.000Z',
  };
}

interface RewardInput {
  readonly campaignId: string;
  readonly rewardId?: string;
  readonly claimed?: boolean;
  readonly acquisitionMethod?: TwitchDrop['acquisitionMethod'];
}

function reward({
  campaignId,
  rewardId = `reward-${campaignId}`,
  claimed = false,
  acquisitionMethod = 'watch-time',
}: RewardInput): TwitchDrop {
  return {
    id: rewardId,
    name: campaignId,
    gameId: 'marvel-rivals',
    gameName: 'Marvel Rivals',
    imageUrl: '',
    progress: claimed ? 100 : 0,
    currentMinutes: claimed ? 60 : 0,
    claimed,
    campaignId,
    acquisitionMethod,
    rewardKind: 'in-game',
    verificationState: claimed ? 'verified' : 'unassessed',
  };
}

function source(
  campaignSnapshot: DropsSnapshot,
  inventorySnapshot: DropsSnapshot,
): FarmingAutomationTwitchSource {
  return {
    loadSession: async () => session,
    fetchCampaignSnapshot: async () => campaignSnapshot,
    fetchInventorySnapshot: async () => inventorySnapshot,
    fetchDirectoryStreamers: async () => ({ streamers: [], languageFilterApplied: false }),
  };
}

test('classifies a complete favorite catalog before publishing the automation snapshot', async () => {
  // Given: campaign data plus inventory evidence for an acquired, subscription-only, and pending campaign.
  const acquired = campaign('ignite-day-1');
  const subscription = campaign('subscription-token');
  const farmable = campaign('season-9-5');
  const campaignSnapshot: DropsSnapshot = {
    games: [acquired, subscription, farmable],
    drops: [
      reward({ campaignId: 'ignite-day-1' }),
      reward({ campaignId: 'subscription-token', acquisitionMethod: 'subscription' }),
      reward({ campaignId: 'season-9-5' }),
    ],
    updatedAt: 10,
  };
  const inventorySnapshot: DropsSnapshot = {
    games: [acquired],
    drops: [reward({ campaignId: 'ignite-day-1', claimed: true })],
    updatedAt: 20,
  };
  const adapter = createFarmingAutomationTwitchAdapter(source(campaignSnapshot, inventorySnapshot));

  // When: the public adapter completes the awaited campaign and inventory refresh.
  const result = await adapter.refresh();

  // Then: every complete campaign has the authoritative automation classification.
  expect(result.kind).toBe('ready');
  if (result.kind !== 'ready') return;
  expect(
    Object.fromEntries(result.snapshot.games.map((game) => [game.campaignId, game.rewardSummary])),
  ).toEqual({
    'ignite-day-1': { completion: 'all-acquired', remainderReasons: [] },
    'season-9-5': { completion: 'farmable', remainderReasons: [] },
    'subscription-token': {
      completion: 'farming-complete',
      remainderReasons: ['subscription-required'],
    },
  });
});

test('keeps a mixed watch-time and subscription campaign farmable', async () => {
  // Given: a complete campaign with one pending watch reward and one subscription reward.
  const mixed = { ...campaign('mixed-campaign'), dropCount: 2 };
  const campaignSnapshot: DropsSnapshot = {
    games: [mixed],
    drops: [
      reward({ campaignId: 'mixed-campaign', rewardId: 'watch-reward' }),
      reward({
        campaignId: 'mixed-campaign',
        rewardId: 'subscription-reward',
        acquisitionMethod: 'subscription',
      }),
    ],
    updatedAt: 10,
  };
  const adapter = createFarmingAutomationTwitchAdapter(
    source(campaignSnapshot, { games: [], drops: [], updatedAt: 10 }),
  );

  // When: the adapter classifies the complete reward catalog.
  const result = await adapter.refresh();

  // Then: the pending watch-time reward keeps the campaign eligible for automation.
  expect(result.kind).toBe('ready');
  if (result.kind !== 'ready') return;
  expect(result.snapshot.games[0]?.rewardSummary).toEqual({
    completion: 'farmable',
    remainderReasons: [],
  });
});

test('leaves an incomplete reward catalog unclassified', async () => {
  // Given: Twitch declares two campaign rewards but only one identified reward has loaded.
  const incomplete = { ...campaign('incomplete-campaign'), dropCount: 2 };
  const campaignSnapshot: DropsSnapshot = {
    games: [incomplete],
    drops: [reward({ campaignId: 'incomplete-campaign' })],
    updatedAt: 10,
  };
  const adapter = createFarmingAutomationTwitchAdapter(
    source(campaignSnapshot, { games: [], drops: [], updatedAt: 10 }),
  );

  // When: the adapter publishes the partial snapshot.
  const result = await adapter.refresh();

  // Then: it waits for the missing reward instead of inventing a completion state.
  expect(result.kind).toBe('ready');
  if (result.kind !== 'ready') return;
  expect(result.snapshot.games[0]?.rewardSummary).toBeUndefined();
});
