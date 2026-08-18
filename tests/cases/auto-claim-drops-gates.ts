import { describe, expect, test } from 'bun:test';
import {
  applyAutoClaimDropsSetting,
  canRetryDropClaim,
  shouldAttemptAutoClaimDrops,
} from '../../src/background/auto-claim.ts';
import { DROP_CLAIM_RETRY_COOLDOWN_MS } from '../../src/background/constants.ts';
import { createInitialState } from '../../src/shared/utils.ts';
import { createMinimalState } from '../fixtures/auto-claim-drops.ts';

export function registerAutoClaimSettingCases() {
  describe('applyAutoClaimDropsSetting', () => {
    test('enabling the setting updates app state', () => {
      const next = applyAutoClaimDropsSetting(createInitialState(), true);
      expect(next.autoClaimDrops).toBe(true);
    });

    test('disabling the setting updates app state', () => {
      const next = applyAutoClaimDropsSetting({ ...createInitialState(), autoClaimDrops: true }, false);
      expect(next.autoClaimDrops).toBe(false);
    });

    test('undefined disables the setting', () => {
      const next = applyAutoClaimDropsSetting({ ...createInitialState(), autoClaimDrops: true }, undefined);
      expect(next.autoClaimDrops).toBe(false);
    });
  });
}

export function registerAutoClaimGateCases() {
  describe('shouldAttemptAutoClaimDrops', () => {
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
}

export function registerClaimRetryCases() {
  describe('canRetryDropClaim', () => {
    test('returns true when claimId has no retry timestamp', () => {
      const state = createMinimalState();
      expect(canRetryDropClaim(state, 'any-claim')).toBe(true);
    });

    test('returns true when current time is past retry timestamp', () => {
      const state = createMinimalState({
        dropClaimRetryAtById: new Map([['claim-1', Date.now() - 1000]]),
      });
      expect(canRetryDropClaim(state, 'claim-1')).toBe(true);
    });

    test('returns false when current time is before retry timestamp', () => {
      const state = createMinimalState({
        dropClaimRetryAtById: new Map([['claim-1', Date.now() + DROP_CLAIM_RETRY_COOLDOWN_MS]]),
      });
      expect(canRetryDropClaim(state, 'claim-1')).toBe(false);
    });
  });
}
