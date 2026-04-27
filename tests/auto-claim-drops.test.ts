import { describe, expect, test } from 'bun:test';
import {
  applyAutoClaimDropsSetting,
  shouldAttemptAutoClaimDrops,
} from '../src/background/auto-claim-drops.ts';
import { createInitialState } from '../src/shared/utils.ts';

describe('background auto-claim-drops settings', () => {
  test('enabling the setting updates app state', () => {
    const next = applyAutoClaimDropsSetting(createInitialState(), true);
    expect(next.autoClaimDrops).toBe(true);
  });

  test('disabling the setting updates app state', () => {
    const next = applyAutoClaimDropsSetting(
      {
        ...createInitialState(),
        autoClaimDrops: true,
      },
      false,
    );
    expect(next.autoClaimDrops).toBe(false);
  });

  test('undefined disables the setting', () => {
    const next = applyAutoClaimDropsSetting(
      {
        ...createInitialState(),
        autoClaimDrops: true,
      },
      undefined,
    );
    expect(next.autoClaimDrops).toBe(false);
  });

  test('claim gate blocks attempts when idle, paused, or disabled', () => {
    expect(shouldAttemptAutoClaimDrops(createInitialState())).toBe(false);
    expect(
      shouldAttemptAutoClaimDrops({
        ...createInitialState(),
        isRunning: true,
        isPaused: true,
        autoClaimDrops: true,
      }),
    ).toBe(false);
    expect(
      shouldAttemptAutoClaimDrops({
        ...createInitialState(),
        isRunning: true,
        autoClaimDrops: false,
      }),
    ).toBe(false);
  });

  test('claim gate allows attempts while farming with drops enabled', () => {
    expect(
      shouldAttemptAutoClaimDrops({
        ...createInitialState(),
        isRunning: true,
        autoClaimDrops: true,
      }),
    ).toBe(true);
  });

  test('does not gate on tabId (drops use API not DOM)', () => {
    expect(
      shouldAttemptAutoClaimDrops({
        ...createInitialState(),
        isRunning: true,
        autoClaimDrops: true,
        tabId: null,
      }),
    ).toBe(true);
  });
});
