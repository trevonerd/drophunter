import { expect, test } from 'bun:test';
import { discoverFarmingAutomationCandidates } from '../src/background/farming-automation-discovery.ts';
import type {
  FarmingAutomationTwitchAdapter,
  FarmingAutomationTwitchSnapshot,
} from '../src/background/farming-automation-twitch.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import type { CampaignCompletion, TwitchGame } from '../src/types/index.ts';

function campaign(campaignId: string, completion: CampaignCompletion): TwitchGame {
  return {
    id: 'marvel-rivals',
    name: 'Marvel Rivals',
    imageUrl: '',
    campaignId,
    campaignName: campaignId,
    endsAt: '2030-08-20T00:00:00.000Z',
    rewardSummary: { completion, remainderReasons: [] },
  };
}

test('directory discovery requests only classified farmable campaigns', async () => {
  // Given: a complete refreshed snapshot containing farmable, terminal, and unclassified campaigns.
  const farmable = campaign('season-9-5', 'farmable');
  const acquired = campaign('ignite-day-1', 'all-acquired');
  const subscription = {
    ...campaign('subscription-token', 'farming-complete'),
    rewardSummary: {
      completion: 'farming-complete' as const,
      remainderReasons: ['subscription-required' as const],
    },
  };
  const loading: TwitchGame = {
    id: 'marvel-rivals',
    name: 'Marvel Rivals',
    imageUrl: '',
    campaignId: 'campaign-loading',
    campaignName: 'Campaign loading',
    endsAt: '2030-08-20T00:00:00.000Z',
  };
  const snapshot: FarmingAutomationTwitchSnapshot = {
    games: [acquired, subscription, loading, farmable],
    drops: [],
    campaignDropsByKey: {},
    campaignChannelsMap: {},
    updatedAt: 1_000,
  };
  const requestedCampaigns: string[] = [];
  const twitch: FarmingAutomationTwitchAdapter = {
    refresh: async () => ({
      kind: 'ready',
      snapshot,
      refreshPatch: {
        availableGames: snapshot.games,
        allDrops: snapshot.drops,
        campaignDropsByKey: snapshot.campaignDropsByKey,
        campaignChannelsMap: snapshot.campaignChannelsMap,
      },
    }),
    fetchDirectory: async (game) => {
      requestedCampaigns.push(game.campaignId ?? 'missing');
      return {
        kind: 'ready',
        target: {
          campaignKey: gameKey(game),
          campaignId: game.campaignId ?? null,
          gameId: game.id,
          gameName: game.name,
          categoryId: null,
          categorySlug: 'marvel-rivals',
        },
        streamers: [{ id: 'streamer', name: 'streamer', displayName: 'Streamer', isLive: true }],
        languageFilterApplied: false,
      };
    },
  };

  // When: the public discovery operation evaluates streamer availability.
  const result = await discoverFarmingAutomationCandidates(twitch, '', 2_000);

  // Then: terminal and incomplete campaigns remain visible but cause no directory request.
  expect(result.kind).toBe('ready');
  if (result.kind !== 'ready') return;
  expect({
    requestedCampaigns,
    snapshotCampaigns: result.snapshot.games.map((game) => game.campaignId),
    directoryKeys: [...result.directories.keys()],
    availabilityKeys: Object.keys(result.availability),
  }).toEqual({
    requestedCampaigns: ['season-9-5'],
    snapshotCampaigns: ['ignite-day-1', 'subscription-token', 'campaign-loading', 'season-9-5'],
    directoryKeys: [gameKey(farmable)],
    availabilityKeys: [gameKey(farmable)],
  });
});
