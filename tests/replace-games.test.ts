import { describe, expect, test } from 'bun:test';
import { replaceAvailableGames } from '../src/shared/game-selection.ts';
import type { TwitchGame } from '../src/types/index.ts';

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

describe('replaceAvailableGames', () => {
  test('removes games not in incoming list', () => {
    const current = [
      createGame({ id: 'game-a', name: 'GameA' }),
      createGame({ id: 'game-b', name: 'GameB' }),
    ];
    const incoming = [
      createGame({ id: 'game-b', name: 'GameB' }),
    ];

    const result = replaceAvailableGames(incoming);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('game-b');
    expect(result.find((g) => g.id === 'game-a')).toBeUndefined();
  });

  test('filters expired games from incoming list', () => {
    const expiredTime = new Date(Date.now() - 3600000).toISOString();
    const incoming = [
      createGame({ id: 'game-a', name: 'GameA', endsAt: expiredTime, expiresInMs: 0, expiryStatus: 'expired' }),
      createGame({ id: 'game-b', name: 'GameB' }),
    ];

    const result = replaceAvailableGames(incoming);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('game-b');
    expect(result.find((g) => g.id === 'game-a')).toBeUndefined();
  });

  test('returns empty array when incoming is empty', () => {
    const current = [
      createGame({ id: 'game-a', name: 'GameA' }),
      createGame({ id: 'game-b', name: 'GameB' }),
    ];

    const result = replaceAvailableGames([]);

    expect(result).toHaveLength(0);
  });

  test('sorts games alphabetically by name', () => {
    const incoming = [
      createGame({ id: 'game-c', name: 'GameC' }),
      createGame({ id: 'game-a', name: 'GameA' }),
      createGame({ id: 'game-b', name: 'GameB' }),
    ];

    const result = replaceAvailableGames(incoming);

    expect(result).toHaveLength(3);
    expect(result[0].name).toBe('GameA');
    expect(result[1].name).toBe('GameB');
    expect(result[2].name).toBe('GameC');
  });

  test('applies display names override', () => {
    const incoming = [
      createGame({ id: 'game-a', name: 'GameA', displayName: 'Awesome Game A' }),
    ];

    const result = replaceAvailableGames(incoming);

    expect(result).toHaveLength(1);
    expect(result[0].displayName).toBe('Awesome Game A');
  });

  test('replaces all old games when API returns fresh list', () => {
    const current = [
      createGame({ id: 'old-game-1', name: 'OldGame1' }),
      createGame({ id: 'old-game-2', name: 'OldGame2' }),
    ];
    const incoming = [
      createGame({ id: 'new-game-1', name: 'NewGame1' }),
      createGame({ id: 'new-game-2', name: 'NewGame2' }),
    ];

     const result = replaceAvailableGames(incoming);

     expect(result).toHaveLength(2);
     expect(result.find((g) => g.id === 'old-game-1')).toBeUndefined();
     expect(result.find((g) => g.id === 'old-game-2')).toBeUndefined();
     expect(result.find((g) => g.id === 'new-game-1')).toBeDefined();
     expect(result.find((g) => g.id === 'new-game-2')).toBeDefined();
  });
});
