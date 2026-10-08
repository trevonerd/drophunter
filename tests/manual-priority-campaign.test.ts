import { describe, expect, test } from 'bun:test';
import { setManualPriorityCampaign } from '../src/background/queue-operations.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { normalizeQueueMetadata } from '../src/shared/app-state-collection-normalizers.ts';

describe('Explicit queued Play priority marker', () => {
  test('keeps exactly one pending explicit Play and clears it on demand', () => {
    const state = createServiceWorkerState();
    state.appState.queueEntryMetadataByKey = {
      a: { source: 'manual', addedAt: 1, reason: 'user-added', manualPriorityAt: 5 },
      b: { source: 'favorite-auto', addedAt: 2, reason: 'favorite-discovered', streamerRetryAt: 9 },
    };

    setManualPriorityCampaign(state, 'b', 10);
    expect(state.appState.queueEntryMetadataByKey).toEqual({
      a: { source: 'manual', addedAt: 1, reason: 'user-added' },
      b: {
        source: 'favorite-auto',
        addedAt: 2,
        reason: 'favorite-discovered',
        streamerRetryAt: 9,
        manualPriorityAt: 10,
      },
    });

    setManualPriorityCampaign(state, null);
    expect(state.appState.queueEntryMetadataByKey.b?.manualPriorityAt).toBeUndefined();
  });

  test('ignores an absent key without touching other entries', () => {
    const state = createServiceWorkerState();
    state.appState.queueEntryMetadataByKey = { a: { source: 'manual', addedAt: 1, reason: 'user-added' } };
    setManualPriorityCampaign(state, 'missing', 10);
    expect(state.appState.queueEntryMetadataByKey).toEqual({
      a: { source: 'manual', addedAt: 1, reason: 'user-added' },
    });
  });
});

describe('manualPriorityAt normalization', () => {
  const entry = (manualPriorityAt: unknown) => ({
    source: 'manual',
    addedAt: 1,
    reason: 'user-added',
    manualPriorityAt,
  });

  test.each([['x'], [-1], [0], [Number.NaN], [null]])('drops invalid marker %p', (bad) => {
    expect(normalizeQueueMetadata({ a: entry(bad) }).a?.manualPriorityAt).toBeUndefined();
  });

  test('clamps a future marker to now', () => {
    const restored = normalizeQueueMetadata({ a: entry(Date.now() + 1e9) });
    expect(restored.a?.manualPriorityAt).toBeLessThanOrEqual(Date.now());
  });

  test('keeps only the newest of several stale markers', () => {
    const restored = normalizeQueueMetadata({ a: entry(100), b: entry(300), c: entry(200) });
    expect(restored.a?.manualPriorityAt).toBeUndefined();
    expect(restored.b?.manualPriorityAt).toBe(300);
    expect(restored.c?.manualPriorityAt).toBeUndefined();
  });
});
