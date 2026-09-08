import { describe, expect, test } from 'bun:test';
import * as subject from './drop-processing-support.ts';

export function registerDropProcessing04(): void {
  describe('subject.dropRemainingMinutes', () => {
    test('returns finite value as-is with Math.max(0)', () => {
      const drop = { remainingMinutes: 45 } as subject.TwitchDrop;
      expect(subject.dropRemainingMinutes(drop)).toBe(45);
    });

    test('clamps negative finite values to 0', () => {
      const drop = { remainingMinutes: -10 } as subject.TwitchDrop;
      expect(subject.dropRemainingMinutes(drop)).toBe(0);
    });

    test('returns Infinity for missing remainingMinutes', () => {
      const drop = {} as subject.TwitchDrop;
      expect(subject.dropRemainingMinutes(drop)).toBe(Number.POSITIVE_INFINITY);
    });

    test('returns Infinity for NaN', () => {
      const drop = { remainingMinutes: NaN } as subject.TwitchDrop;
      expect(subject.dropRemainingMinutes(drop)).toBe(Number.POSITIVE_INFINITY);
    });
  });
}
