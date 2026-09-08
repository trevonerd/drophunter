import { describe, expect, test } from 'bun:test';
import * as subject from './drop-processing-support.ts';

export function registerDropProcessing07(): void {
  describe('subject.completedDropKeys', () => {
    test('returns empty set for empty array', () => {
      expect(subject.completedDropKeys([])).toEqual(new Set());
    });

    test('returns set of keys for multiple drops', () => {
      const drops = [
        { id: 'a', campaignId: 'c1' } as subject.TwitchDrop,
        { id: 'b', campaignId: 'c2' } as subject.TwitchDrop,
      ];
      const keys = subject.completedDropKeys(drops);
      expect(keys.size).toBe(2);
      expect(keys.has('a::c1')).toBe(true);
      expect(keys.has('b::c2')).toBe(true);
    });
  });
}
