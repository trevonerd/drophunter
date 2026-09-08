import { describe, expect, test } from 'bun:test';
import * as subject from './drop-processing-support.ts';

export function registerDropProcessing09(): void {
  describe('subject.dropMatchesSelectedGame', () => {
    test('delegates to subject.dropMatchesGame', () => {
      const drop = {
        id: 'd1',
        gameId: 'g1',
        campaignId: 'c1',
        gameName: 'Game',
        imageUrl: '',
      } as subject.TwitchDrop;
      const game = { id: 'g1', name: 'Game', imageUrl: '' };
      expect(subject.dropMatchesSelectedGame(drop, game)).toBe(subject.dropMatchesGame(drop, game));
    });
  });
}
