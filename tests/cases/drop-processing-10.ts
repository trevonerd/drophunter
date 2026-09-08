import { describe, expect, test } from 'bun:test';
import * as subject from './drop-processing-support.ts';

export function registerDropProcessing10(): void {
  describe('subject.normalizeGameSelection', () => {
    test('returns early when selectedGame is null', () => {
      const state = subject.makeState({
        appState: { ...subject.createInitialState(), selectedGame: null },
      });
      subject.normalizeGameSelection(state, []);
      expect(state.appState.selectedGame).toBeNull();
    });

    test('updates selectedGame when a matching game is found', () => {
      const game = { id: 'g1', name: 'Destiny 2', imageUrl: '' };
      const state = subject.makeState({
        appState: {
          ...subject.createInitialState(),
          selectedGame: { id: 'g1', name: 'destiny 2', imageUrl: '' },
        },
      });
      subject.normalizeGameSelection(state, [game]);
      expect(state.appState.selectedGame).toBe(game);
    });

    test('sets selectedGame to null when drop vanished and no match found', () => {
      const game = { id: 'g1', name: 'Destiny 2', imageUrl: '' };
      const state = subject.makeState({
        appState: {
          ...subject.createInitialState(),
          selectedGame: { id: 'g999', name: 'Vanished Game', imageUrl: '', campaignId: 'c1' },
        },
      });
      subject.normalizeGameSelection(state, [game], true);
      expect(state.appState.selectedGame).toBeNull();
    });

    test('keeps selectedGame when drop vanished=false and no match found', () => {
      const game = { id: 'g1', name: 'Destiny 2', imageUrl: '' };
      const unmatched = { id: 'g999', name: 'Vanished Game', imageUrl: '', campaignId: 'c1' };
      const state = subject.makeState({
        appState: { ...subject.createInitialState(), selectedGame: unmatched },
      });
      subject.normalizeGameSelection(state, [game], false);
      expect(state.appState.selectedGame).toBe(unmatched);
    });
  });
}
