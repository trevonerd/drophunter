import { afterEach, beforeEach, mock, spyOn } from 'bun:test';
import { reconcileFarmingSessionTargets } from '../../src/background/farming-session-targets.ts';
import { gameKey } from '../../src/shared/game-selection.ts';
import { createGame, createMinimalState } from '../fixtures/queue-management.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';

export const NOW = 2_000_000;
export let chrome: ReturnType<typeof setupChromeMocks>;
beforeEach(() => {
  chrome = setupChromeMocks();
  spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => {
  chrome.teardown();
  mock.restore();
});

export function fixture() {
  const state = createMinimalState();
  const game = createGame({
    campaignId: 'one',
    dropCount: 1,
    endsAt: new Date(NOW + 3600_000).toISOString(),
  });
  Object.assign(state.appState, {
    isRunning: true,
    manualQueueAuthorized: true,
    farmingSessionOrigin: 'manual',
    selectedGame: game,
    queue: [game],
    availableGames: [game],
  });
  reconcileFarmingSessionTargets(state);
  return { state, game, key: gameKey(game) };
}
