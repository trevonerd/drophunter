import { describe, expect, test } from 'bun:test';
import { shouldCloseManagedTab } from '../../src/background/runtime-state.ts';

describe('shouldCloseManagedTab', () => {
  test('returns true only when the window has more than one tab', () => {
    expect(shouldCloseManagedTab(2)).toBe(true);
    expect(shouldCloseManagedTab(1)).toBe(false);
    expect(shouldCloseManagedTab(0)).toBe(false);
    expect(shouldCloseManagedTab(null)).toBe(false);
  });
});
