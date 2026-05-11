import { describe, expect, test } from 'bun:test';
import { getGameToStartFromQueue } from '../src/popup/queue-start.ts';
import type { TwitchGame } from '../src/types/index.ts';

function createGame(overrides: Partial<TwitchGame> = {}): TwitchGame {
  return {
    id: 'game-1',
    name: 'Game One',
    imageUrl: 'https://example.com/game.png',
    ...overrides,
  };
}

describe('getGameToStartFromQueue', () => {
  test('starts the first queued game when selected game is queued later', () => {
    const firstQueued = createGame({ id: 'game-1', campaignId: 'campaign-1' });
    const selectedGame = createGame({ id: 'game-2', campaignId: 'campaign-2' });

    const gameToStart = getGameToStartFromQueue(selectedGame, [firstQueued, selectedGame]);

    expect(gameToStart).toBe(firstQueued);
  });

  test('starts selected game first when selected game is not queued', () => {
    const selectedGame = createGame({ id: 'game-1', campaignId: 'campaign-1' });
    const queuedGame = createGame({ id: 'game-2', campaignId: 'campaign-2' });

    const gameToStart = getGameToStartFromQueue(selectedGame, [queuedGame]);

    expect(gameToStart).toBe(selectedGame);
  });

  test('starts selected game when queue is empty', () => {
    const selectedGame = createGame({ id: 'game-1', campaignId: 'campaign-1' });

    const gameToStart = getGameToStartFromQueue(selectedGame, []);

    expect(gameToStart).toBe(selectedGame);
  });

  test('starts first queued game when no game is selected', () => {
    const queuedGame = createGame({ id: 'game-1', campaignId: 'campaign-1' });

    const gameToStart = getGameToStartFromQueue(null, [queuedGame]);

    expect(gameToStart).toBe(queuedGame);
  });

  test('returns null when no game is selected and queue is empty', () => {
    const gameToStart = getGameToStartFromQueue(null, []);

    expect(gameToStart).toBeNull();
  });
});
