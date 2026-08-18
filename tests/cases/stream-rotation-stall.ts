import { describe, expect, test } from 'bun:test';
import {
  computeEffectiveStallThreshold,
  didDropMinutesAdvance,
  didDropProgressAdvance,
} from '../../src/background/stream-rotation.ts';

export function registerStreamStallCases() {
  test('progress advance is detected only when the percentage increases', () => {
    expect(didDropProgressAdvance(10, 11)).toBe(true);
    expect(didDropProgressAdvance(10, 10)).toBe(false);
    expect(didDropProgressAdvance(10, 9)).toBe(false);
  });

  describe('didDropMinutesAdvance', () => {
    test('returns true when currentMinutes is greater than previousMinutes', () => {
      expect(didDropMinutesAdvance(10, 11)).toBe(true);
    });

    test('returns false when currentMinutes equals previousMinutes', () => {
      expect(didDropMinutesAdvance(10, 10)).toBe(false);
    });

    test('returns false when currentMinutes is less than previousMinutes (API clock skew)', () => {
      expect(didDropMinutesAdvance(10, 9)).toBe(false);
    });

    test('returns true on first tracking when previousMinutes is -1 and currentMinutes is 0', () => {
      expect(didDropMinutesAdvance(-1, 0)).toBe(true);
    });

    test('returns false when both are -1 (uninitialized state)', () => {
      expect(didDropMinutesAdvance(-1, -1)).toBe(false);
    });
  });

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

  test('long drop: minutes advancing while integer % stays same does not indicate stall', () => {
    const requiredMinutes = 480;
    const previousMinutes = 147;
    const nextMinutes = 148;
    const previousProgress = Math.floor((previousMinutes / requiredMinutes) * 100);
    const nextProgress = Math.floor((nextMinutes / requiredMinutes) * 100);

    expect(didDropProgressAdvance(previousProgress, nextProgress)).toBe(false);
    expect(didDropMinutesAdvance(previousMinutes, nextMinutes)).toBe(true);
  });

  test('short drop: neither minutes nor progress advance indicates stall correctly', () => {
    expect(didDropProgressAdvance(30, 30)).toBe(false);
    expect(didDropMinutesAdvance(18, 18)).toBe(false);
  });

  test('exact boundary: requiredMinutes=500 gives capped long-drop threshold, not 5-minute', () => {
    const threshold = computeEffectiveStallThreshold(500);

    expect(threshold).toBe(20 * 60_000);
    expect(threshold).toBeGreaterThan(5 * 60_000);
  });
}
