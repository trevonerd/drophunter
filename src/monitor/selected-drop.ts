import { pickNearestDrop } from '../shared/drop-order';
import { dropMatchesGame } from '../shared/game-selection';
import type { AppState, TwitchDrop } from '../types';

export function selectMonitorDrop(state: AppState): TwitchDrop | null {
  const selectedGame = state.selectedGame;
  if (!selectedGame) return null;
  const currentDrop = state.currentDrop;
  if (currentDrop && dropMatchesGame(currentDrop, selectedGame)) {
    const current = pickNearestDrop([currentDrop]);
    if (current) return current;
  }
  return pickNearestDrop(state.pendingDrops.filter((drop) => dropMatchesGame(drop, selectedGame)));
}
