import { describe, expect, test } from 'bun:test';
import {
  applyGameDisplayNames,
  dedupeGamesByIdentity,
  dropMatchesGame,
  findMatchingGame,
  getGameDisplayLabel,
  isSameGame,
} from '../src/shared/game-selection.ts';
import type { TwitchDrop, TwitchGame } from '../src/types/index.ts';

function createGame(overrides: Partial<TwitchGame> = {}): TwitchGame {
  return {
    id: 'campaign-default',
    name: 'Overwatch',
    displayName: 'Overwatch',
    campaignName: 'Default Campaign',
    imageUrl: '',
    campaignId: 'campaign-default',
    categorySlug: 'overwatch',
    endsAt: '2026-03-30T00:00:00.000Z',
    expiresInMs: 1000,
    expiryStatus: 'safe',
    dropCount: 1,
    isConnected: true,
    allDropsCompleted: false,
    allowedChannels: null,
    ...overrides,
  };
}

function createDrop(overrides: Partial<TwitchDrop> = {}): TwitchDrop {
  return {
    id: 'drop-1',
    name: 'Reward',
    gameId: 'campaign-default',
    gameName: 'Overwatch',
    imageUrl: '',
    progress: 0,
    claimed: false,
    campaignId: 'campaign-default',
    categorySlug: 'overwatch',
    ...overrides,
  };
}

describe('campaign-aware game selection', () => {
  test('keeps two Overwatch campaigns as distinct selectable games', () => {
    const games = applyGameDisplayNames([
      createGame({ id: 'campaign-1', campaignId: 'campaign-1', campaignName: 'OW S1 Midseason Drops' }),
      createGame({ id: 'campaign-2', campaignId: 'campaign-2', campaignName: 'OWCS Stage 1 Campaign 1' }),
    ]);

    expect(games).toHaveLength(2);
    expect(getGameDisplayLabel(games[0])).toContain('Overwatch');
    expect(getGameDisplayLabel(games[1])).toContain('Overwatch');
    expect(getGameDisplayLabel(games[0])).not.toBe(getGameDisplayLabel(games[1]));
  });

  test('uses campaign titles in duplicate display labels when available', () => {
    const games = applyGameDisplayNames([
      createGame({ id: 'campaign-1', campaignId: 'campaign-1', campaignName: 'OW S1 Midseason Drops' }),
      createGame({ id: 'campaign-2', campaignId: 'campaign-2', campaignName: 'OWCS Stage 1 Campaign 1' }),
    ]);

    expect(getGameDisplayLabel(games[0])).toBe('Overwatch · OW S1 Midseason Drops');
    expect(getGameDisplayLabel(games[1])).toBe('Overwatch · OWCS Stage 1 Campaign 1');
  });

  test('falls back to deterministic campaign numbering when titles are missing', () => {
    const games = applyGameDisplayNames([
      createGame({
        id: 'campaign-b',
        campaignId: 'campaign-b',
        campaignName: '',
        endsAt: '2026-03-22T00:00:00.000Z',
      }),
      createGame({
        id: 'campaign-a',
        campaignId: 'campaign-a',
        campaignName: 'Overwatch',
        endsAt: '2026-03-20T00:00:00.000Z',
      }),
    ]);

    expect(getGameDisplayLabel(games[0])).toBe('Overwatch · Campaign 2');
    expect(getGameDisplayLabel(games[1])).toBe('Overwatch · Campaign 1');
  });

  test('dedupes only true duplicates with the same campaign identity', () => {
    const deduped = dedupeGamesByIdentity([
      createGame({ id: 'campaign-1', campaignId: 'campaign-1', dropCount: 2, allowedChannels: ['ow_esports'] }),
      createGame({ id: 'campaign-1', campaignId: 'campaign-1', dropCount: 4, imageUrl: 'https://img/1.png' }),
      createGame({ id: 'campaign-2', campaignId: 'campaign-2', dropCount: 3, allowedChannels: ['ow_esports_jp'] }),
    ]);

    expect(deduped).toHaveLength(2);
    expect(deduped.find((game) => game.campaignId === 'campaign-1')?.dropCount).toBe(4);
    expect(deduped.find((game) => game.campaignId === 'campaign-2')?.allowedChannels).toEqual([
      'ow_esports_jp',
    ]);
  });

  test('matches drops only within the selected campaign when campaignId exists', () => {
    const selected = createGame({ id: 'campaign-1', campaignId: 'campaign-1' });
    const sameCampaignDrop = createDrop({ id: 'drop-a', campaignId: 'campaign-1' });
    const otherCampaignDrop = createDrop({ id: 'drop-b', campaignId: 'campaign-2' });

    expect(dropMatchesGame(sameCampaignDrop, selected)).toBe(true);
    expect(dropMatchesGame(otherCampaignDrop, selected)).toBe(false);
  });

  test('findMatchingGame resolves legacy non-campaign selection without collapsing campaign entries', () => {
    const source = applyGameDisplayNames([
      createGame({
        id: 'legacy-overwatch',
        campaignId: undefined,
        campaignName: undefined,
        displayName: 'Overwatch',
        endsAt: null,
      }),
      createGame({ id: 'campaign-1', campaignId: 'campaign-1', campaignName: 'OW S1 Midseason Drops' }),
    ]);

    const resolved = findMatchingGame(
      createGame({
        id: 'legacy-overwatch',
        campaignId: undefined,
        campaignName: undefined,
        displayName: 'Overwatch',
        endsAt: null,
      }),
      source,
    );

    expect(resolved?.campaignId).toBeUndefined();
  });

  test('treats same-name different campaigns as distinct queue identities', () => {
    const first = createGame({ id: 'campaign-1', campaignId: 'campaign-1' });
    const second = createGame({ id: 'campaign-2', campaignId: 'campaign-2' });

    expect(isSameGame(first, second)).toBe(false);
  });
});
