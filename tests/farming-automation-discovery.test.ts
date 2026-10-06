import { expect, test } from 'bun:test';
import { dropStateKey } from '../src/background/drops-projection.ts';
import { discoverFarmingAutomationCandidates } from '../src/background/farming-automation-discovery.ts';
import type {
  FarmingAutomationTwitchAdapter,
  FarmingAutomationTwitchSnapshot,
} from '../src/background/farming-automation-twitch.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import type { CampaignCompletion, TwitchGame } from '../src/types/index.ts';
import { createDrop, createStreamer } from './fixtures/queue-management.ts';
import { createDeferred, flushMicrotasks } from './support/farming-automation-fixtures.ts';

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

test('seven-campaign discovery preserves progressing SMITE while other directories are empty or unavailable', async () => {
  const games = ['smite', 'r6-season', 'r6-circuit', 'skull', 'darktide', 'valorant', 'overwatch'].map(
    (id) => ({ ...campaign(id, 'farmable'), id, name: id, categorySlug: id }),
  );
  const smite = games[0]!;
  const drop = createDrop({
    id: 'smite-drop',
    gameId: smite.id,
    campaignId: smite.campaignId,
    currentMinutes: 18,
    progress: 30,
    requiredMinutes: 60,
  });
  const state = createServiceWorkerState();
  Object.assign(state.appState, {
    isRunning: true,
    selectedGame: smite,
    activeStreamer: createStreamer({ name: 'smite-live' }),
    queue: games,
    availableGames: games,
    currentDrop: drop,
    allDrops: [drop],
    pendingDrops: [drop],
  });
  state.lastTrackedDropKey = dropStateKey(drop);
  state.lastTrackedMinutes = 18;
  state.lastTrackedProgress = 30;
  state.lastProgressAdvanceAt = Date.now() - 30_000;
  const snapshot: FarmingAutomationTwitchSnapshot = {
    games,
    drops: [drop],
    campaignDropsByKey: { [gameKey(smite)]: [drop] },
    campaignChannelsMap: {},
    updatedAt: Date.now(),
  };
  const twitch: FarmingAutomationTwitchAdapter = {
    refresh: async () => ({
      kind: 'ready',
      snapshot,
      refreshPatch: {
        availableGames: games,
        allDrops: [drop],
        campaignDropsByKey: snapshot.campaignDropsByKey,
        campaignChannelsMap: {},
      },
    }),
    fetchDirectory: async (game) => {
      if (game.id === 'valorant' || game.id === 'overwatch') throw new Error('Directory unavailable');
      return {
        kind: 'ready',
        target: {
          campaignKey: gameKey(game),
          campaignId: game.campaignId ?? null,
          gameId: game.id,
          gameName: game.name,
          categoryId: null,
          categorySlug: game.id,
        },
        streamers: [],
        languageFilterApplied: false,
      };
    },
  };
  const result = await discoverFarmingAutomationCandidates(twitch, '', Date.now(), state);
  expect(result.kind).toBe('ready');
  if (result.kind !== 'ready') return;
  expect(result.availability[gameKey(smite)]?.eligibleStreamerCount).toBe(1);
  expect(result.directories.get(gameKey(smite))?.streamers).toEqual([]);
  expect(result.availability[gameKey(games[1]!)]?.eligibleStreamerCount).toBe(0);
  expect(result.availability[gameKey(games[5]!)]).toBeUndefined();
  expect(result.directoryFailures.has(gameKey(games[5]!))).toBe(true);
  expect(state.appState.selectedGame).toBe(smite);
  expect(state.appState.activeStreamer?.name).toBe('smite-live');
  expect(state.appState.queue).toEqual(games);

  state.lastProgressAdvanceAt = Date.now() - 24 * 60 * 60_000;
  const stale = await discoverFarmingAutomationCandidates(twitch, '', Date.now(), state);
  expect(stale.kind === 'ready' && stale.availability[gameKey(smite)]?.eligibleStreamerCount).toBe(0);
});

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

test('accepts a proven refresh account when the session loader leaves the cache unchanged', async () => {
  const game = campaign('session-backed', 'farmable');
  const snapshot: FarmingAutomationTwitchSnapshot = {
    games: [game],
    drops: [],
    campaignDropsByKey: {},
    campaignChannelsMap: {},
    updatedAt: 1_000,
  };
  const state = createServiceWorkerState();
  const twitch: FarmingAutomationTwitchAdapter = {
    refresh: async () => ({
      kind: 'ready',
      snapshot,
      sessionUserId: 'viewer',
      refreshPatch: {
        availableGames: snapshot.games,
        allDrops: snapshot.drops,
        campaignDropsByKey: snapshot.campaignDropsByKey,
        campaignChannelsMap: snapshot.campaignChannelsMap,
      },
    }),
    fetchDirectory: async (candidate) => ({
      kind: 'ready',
      target: {
        campaignKey: gameKey(candidate),
        campaignId: candidate.campaignId ?? null,
        gameId: candidate.id,
        gameName: candidate.name,
        categoryId: null,
        categorySlug: 'marvel-rivals',
      },
      streamers: [{ id: 'viewer-channel', name: 'viewer-channel', displayName: 'Viewer', isLive: true }],
      languageFilterApplied: false,
    }),
  };

  const result = await discoverFarmingAutomationCandidates(twitch, '', 2_000, state);

  expect(result.kind).toBe('ready');
  expect(state.twitchSessionCache).toBeNull();
});

