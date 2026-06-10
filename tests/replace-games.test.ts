import { describe, expect, test } from 'bun:test';
import { replaceAvailableGames, applyGameDisplayNames } from '../src/shared/game-selection.ts';
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

describe('applyGameDisplayNames', () => {
  test('RED: two campaigns for same game, one with empty campaignName should use "Unknown campaign" fallback', () => {
    // Bug: When one campaign has empty campaignName, current code produces "Game · Campaign 1"
    // Expected: "Gray Zone Warfare · Unknown campaign"
    const games = [
      createGame({
        name: 'Gray Zone Warfare',
        campaignId: 'campaign-1',
        campaignName: '',
      }),
      createGame({
        name: 'Gray Zone Warfare',
        campaignId: 'campaign-2',
        campaignName: 'Season 1',
      }),
    ];

    const result = applyGameDisplayNames(games);

    expect(result).toHaveLength(2);
    const first = result.find((g) => g.campaignId === 'campaign-1');
    const second = result.find((g) => g.campaignId === 'campaign-2');

    expect(first?.displayName).toBe('Gray Zone Warfare · Unknown campaign');
    expect(second?.displayName).toBe('Gray Zone Warfare · Season 1');
  });

  test('RED: two campaigns for same game with proper names should generate campaign-specific labels', () => {
    // Currently may fail if campaign name logic has issues
    // Expected: distinct labels with campaign names
    const games = [
      createGame({
        name: 'Valorant',
        campaignId: 'valorant-ep1',
        campaignName: 'Episode 1',
      }),
      createGame({
        name: 'Valorant',
        campaignId: 'valorant-ep2',
        campaignName: 'Episode 2',
      }),
    ];

    const result = applyGameDisplayNames(games);

    expect(result).toHaveLength(2);
    const ep1 = result.find((g) => g.campaignId === 'valorant-ep1');
    const ep2 = result.find((g) => g.campaignId === 'valorant-ep2');

    expect(ep1?.displayName).toBe('Valorant · Episode 1');
    expect(ep2?.displayName).toBe('Valorant · Episode 2');
  });

  test('RED: replaceAvailableGames should not override computed labels with plain game names', () => {
    // Bug: replaceAvailableGames at line 227-229 applies applyGameDisplayNames,
    // then overwrites with stale displayName from incoming if it's non-empty.
    // If incoming has displayName: "Overwatch" (plain game name), it should not override
    // the freshly computed "Overwatch · Campaign 1" label.
    const incoming = [
      createGame({
        id: 'ow-c1',
        name: 'Overwatch',
        campaignId: 'ow-camp-1',
        campaignName: 'Season 10',
        displayName: 'Overwatch',
      }),
      createGame({
        id: 'ow-c2',
        name: 'Overwatch',
        campaignId: 'ow-camp-2',
        campaignName: 'Season 11',
        displayName: 'Overwatch',
      }),
    ];

    const result = replaceAvailableGames(incoming);

    expect(result).toHaveLength(2);
    const s10 = result.find((g) => g.campaignId === 'ow-camp-1');
    const s11 = result.find((g) => g.campaignId === 'ow-camp-2');

    // The computed labels should include campaign names, not be overwritten with plain name
    expect(s10?.displayName).toBe('Overwatch · Season 10');
    expect(s11?.displayName).toBe('Overwatch · Season 11');
  });

  test('single campaign game keeps its real campaign title in the display label', () => {
    const games = [
      createGame({
        name: 'Fortnite',
        campaignId: 'fortnite-main',
        campaignName: 'Chapter 1',
      }),
    ];

    const result = applyGameDisplayNames(games);

    expect(result).toHaveLength(1);
    expect(result[0].displayName).toBe('Fortnite · Chapter 1');
  });

  test('single titled Overwatch campaign uses Twitch campaign title', () => {
    const result = replaceAvailableGames([
      createGame({
        id: 'owwc-owcs-s2-campaign-2',
        name: 'Overwatch',
        campaignId: 'owwc-owcs-s2-campaign-2',
        campaignName: 'OWWC + OWCS S2 Campaign 2',
        displayName: 'Overwatch',
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].displayName).toBe('Overwatch · OWWC + OWCS S2 Campaign 2');
  });

  test('single titled GOALS campaign uses Twitch campaign title', () => {
    const result = replaceAvailableGames([
      createGame({
        id: 'goals-june-9',
        name: 'GOALS',
        campaignId: 'goals-june-9',
        campaignName: 'GOALS - 9th of June',
        displayName: 'GOALS',
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].displayName).toBe('GOALS · GOALS - 9th of June');
  });
});
