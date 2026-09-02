import { describe, expect, test } from 'bun:test';
import { applyStartupResumePolicy } from '../../src/background/runtime-state.ts';
import { createInitialState } from '../../src/shared/utils.ts';

describe('applyStartupResumePolicy', () => {
  function makePolicyState() {
    return {
      appState: {
        ...createInitialState(),
        selectedGame: { id: 'game-1', name: 'Game', imageUrl: '' },
        isRunning: true,
        isPaused: false,
        tabId: 123,
        activeStreamer: { id: 'streamer-1', name: 'streamer', displayName: 'Streamer', isLive: true },
        queue: [{ id: 'game-2', name: 'Next Game', imageUrl: '' }],
        recoveryReason: 'stalled-progress',
        recoveryBackoffUntil: 90_000,
        recoveryAttempts: 2,
      },
      lastHeartbeatAt: 1_000,
      recoveryBackoffUntil: 90_000,
      lastRecoveryAttemptAt: 80_000,
      stalledRecoveryAttempts: 2,
      recoveryNotificationSent: true,
      unverifiableRewardsByKey: {
        '["campaign","reward"]': { progress: 99, currentMinutes: 59, markedAt: 123_456 },
      },
    };
  }

  test('repairs a running session target from the queue before startup monitoring resumes', () => {
    const state = makePolicyState();
    const queued = { id: 'queued', name: 'FragPunk', imageUrl: '', campaignId: 'campaign-fragpunk' };
    state.appState.selectedGame = null;
    state.appState.queue = [queued];
    state.lastHeartbeatAt = 39_000;

    expect(applyStartupResumePolicy(state, 40_000, 30_000, 300_000)).toBe('not-stale');
    expect(state.appState.selectedGame).toEqual(queued);
  });

  test('preserves unverifiable reward markers across startup policy branches', () => {
    const expectedMarkers = {
      '["campaign","reward"]': { progress: 99, currentMinutes: 59, markedAt: 123_456 },
    };

    const recent = makePolicyState();
    recent.lastHeartbeatAt = 35_000;
    expect(applyStartupResumePolicy(recent, 40_000, 30_000, 300_000)).toBe('not-stale');
    expect(recent.unverifiableRewardsByKey).toEqual(expectedMarkers);

    const legacyDisabled = makePolicyState();
    expect(applyStartupResumePolicy(legacyDisabled, 40_000, 30_000, 300_000)).toBe('auto-resume');
    expect(legacyDisabled.unverifiableRewardsByKey).toEqual(expectedMarkers);

    const autoResume = makePolicyState();
    autoResume.appState.autoResumeOnStartup = true;
    expect(applyStartupResumePolicy(autoResume, 40_000, 30_000, 300_000)).toBe('auto-resume');
    expect(autoResume.unverifiableRewardsByKey).toEqual(expectedMarkers);
  });

  test('always resumes stale running sessions even when the legacy toggle is disabled', () => {
    const state = makePolicyState();
    const result = applyStartupResumePolicy(state, 40_000, 30_000, 300_000);

    expect(result).toBe('auto-resume');
    expect(state.appState.isRunning).toBe(true);
    expect(state.appState.isPaused).toBe(false);
    expect(state.appState.selectedGame?.id).toBe('game-1');
    expect(state.appState.queue).toHaveLength(1);
    expect(state.appState.tabId).toBe(123);
    expect(state.appState.activeStreamer?.id).toBe('streamer-1');
  });

  test('allows crash recovery for stale startup sessions when auto-resume is enabled', () => {
    const state = makePolicyState();
    state.appState.autoResumeOnStartup = true;

    const result = applyStartupResumePolicy(state, 40_000, 30_000, 300_000);

    expect(result).toBe('auto-resume');
    expect(state.appState.isPaused).toBe(false);
    expect(state.appState.tabId).toBe(123);
    expect(state.appState.activeStreamer?.id).toBe('streamer-1');
  });

  test('does not treat paused, stopped, or recent heartbeat states as stale startup resumes', () => {
    const paused = makePolicyState();
    paused.appState.isPaused = true;
    expect(applyStartupResumePolicy(paused, 40_000, 30_000, 300_000)).toBe('not-stale');
    expect(paused.appState.isPaused).toBe(true);

    const stopped = makePolicyState();
    stopped.appState.isRunning = false;
    expect(applyStartupResumePolicy(stopped, 40_000, 30_000, 300_000)).toBe('not-stale');
    expect(stopped.appState.isRunning).toBe(false);

    const recent = makePolicyState();
    recent.lastHeartbeatAt = 35_000;
    expect(applyStartupResumePolicy(recent, 40_000, 30_000, 300_000)).toBe('not-stale');
    expect(recent.appState.isPaused).toBe(false);
  });

  describe('resume-recovery', () => {
    function makeNoStreamersState() {
      return {
        appState: {
          ...createInitialState(),
          selectedGame: { id: 'game-1', name: 'Game', imageUrl: '' },
          isRunning: true,
          isPaused: false,
          tabId: null,
          activeStreamer: null,
          queue: [{ id: 'game-2', name: 'Next Game', imageUrl: '' }],
          recoveryReason: 'no-streamers' as const,
          recoveryBackoffUntil: 90_000,
          recoveryAttempts: 1,
        },
        lastHeartbeatAt: 1_000,
        recoveryBackoffUntil: 90_000,
        lastRecoveryAttemptAt: 80_000,
        stalledRecoveryAttempts: 0,
        recoveryNotificationSent: false,
      };
    }

    test('returns resume-recovery within grace and preserves all recovery state', () => {
      const state = makeNoStreamersState();
      const result = applyStartupResumePolicy(state, 40_000, 30_000, 300_000);

      expect(result).toBe('resume-recovery');
      expect(state.appState.isPaused).toBe(false);
      expect(state.appState.recoveryReason).toBe('no-streamers');
      expect(state.appState.recoveryAttempts).toBe(1);
      expect(state.recoveryBackoffUntil).toBe(90_000);
    });

    test('falls through to auto-resume when gap exceeds grace even with the legacy toggle off', () => {
      const state = makeNoStreamersState();
      // Gap 400s > 300s grace
      const result = applyStartupResumePolicy(state, 401_000, 30_000, 300_000);

      expect(result).toBe('auto-resume');
      expect(state.appState.isPaused).toBe(false);
    });

    test('falls through to auto-resume when gap exceeds grace (auto-resume on)', () => {
      const state = makeNoStreamersState();
      state.appState.autoResumeOnStartup = true;
      const result = applyStartupResumePolicy(state, 401_000, 30_000, 300_000);

      expect(result).toBe('auto-resume');
    });

    test('resume-recovery takes precedence over auto-resume within grace', () => {
      const state = makeNoStreamersState();
      state.appState.autoResumeOnStartup = true;
      const result = applyStartupResumePolicy(state, 40_000, 30_000, 300_000);

      expect(result).toBe('resume-recovery');
    });

    test('offline and open-failed within grace return resume-recovery', () => {
      for (const reason of ['offline', 'open-failed'] as const) {
        const state = makeNoStreamersState();
        state.appState.recoveryReason = reason;
        expect(applyStartupResumePolicy(state, 40_000, 30_000, 300_000)).toBe('resume-recovery');
      }
    });

    test('stalled-progress with a tab falls back to unconditional auto-resume', () => {
      const state = makeNoStreamersState();
      state.appState.tabId = 7;
      state.appState.recoveryReason = 'stalled-progress';
      const result = applyStartupResumePolicy(state, 40_000, 30_000, 300_000);

      expect(result).toBe('auto-resume');
    });

    test('tabless stalled-progress within grace resumes with the persisted attempt and backoff', () => {
      const state = makeNoStreamersState();
      state.appState.watchTransportMode = 'tabless';
      state.appState.recoveryReason = 'stalled-progress';
      state.appState.recoveryAttempts = 2;
      state.stalledRecoveryAttempts = 2;

      const result = applyStartupResumePolicy(state, 40_000, 30_000, 300_000);

      expect(result).toBe('resume-recovery');
      expect(state.appState.recoveryAttempts).toBe(2);
      expect(state.stalledRecoveryAttempts).toBe(2);
      expect(state.recoveryBackoffUntil).toBe(90_000);
    });
  });
});
