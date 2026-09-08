import { describe, expect, test } from 'bun:test';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';
import { createInitialState } from '../src/shared/utils.ts';

describe('watch transport app state', () => {
  test('defaults to hidden watching and preserves stored managed preference', () => {
    const defaults = createInitialState();
    expect(defaults.watchTransportPreference).toBe('tabless');
    expect(defaults.watchTransportMode).toBe('tabless');
    expect(defaults.watchHealth).toBeNull();

    const state = normalizeStoredAppState({
      watchTransportPreference: 'managed-tab',
      watchTransportMode: 'managed-tab',
      watchHealth: {
        mode: 'managed-tab',
        isHealthy: true,
        status: 'healthy',
        reason: 'heartbeat',
        consecutiveFailures: 0,
        consecutiveStalls: 0,
        progress: 12,
        shouldFallback: false,
        checkedAt: 100,
      },
      watchFallbackReason: null,
    });

    expect(state.watchTransportPreference).toBe('managed-tab');
    expect(state.watchTransportMode).toBe('managed-tab');
    expect(state.watchHealth?.progress).toBe(12);
  });
});
