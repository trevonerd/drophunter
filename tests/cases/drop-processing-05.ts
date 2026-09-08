import { describe, expect, test } from 'bun:test';
import * as subject from './drop-processing-support.ts';

export function registerDropProcessing05(): void {
  describe('subject.compareDropPriority', () => {
    test('sorts by remainingMinutes ascending', () => {
      const a = {
        id: 'a',
        name: 'Drop A',
        gameId: 'g1',
        gameName: 'Game',
        imageUrl: '',
        progress: 50,
        currentMinutes: 0,
        claimed: false,
        remainingMinutes: 100,
      } as subject.TwitchDrop;
      const b = {
        id: 'b',
        name: 'Drop B',
        gameId: 'g1',
        gameName: 'Game',
        imageUrl: '',
        progress: 50,
        currentMinutes: 0,
        claimed: false,
        remainingMinutes: 10,
      } as subject.TwitchDrop;
      expect(subject.compareDropPriority(a, b)).toBeGreaterThan(0);
      expect(subject.compareDropPriority(b, a)).toBeLessThan(0);
    });

    test('breaks tie by progress descending', () => {
      const a = {
        id: 'a',
        name: 'Drop A',
        gameId: 'g1',
        gameName: 'Game',
        imageUrl: '',
        progress: 20,
        currentMinutes: 0,
        claimed: false,
        remainingMinutes: 50,
      } as subject.TwitchDrop;
      const b = {
        id: 'b',
        name: 'Drop B',
        gameId: 'g1',
        gameName: 'Game',
        imageUrl: '',
        progress: 80,
        currentMinutes: 0,
        claimed: false,
        remainingMinutes: 50,
      } as subject.TwitchDrop;
      expect(subject.compareDropPriority(a, b)).toBeGreaterThan(0);
      expect(subject.compareDropPriority(b, a)).toBeLessThan(0);
    });

    test('breaks tie by name ascending', () => {
      const a = {
        id: 'a',
        name: 'Zebra Drop',
        gameId: 'g1',
        gameName: 'Game',
        imageUrl: '',
        progress: 50,
        currentMinutes: 0,
        claimed: false,
        remainingMinutes: 50,
      } as subject.TwitchDrop;
      const b = {
        id: 'b',
        name: 'Alpha Drop',
        gameId: 'g1',
        gameName: 'Game',
        imageUrl: '',
        progress: 50,
        currentMinutes: 0,
        claimed: false,
        remainingMinutes: 50,
      } as subject.TwitchDrop;
      expect(subject.compareDropPriority(a, b)).toBeGreaterThan(0);
      expect(subject.compareDropPriority(b, a)).toBeLessThan(0);
    });
  });
}
