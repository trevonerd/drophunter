import { describe, expect, test } from 'bun:test';
import {
  createFarmingAutomationTwitchAdapter,
  FarmingAutomationCampaignRefreshError,
  FarmingAutomationDirectoryRefreshError,
  type FarmingAutomationDirectoryResponse,
  FarmingAutomationInventoryRefreshError,
  type FarmingAutomationTwitchSource,
} from '../src/background/farming-automation-twitch.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import type {
  DropsSnapshot,
  TwitchDrop,
  TwitchGame,
  TwitchSession,
  TwitchStreamer,
} from '../src/types/index.ts';

const session: TwitchSession = {
  oauthToken: 'oauth-token',
  userId: '123',
  deviceId: 'device-id',
  uuid: 'uuid',
};

function game(campaignId: string, gameId = 'shared-game'): TwitchGame {
  return {
    id: gameId,
    name: 'Shared Game',
    campaignId,
    campaignName: campaignId,
    categorySlug: 'shared-game',
    imageUrl: '',
    dropCount: 1,
    endsAt: '2030-08-03T14:00:00.000Z',
  };
}

function drop(campaignId: string, progress: number, id = 'reward-1'): TwitchDrop {
  return {
    id,
    name: 'Reward',
    gameId: 'shared-game',
    gameName: 'Shared Game',
    imageUrl: '',
    progress,
    currentMinutes: progress,
    claimed: false,
    campaignId,
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
  };
}

function source(overrides: Partial<FarmingAutomationTwitchSource> = {}): FarmingAutomationTwitchSource {
  return {
    loadSession: async () => session,
    fetchCampaignSnapshot: async () => ({ games: [], drops: [], updatedAt: 10 }),
    fetchDirectoryStreamers: async () => ({ streamers: [], languageFilterApplied: false }),
    ...overrides,
  };
}

function directoryResponse(streamers: readonly TwitchStreamer[]): FarmingAutomationDirectoryResponse {
  return { streamers, languageFilterApplied: true };
}

