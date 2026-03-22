import { describe, expect, test } from 'bun:test';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';
import { createInitialState } from '../src/shared/utils.ts';

describe('normalizeStoredAppState', () => {
  test('returns a full initial state for nullish values', () => {
    expect(normalizeStoredAppState(null)).toEqual(createInitialState());
  });

  test('fills in missing app state fields from defaults', () => {
    const state = normalizeStoredAppState({
      isRunning: true,
      selectedGame: { id: '1', name: 'Game', imageUrl: '' },
    });

    expect(state.isRunning).toBe(true);
    expect(state.selectedGame?.name).toBe('Game');
    expect(state.queue).toEqual([]);
    expect(state.autoClaimChannelPointsBonus).toBe(false);
    expect(state.recoveryReason).toBeNull();
    expect(state.lastStopReason).toBeNull();
  });
});