test('starts farmable directory lookups concurrently after the authoritative refresh', async () => {
  // Given: two classified campaigns whose directory requests are independently delayed.
  const first = campaign('first', 'farmable');
  const second = campaign('second', 'farmable');
  const snapshot: FarmingAutomationTwitchSnapshot = {
    games: [first, second],
    drops: [],
    campaignDropsByKey: {},
    campaignChannelsMap: {},
    updatedAt: 1_000,
  };
  const firstDirectory = createDeferred<void>();
  const secondDirectory = createDeferred<void>();
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
      const campaignId = game.campaignId ?? 'missing';
      requestedCampaigns.push(campaignId);
      await (campaignId === 'first' ? firstDirectory.promise : secondDirectory.promise);
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
        streamers: [{ id: campaignId, name: campaignId, displayName: campaignId, isLive: true }],
        languageFilterApplied: false,
      };
    },
  };

  // When: discovery begins after the authoritative catalog is ready.
  const pending = discoverFarmingAutomationCandidates(twitch, '', 2_000);
  await flushMicrotasks();

  // Then: a slow first directory cannot postpone issuing the second request.
  expect(requestedCampaigns).toEqual(['first', 'second']);
  firstDirectory.resolve(undefined);
  secondDirectory.resolve(undefined);
  await expect(pending).resolves.toMatchObject({ kind: 'ready' });
});

test('isolates an unrelated directory failure from a valid favorite candidate', async () => {
  // Given: two farmable campaigns whose directory requests have independent outcomes.
  const failed = campaign('failed', 'farmable');
  const valid = campaign('valid', 'farmable');
  const snapshot: FarmingAutomationTwitchSnapshot = {
    games: [failed, valid],
    drops: [],
    campaignDropsByKey: {},
    campaignChannelsMap: {},
    updatedAt: 1_000,
  };
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
      if (game.campaignId === 'failed') throw new Error('unrelated directory outage');
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
        streamers: [{ id: 'valid-streamer', name: 'valid-streamer', displayName: 'Valid', isLive: true }],
        languageFilterApplied: false,
      };
    },
  };

  // When: discovery evaluates both campaigns.
  const result = await discoverFarmingAutomationCandidates(twitch, '', 2_000);

  // Then: the valid campaign remains available for queue/start planning.
  expect(result.kind).toBe('ready');
  if (result.kind !== 'ready') return;
  expect(result.availability[gameKey(valid)]?.eligibleStreamerCount).toBe(1);
  expect(result.availability[gameKey(failed)]).toBeUndefined();
  expect(result.directoryFailures.has(gameKey(failed))).toBe(true);
});

test('rechecks parallel candidates when another campaign forces a fresh snapshot', async () => {
  const firstOld = { ...campaign('first', 'farmable'), allowedChannels: ['old-one'] };
  const secondOld = { ...campaign('second', 'farmable'), allowedChannels: ['old-two'] };
  const firstFresh = { ...firstOld, allowedChannels: ['new-one'] };
  const secondFresh = { ...secondOld, allowedChannels: ['old-two'] };
  const makeSnapshot = (games: TwitchGame[]): FarmingAutomationTwitchSnapshot => ({
    games,
    drops: [],
    campaignDropsByKey: {},
    campaignChannelsMap: {},
    updatedAt: 1_000,
  });
  const stale = makeSnapshot([firstOld, secondOld]);
  const fresh = makeSnapshot([firstFresh, secondFresh]);
  let refreshes = 0;
  const requested: Array<[string, string]> = [];
  const twitch: FarmingAutomationTwitchAdapter = {
    refresh: async (_force, options) => {
      refreshes += 1;
      const snapshot = options?.requireFreshCompleteSnapshot ? fresh : stale;
      return {
        kind: 'ready',
        snapshot,
        refreshPatch: {
          availableGames: snapshot.games,
          allDrops: snapshot.drops,
          campaignDropsByKey: snapshot.campaignDropsByKey,
          campaignChannelsMap: snapshot.campaignChannelsMap,
        },
      };
    },
    fetchDirectory: async (game) => {
      const campaignId = game.campaignId ?? 'missing';
      const allowed = game.allowedChannels?.[0] ?? '';
      requested.push([campaignId, allowed]);
      const name = campaignId === 'first' ? (allowed === 'new-one' ? 'new-one' : 'old-one') : '';
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
        streamers: name ? [{ id: name, name, displayName: name, isLive: true }] : [],
        languageFilterApplied: false,
      };
    },
    probeStreamInfo: async () => ({ kind: 'offline' }),
  };

  const result = await discoverFarmingAutomationCandidates(twitch, '', 2_000);

  expect(result.kind).toBe('ready');
  if (result.kind !== 'ready') return;
  expect(refreshes).toBe(2);
  expect(requested).toContainEqual(['first', 'new-one']);
  expect(result.directories.get(gameKey(firstFresh))?.streamers.map((streamer) => streamer.name)).toEqual([
    'new-one',
  ]);
});
