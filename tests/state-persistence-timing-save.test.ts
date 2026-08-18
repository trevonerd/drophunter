import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  clearPendingTimingStateSaveForTests,
  loadTimingState,
  saveTimingState,
  setTimingSaveDebounceMsForTests,
} from '../src/background/state-persistence.ts';
import { createMinimalState } from './fixtures/state-persistence.ts';
import { type ChromeMocks, setupChromeMocks } from './mocks/chrome.ts';

describe('loadTimingState / saveTimingState', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
    setTimingSaveDebounceMsForTests(0);
  });

  afterEach(() => {
    clearPendingTimingStateSaveForTests();
    setTimingSaveDebounceMsForTests(null);
    mocks.teardown();
  });

  test('saveTimingState persists timing to local storage', async () => {
    const state = createMinimalState({
      lastStreamRotationAt: 1000,
      streamValidationGraceUntil: 2000,
      invalidStreamChecks: 3,
      noProgressRotationAttempts: 5,
      twitchSessionLastAttemptAt: 3000,
      lastProgressAdvanceAt: 4000,
      lastTrackedProgress: 42,
      lastTrackedMinutes: 10,
      lastTrackedDropKey: 'drop-key-123',
      apiConsecutiveFailures: 2,
      apiBackoffUntil: 5000,
      integrityFallbackActive: true,
      integrityFallbackActiveUntil: 6000,
      recoveryBackoffUntil: 7000,
      lastRecoveryAttemptAt: 8000,
      stalledRecoveryAttempts: 1,
      recoveryNotificationSent: true,
      dropClaimRetryAtById: new Map([['drop1', 999]]),
      offlineChecks: 1,
      avoidStreamerName: 'bad-streamer',
      unverifiableRewardsByKey: {
        '["campaign","reward"]': { progress: 99, currentMinutes: 59, markedAt: 123_456 },
      },
    });

    await saveTimingState(state);

    expect(mocks.storage.local._store.get('timingState')).toMatchObject({
      lastStreamRotationAt: 1000,
      streamValidationGraceUntil: 2000,
      invalidStreamChecks: 3,
      noProgressRotationAttempts: 5,
      twitchSessionLastAttemptAt: 3000,
      lastProgressAdvanceAt: 4000,
      lastTrackedProgress: 42,
      lastTrackedMinutes: 10,
      lastTrackedDropKey: 'drop-key-123',
      apiConsecutiveFailures: 2,
      apiBackoffUntil: 5000,
      integrityFallbackActive: true,
      integrityFallbackActiveUntil: 6000,
      recoveryBackoffUntil: 7000,
      lastRecoveryAttemptAt: 8000,
      stalledRecoveryAttempts: 1,
      recoveryNotificationSent: true,
      dropClaimRetryAtById: { drop1: 999 },
      offlineChecks: 1,
      avoidStreamerName: 'bad-streamer',
      unverifiableRewardsByKey: {
        '["campaign","reward"]': { progress: 99, currentMinutes: 59, markedAt: 123_456 },
      },
    });
  });

  test('round-trip: save then load preserves timing state', async () => {
    const original = createMinimalState({
      lastStreamRotationAt: 12345,
      streamValidationGraceUntil: 23456,
      invalidStreamChecks: 6,
      noProgressRotationAttempts: 12,
      twitchSessionLastAttemptAt: 34567,
      lastProgressAdvanceAt: 45678,
      lastTrackedProgress: 77,
      lastTrackedMinutes: 55,
      lastTrackedDropKey: 'round-trip-key',
      apiConsecutiveFailures: 5,
      apiBackoffUntil: 56789,
      integrityFallbackActive: true,
      integrityFallbackActiveUntil: Date.now() + 86_400_000,
      recoveryBackoffUntil: Date.now() + 86_400_000,
      lastRecoveryAttemptAt: 89012,
      stalledRecoveryAttempts: 3,
      recoveryNotificationSent: true,
      dropClaimRetryAtById: new Map([['dropX', 98765]]),
      offlineChecks: 1,
      avoidStreamerName: 'round-trip-streamer',
      unverifiableRewardsByKey: {
        '["campaign","reward"]': { progress: 99, currentMinutes: 59, markedAt: 123_456 },
      },
    });

    await saveTimingState(original);
    const restored = createMinimalState();
    await loadTimingState(restored);

    expect(restored).toMatchObject({
      lastStreamRotationAt: original.lastStreamRotationAt,
      streamValidationGraceUntil: original.streamValidationGraceUntil,
      invalidStreamChecks: original.invalidStreamChecks,
      noProgressRotationAttempts: original.noProgressRotationAttempts,
      twitchSessionLastAttemptAt: original.twitchSessionLastAttemptAt,
      lastProgressAdvanceAt: original.lastProgressAdvanceAt,
      lastTrackedProgress: original.lastTrackedProgress,
      lastTrackedMinutes: original.lastTrackedMinutes,
      lastTrackedDropKey: original.lastTrackedDropKey,
      apiConsecutiveFailures: original.apiConsecutiveFailures,
      apiBackoffUntil: original.apiBackoffUntil,
      integrityFallbackActive: original.integrityFallbackActive,
      integrityFallbackActiveUntil: original.integrityFallbackActiveUntil,
      recoveryBackoffUntil: original.recoveryBackoffUntil,
      lastRecoveryAttemptAt: original.lastRecoveryAttemptAt,
      stalledRecoveryAttempts: original.stalledRecoveryAttempts,
      recoveryNotificationSent: original.recoveryNotificationSent,
      offlineChecks: original.offlineChecks,
      avoidStreamerName: original.avoidStreamerName,
      unverifiableRewardsByKey: original.unverifiableRewardsByKey,
    });
    expect(restored.dropClaimRetryAtById).toEqual(new Map([['dropX', 98765]]));
  });
});
