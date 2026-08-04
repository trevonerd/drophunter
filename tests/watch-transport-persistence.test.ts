import { describe, expect, test } from 'bun:test';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';
import { createInitialState } from '../src/shared/utils.ts';

describe('watch transport app state', () => {
  test('defaults to managed-tab and preserves a valid tabless health snapshot', () => {
    const defaults = createInitialState();
    expect(defaults.watchTransportPreference).toBe('managed-tab');
    expect(defaults.watchTransportMode).toBe('managed-tab');
    expect(defaults.watchHealth).toBeNull();

    const state = normalizeStoredAppState({
      watchTransportPreference: 'tabless',
      watchTransportMode: 'tabless',
      watchHealth: {
        mode: 'tabless',
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

    expect(state.watchTransportPreference).toBe('tabless');
    expect(state.watchTransportMode).toBe('tabless');
    expect(state.watchHealth?.progress).toBe(12);
  });
});
