import { describe, expect, test } from 'bun:test';
import { applyExtensionUpdateStateTransition } from '../../src/background/extension-reset.ts';
import { createServiceWorkerState } from '../../src/background/runtime-state.ts';
import { createInitialState } from '../../src/shared/utils.ts';

describe('applyExtensionUpdateStateTransition', () => {
  function makeRunningState() {
    const state = createServiceWorkerState();
    state.appState = {
      ...createInitialState(),
      totalDropsClaimed: 7,
      totalChannelPointsClaimed: 11,
      monitorAutoOpen: false,
      autoResumeOnStartup: true,
      muteFarmingTab: false,
      notificationsEnabled: true,
      telegramAlertsEnabled: true,
      telegramSystemAlertsEnabled: true,
      autoClaimChannelPointsBonus: false,
      autoClaimDrops: false,
      streamerSelectionMode: 'low-view',
      preferredStreamerLanguage: 'en',
      queue: [{ id: 'game-2', name: 'Next Game', imageUrl: '' }],
      selectedGame: { id: 'game-1', name: 'Game', imageUrl: '' },
      isRunning: true,
      tabId: 42,
      activeStreamer: { id: 'streamer-1', name: 'S1', displayName: 'S1', imageUrl: '' },
      recoveryReason: 'stalled-progress',
      recoveryBackoffUntil: 99_999,
      recoveryAttempts: 3,
      resumedFromCrash: true,
      lastRotationReason: 'viewers',
      lastRotationAt: 1234,
    };
    state.cachedDropsSnapshot = [
      {
        id: 'drop-1',
        name: 'D1',
        gameId: 'game-1',
        gameName: 'Game',
        imageUrl: '',
        campaignId: 'c1',
        progress: 0,
        currentMinutes: 0,
        claimed: false,
        acquisitionMethod: 'watch-time',
        rewardKind: 'in-game',
        verificationState: 'unassessed',
      },
    ];
    return state;
  }

  test('preserves lifetime stats, user settings, queue, selected game, and farming intent', () => {
    const state = makeRunningState();
    applyExtensionUpdateStateTransition(state);

    expect(state.appState.totalDropsClaimed).toBe(7);
    expect(state.appState.totalChannelPointsClaimed).toBe(11);
    expect(state.appState.monitorAutoOpen).toBe(false);
    expect(state.appState.autoResumeOnStartup).toBe(true);
    expect(state.appState.muteFarmingTab).toBe(false);
    expect(state.appState.notificationsEnabled).toBe(true);
    expect(state.appState.telegramAlertsEnabled).toBe(true);
    expect(state.appState.telegramSystemAlertsEnabled).toBe(true);
    expect(state.appState.autoClaimChannelPointsBonus).toBe(false);
    expect(state.appState.autoClaimDrops).toBe(false);
    expect(state.appState.streamerSelectionMode).toBe('low-view');
    expect(state.appState.preferredStreamerLanguage).toBe('en');
    expect(state.appState.queue).toEqual([{ id: 'game-2', name: 'Next Game', imageUrl: '' }]);
    expect(state.appState.selectedGame).toEqual({ id: 'game-1', name: 'Game', imageUrl: '' });
    expect(state.appState.isRunning).toBe(false);
    expect(state.appState.wasRunning).toBe(true);
  });

  test('wipes volatile session/recovery/rotation state', () => {
    const state = makeRunningState();
    applyExtensionUpdateStateTransition(state);

    expect(state.appState.tabId).toBeNull();
    expect(state.appState.activeStreamer).toBeNull();
    expect(state.appState.recoveryReason).toBeNull();
    expect(state.appState.recoveryBackoffUntil).toBeNull();
    expect(state.appState.recoveryAttempts).toBeNull();
    expect(state.appState.resumedFromCrash).toBeNull();
    expect(state.appState.completionNotified).toBe(false);
    expect(state.appState.dropsPageRefreshInProgress).toBe(false);
  });

  test('clears cached drops snapshot and rotation metadata', () => {
    const state = makeRunningState();
    applyExtensionUpdateStateTransition(state);

    expect(state.cachedDropsSnapshot).toEqual([]);
    expect(state.appState.lastRotationReason).toBeNull();
    expect(state.appState.lastRotationAt).toBeNull();
  });
});
