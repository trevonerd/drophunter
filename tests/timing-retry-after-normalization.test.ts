import { expect, test } from 'bun:test';
import { applyApiBackoff } from '../src/background/api-operations.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { normalizeTimingState } from '../src/background/runtime-timing-state.ts';

test('legacy impossible API and recovery backoffs are bounded on same-version load', () => {
  const now = 1_000_000;
  const saved = normalizeTimingState(
    {
      apiBackoffUntil: now + 365 * 24 * 60 * 60_000,
      recoveryBackoffUntil: now + 365 * 24 * 60 * 60_000,
    },
    now,
  );
  expect(saved.apiBackoffUntil).toBe(now + 10 * 60_000);
  expect(saved.recoveryBackoffUntil).toBe(now + 10 * 60_000);
  expect(saved.apiRetryAfterVerifiedAt).toBe(0);
});

test('recent verified Retry-After retains its deadline without inheriting corrupt legacy timers', () => {
  const state = createServiceWorkerState();
  const before = Date.now();
  applyApiBackoff(state, 45 * 60_000);
  expect(state.apiRetryAfterVerifiedAt).toBeGreaterThanOrEqual(before);
  const saved = normalizeTimingState({
    apiBackoffUntil: state.apiBackoffUntil,
    apiRetryAfterVerifiedAt: state.apiRetryAfterVerifiedAt,
  });
  expect(saved.apiBackoffUntil).toBe(state.apiBackoffUntil);
  expect(saved.apiRetryAfterVerifiedAt).toBe(state.apiRetryAfterVerifiedAt ?? 0);
});

test('forged or stale proof cannot keep a year-long deadline', () => {
  const now = Date.now();
  const saved = normalizeTimingState(
    {
      apiBackoffUntil: now + 365 * 24 * 60 * 60_000,
      apiRetryAfterVerifiedAt: now - 30_000,
    },
    now,
  );
  expect(saved.apiBackoffUntil).toBe(now + 10 * 60_000);
  expect(saved.apiRetryAfterVerifiedAt).toBe(0);
});

test('an excessive but valid Retry-After is bounded to one day rather than ignored', () => {
  const state = createServiceWorkerState();
  const before = Date.now();
  applyApiBackoff(state, 365 * 24 * 60 * 60_000);
  expect(state.apiBackoffUntil).toBeGreaterThanOrEqual(before + 24 * 60 * 60_000);
  expect(state.apiBackoffUntil).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60_000);
});
