import { describe, expect, test } from 'bun:test';
import { computeEffectiveStallThreshold } from '../../src/background/stream-rotation.ts';

export function registerStreamStallCases() {
  describe('computeEffectiveStallThreshold', () => {
    test('returns 5-minute floor for short drops where formula < 5min (requiredMinutes = 60)', () => {
      expect(computeEffectiveStallThreshold(60)).toBe(5 * 60_000);
    });

    test('allows slow progress updates for 4-hour drops (requiredMinutes = 240)', () => {
      expect(computeEffectiveStallThreshold(240)).toBe(14 * 60_000);
    });

    test('returns formula result for medium drops (requiredMinutes = 300)', () => {
      expect(computeEffectiveStallThreshold(300)).toBe(17 * 60_000);
    });

    test('caps long drops (requiredMinutes = 500)', () => {
      expect(computeEffectiveStallThreshold(500)).toBe(20 * 60_000);
    });

    test('caps very long drops (requiredMinutes = 720)', () => {
      expect(computeEffectiveStallThreshold(720)).toBe(20 * 60_000);
    });

    test('returns 5-minute floor when requiredMinutes is null', () => {
      expect(computeEffectiveStallThreshold(null)).toBe(5 * 60_000);
    });

    test('returns 5-minute floor when requiredMinutes is undefined', () => {
      expect(computeEffectiveStallThreshold(undefined)).toBe(5 * 60_000);
    });

    test('returns 5-minute floor when requiredMinutes is 0', () => {
      expect(computeEffectiveStallThreshold(0)).toBe(5 * 60_000);
    });

    test('returns 5-minute floor for minimal drops (requiredMinutes = 1)', () => {
      expect(computeEffectiveStallThreshold(1)).toBe(5 * 60_000);
    });
  });

  test('exact boundary: requiredMinutes=500 gives capped long-drop threshold, not 5-minute', () => {
    const threshold = computeEffectiveStallThreshold(500);

    expect(threshold).toBe(20 * 60_000);
    expect(threshold).toBeGreaterThan(5 * 60_000);
  });
}
