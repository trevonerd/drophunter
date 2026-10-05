import { expect, test } from 'bun:test';
import { refreshGamesCacheFromHiddenFetch } from '../src/background/games-cache-orchestration.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { resetStreamTrackingState } from '../src/background/session-lifecycle-stop.ts';
import {
  freshFarmableReward,
  makeGamesCacheDeps,
  selectedCampaign,
} from './fixtures/games-cache-orchestration.ts';

test.each(['stalled-progress', 'no-streamers', 'open-failed'] as const)(
  'unchanged campaign refresh preserves %s recovery and its round deadline',
  async (reason) => {
    const now = Date.now();
    const state = createServiceWorkerState();
    Object.assign(state.appState, {
      isRunning: true,
      manualQueueAuthorized: true,
      selectedGame: selectedCampaign,
      availableGames: [selectedCampaign],
      queue: [selectedCampaign],
      allDrops: [freshFarmableReward],
      pendingDrops: [freshFarmableReward],
      currentDrop: freshFarmableReward,
      recoveryReason: reason,
      recoveryAttempts: 2,
      recoveryBackoffUntil: now + 600_000,
      queueAcquisitionRound: {
        attemptedCampaignKeys: ['campaign:terminal-campaign'],
        nextRoundAt: now + 600_000,
      },
    });
    state.lastTrackedDropKey = `${freshFarmableReward.id}::${selectedCampaign.campaignId}`;
    state.lastTrackedProgress = freshFarmableReward.progress;
    state.lastTrackedMinutes = freshFarmableReward.currentMinutes ?? 0;
    state.lastProgressAdvanceAt = now - 600_000;
    state.stalledRecoveryAttempts = 2;
    state.recoveryBackoffUntil = now + 600_000;
    const deps = makeGamesCacheDeps(
      { games: [selectedCampaign], drops: [freshFarmableReward], updatedAt: now },
      { count: 0 },
    );
    await refreshGamesCacheFromHiddenFetch(state, {}, { ...deps, resetStreamTrackingState });
    expect(state.appState.recoveryReason).toBe(reason);
    expect(state.appState.recoveryAttempts).toBe(2);
    expect(state.recoveryBackoffUntil).toBe(now + 600_000);
    expect(state.stalledRecoveryAttempts).toBe(2);
    expect(state.lastProgressAdvanceAt).toBe(now - 600_000);
    expect(state.appState.queueAcquisitionRound?.nextRoundAt).toBe(now + 600_000);
  },
);

test('verified inventory progress from a campaign refresh recovers the running round', async () => {
  const state = createServiceWorkerState();
  Object.assign(state.appState, {
    isRunning: true,
    selectedGame: selectedCampaign,
    queue: [selectedCampaign],
    allDrops: [freshFarmableReward],
    pendingDrops: [freshFarmableReward],
    currentDrop: freshFarmableReward,
    recoveryReason: 'stalled-progress',
    recoveryAttempts: 2,
    queueAcquisitionRound: { attemptedCampaignKeys: ['campaign:previous'], nextRoundAt: null },
  });
  state.lastTrackedDropKey = `${freshFarmableReward.id}::${selectedCampaign.campaignId}`;
  state.lastTrackedProgress = freshFarmableReward.progress;
  state.lastTrackedMinutes = freshFarmableReward.currentMinutes ?? 0;
  const snapshot = {
    games: [selectedCampaign],
    drops: [{ ...freshFarmableReward, progress: 14, currentMinutes: 8 }],
    updatedAt: Date.now(),
    inventoryVerified: true,
  };
  await refreshGamesCacheFromHiddenFetch(
    state,
    {},
    { ...makeGamesCacheDeps(snapshot, { count: 0 }), resetStreamTrackingState },
  );
  expect(state.appState.recoveryReason).toBeNull();
  expect(state.appState.queueAcquisitionRound).toBeNull();
});