describe('farming automation Twitch adapter', () => {
  test('normalizes duplicate benefits without merging campaigns', async () => {
    const first = {
      ...game('campaign-a'),
      allowedChannels: ['z-channel', 'a-channel'],
      rewardSummary: { completion: 'farmable' as const, remainderReasons: [] as const },
    };
    const second = game('campaign-b');
    const campaignSnapshot: DropsSnapshot = {
      games: [first, { ...first, displayName: 'Shared Game · A' }, second],
      drops: [drop('campaign-a', 10), drop('campaign-a', 60), drop('campaign-b', 20)],
      campaignChannelsMap: { 'campaign-a': ['channel-a'], 'campaign-b': ['channel-b'] },
      updatedAt: 10,
    };
    const adapter = createFarmingAutomationTwitchAdapter(
      source({ fetchCampaignSnapshot: async () => campaignSnapshot }),
    );

    const result = await adapter.refresh();

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    expect(result.snapshot.games.map((entry) => gameKey(entry))).toEqual([gameKey(first), gameKey(second)]);
    expect(result.snapshot.campaignDropsByKey[gameKey(first)]?.[0]?.progress).toBe(60);
    expect(result.snapshot.campaignDropsByKey[gameKey(second)]?.[0]?.progress).toBe(20);
    expect(result.snapshot.campaignDropsByKey[gameKey(first)]).not.toBe(
      result.snapshot.campaignDropsByKey[gameKey(second)],
    );
    expect(Object.isFrozen(result.snapshot)).toBe(true);
    expect(Object.isFrozen(result.snapshot.games)).toBe(true);
    expect(result.snapshot.games[0]?.allowedChannels).toEqual(['a-channel', 'z-channel']);
    expect(Object.isFrozen(result.snapshot.games[0]?.allowedChannels ?? [])).toBe(true);
    expect(Object.isFrozen(result.snapshot.games[0]?.rewardSummary ?? {})).toBe(true);
    expect(Object.isFrozen(result.snapshot.games[0]?.rewardSummary?.remainderReasons ?? [])).toBe(true);
  });

  test('returns a typed absence when Twitch session is missing', async () => {
    let campaignCalls = 0;
    const adapter = createFarmingAutomationTwitchAdapter(
      source({
        loadSession: async () => null,
        fetchCampaignSnapshot: async () => {
          campaignCalls += 1;
          return { games: [], drops: [], updatedAt: 10 };
        },
      }),
    );

    const result = await adapter.refresh();

    expect(result).toEqual({ kind: 'session-missing' });
    expect(campaignCalls).toBe(0);
  });

  test('keeps campaign and inventory failures distinguishable', async () => {
    const campaignAdapter = createFarmingAutomationTwitchAdapter(
      source({ fetchCampaignSnapshot: async () => Promise.reject(new Error('campaign failed')) }),
    );
    const inventoryAdapter = createFarmingAutomationTwitchAdapter(
      source({
        fetchCampaignSnapshot: async () => ({ games: [], drops: [drop('campaign-a', 1)], updatedAt: 10 }),
        fetchInventorySnapshot: async () => Promise.reject(new Error('inventory failed')),
      }),
    );

    await expect(campaignAdapter.refresh()).rejects.toBeInstanceOf(FarmingAutomationCampaignRefreshError);
    await expect(inventoryAdapter.refresh()).rejects.toBeInstanceOf(FarmingAutomationInventoryRefreshError);
  });

  test('returns refresh failure without projecting or mutating live state', async () => {
    const liveProjection = {
      selectedGame: game('incumbent'),
      isRunning: true,
      queue: [game('queued')],
      activeStreamer: { id: 'streamer', name: 'streamer', displayName: 'Streamer', isLive: true },
    };
    const before = structuredClone(liveProjection);
    const adapter = createFarmingAutomationTwitchAdapter(
      source({ fetchCampaignSnapshot: async () => Promise.reject(new Error('offline')) }),
    );

    await expect(adapter.refresh()).rejects.toBeInstanceOf(FarmingAutomationCampaignRefreshError);

    expect(liveProjection).toEqual(before);
  });

  test('retains target campaign and category on directory results', async () => {
    const target = game('campaign-a');
    const streamer: TwitchStreamer = {
      id: 'channel-a',
      name: 'channel-a',
      displayName: 'Channel A',
      isLive: true,
    };
    const adapter = createFarmingAutomationTwitchAdapter(
      source({ fetchDirectoryStreamers: async () => directoryResponse([streamer]) }),
    );

    const result = await adapter.fetchDirectory(target, 'it');

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    expect(result.target).toEqual({
      campaignKey: gameKey(target),
      campaignId: 'campaign-a',
      gameId: 'shared-game',
      gameName: 'Shared Game',
      categoryId: null,
      categorySlug: 'shared-game',
    });
    expect(result.streamers).toEqual([streamer]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.target)).toBe(true);
  });

  test('safe refresh patch excludes session and farming-session identity', async () => {
    const target = game('campaign-a');
    const snapshot: DropsSnapshot = {
      games: [target],
      drops: [drop('campaign-a', 20)],
      updatedAt: 10,
    };
    const adapter = createFarmingAutomationTwitchAdapter(
      source({ fetchCampaignSnapshot: async () => snapshot }),
    );

    const result = await adapter.refresh();

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    const forbidden = [
      'selectedGame',
      'isRunning',
      'isPaused',
      'queue',
      'activeStreamer',
      'tabId',
      'watchTransportMode',
      'watchHealth',
      'monitorWindowId',
      'currentDrop',
      'pendingDrops',
      'completedDrops',
      'lastHeartbeatAt',
      'recoveryBackoffUntil',
    ];
    expect(Object.keys(result.refreshPatch).some((key) => forbidden.includes(key))).toBe(false);
    expect(result.refreshPatch.availableGames[0]).toMatchObject({
      id: target.id,
      campaignId: target.campaignId,
      name: target.name,
    });
    expect(result.refreshPatch.allDrops[0]?.campaignId).toBe('campaign-a');
  });

  test('keeps directory failures distinguishable', async () => {
    const adapter = createFarmingAutomationTwitchAdapter(
      source({
        fetchDirectoryStreamers: async () => Promise.reject(new Error('directory failed')),
      }),
    );

    await expect(adapter.fetchDirectory(game('campaign-a'))).rejects.toBeInstanceOf(
      FarmingAutomationDirectoryRefreshError,
    );
  });
});
