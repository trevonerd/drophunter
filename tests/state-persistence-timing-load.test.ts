import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  clearPendingTimingStateSaveForTests,
  loadTimingState,
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

  test('loadTimingState restores timing from local storage', async () => {
    const state = createMinimalState();
    const futureTime = Date.now() + 999_999;
    mocks.storage.local._store.set('timingState', {
      lastStreamRotationAt: 1111,
      streamValidationGraceUntil: 2222,
      invalidStreamChecks: 7,
      noProgressRotationAttempts: 9,
      twitchSessionLastAttemptAt: 3333,
      dropClaimRetryAtById: { dropA: 4444, dropB: 5555 },
      lastProgressAdvanceAt: 6666,
      lastTrackedProgress: 88,
      lastTrackedMinutes: 44,
      lastTrackedDropKey: 'key-loaded',
      apiConsecutiveFailures: 4,
      apiBackoffUntil: 7777,
      integrityFallbackActive: true,
      integrityFallbackActiveUntil: futureTime,
      recoveryBackoffUntil: futureTime,
      lastRecoveryAttemptAt: 101010,
      stalledRecoveryAttempts: 2,
      recoveryNotificationSent: false,
      offlineChecks: 1,
      avoidStreamerName: 'bad-streamer',
      unverifiableRewardsByKey: {
        '["campaign","reward"]': { progress: 88, currentMinutes: 44, markedAt: 123_456 },
      },
    });

    await loadTimingState(state);

    expect(state).toMatchObject({
      lastStreamRotationAt: 1111,
      streamValidationGraceUntil: 2222,
      invalidStreamChecks: 7,
      noProgressRotationAttempts: 9,
      twitchSessionLastAttemptAt: 3333,
      lastProgressAdvanceAt: 6666,
      lastTrackedProgress: 88,
      lastTrackedMinutes: 44,
      lastTrackedDropKey: 'key-loaded',
      apiConsecutiveFailures: 4,
      apiBackoffUntil: 7777,
      integrityFallbackActive: true,
      integrityFallbackActiveUntil: futureTime,
      recoveryBackoffUntil: futureTime,
      lastRecoveryAttemptAt: 101010,
      stalledRecoveryAttempts: 2,
      recoveryNotificationSent: false,
      offlineChecks: 1,
      avoidStreamerName: 'bad-streamer',
      unverifiableRewardsByKey: {
        '["campaign","reward"]': { progress: 88, currentMinutes: 44, markedAt: 123_456 },
      },
    });
    expect(state.dropClaimRetryAtById).toEqual(
      new Map([
        ['dropA', 4444],
        ['dropB', 5555],
      ]),
    );
  });

  test('loadTimingState rejects malformed unverifiable reward markers without touching other timing fields', async () => {
    const state = createMinimalState({
      lastTrackedProgress: 77,
      lastTrackedMinutes: 55,
      unverifiableRewardsByKey: {
        '["campaign","existing"]': { progress: 50, currentMinutes: 30, markedAt: 123 },
      },
    });
    mocks.storage.local._store.set('timingState', {
      lastTrackedProgress: 88,
      lastTrackedMinutes: 66,
      unverifiableRewardsByKey: {
        '["campaign","valid"]': { progress: 0, currentMinutes: 0, markedAt: 456 },
        '["campaign","nan-progress"]': { progress: Number.NaN, currentMinutes: 1, markedAt: 456 },
        '["campaign","negative-minutes"]': { progress: 1, currentMinutes: -1, markedAt: 456 },
        'non-record': null,
      },
    });

    await loadTimingState(state);

    expect(state.lastTrackedProgress).toBe(88);
    expect(state.lastTrackedMinutes).toBe(66);
    expect(state.unverifiableRewardsByKey).toEqual({
      '["campaign","valid"]': { progress: 0, currentMinutes: 0, markedAt: 456 },
    });
  });

  test('loadTimingState turns a malformed marker record into an empty record', async () => {
    const state = createMinimalState({
      lastTrackedProgress: 77,
      lastTrackedMinutes: 55,
      unverifiableRewardsByKey: {
        '["campaign","existing"]': { progress: 50, currentMinutes: 30, markedAt: 123 },
      },
    });
    mocks.storage.local._store.set('timingState', {
      lastTrackedProgress: 88,
      lastTrackedMinutes: 66,
      unverifiableRewardsByKey: ['not-a-record'],
    });

    await loadTimingState(state);

    expect(state.lastTrackedProgress).toBe(88);
    expect(state.lastTrackedMinutes).toBe(66);
    expect(state.unverifiableRewardsByKey).toEqual({});
  });

  test('loadTimingState resets offlineChecks and avoidStreamerName when absent from storage', async () => {
    const state = createMinimalState({ offlineChecks: 1, avoidStreamerName: 'stale-streamer' });
    mocks.storage.local._store.set('timingState', {});

    await loadTimingState(state);

    expect(state.offlineChecks).toBe(0);
    expect(state.avoidStreamerName).toBeNull();
  });

  test('loadTimingState clears and repopulates dropClaimRetryAtById', async () => {
    const state = createMinimalState({
      dropClaimRetryAtById: new Map([['existing', 111]]),
    });
    mocks.storage.local._store.set('timingState', {
      dropClaimRetryAtById: { new1: 222, new2: 333 },
    });

    await loadTimingState(state);

    expect(state.dropClaimRetryAtById).toEqual(
      new Map([
        ['new1', 222],
        ['new2', 333],
      ]),
    );
  });
});
