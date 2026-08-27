import { describe, expect, test } from 'bun:test';
import { CAMPAIGN_SYNC_INTERVAL_MS } from '../src/background/activation-sync-coordinator.ts';
import { PROGRESS_POLL_MS } from '../src/background/constants.ts';
import { checkDropProgress } from '../src/background/drops-tick-monitoring.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';

describe('farming and campaign cadence separation', () => {
  test('uses exactly 60 seconds for progress and 30 minutes for campaigns', () => {
    expect(PROGRESS_POLL_MS).toBe(60_000);
    expect(CAMPAIGN_SYNC_INTERVAL_MS).toBe(30 * 60_000);
  });

  test('the farming tick never requests a campaign fetch, including after a claim', async () => {
    const state = createServiceWorkerState();
    state.appState.isRunning = true;
    const refreshes: Array<{
      includeCampaignFetch?: boolean;
      includeInventoryFetch?: boolean;
      forceInventoryFetch?: boolean;
    }> = [];

    await checkDropProgress(state, {
      onEnforcePlaybackPolicy: async () => {},
      onRotateStreamerIfInvalid: async () => {},
      onAcquireStreamerForSelectedGame: async () => false,
      onAttemptAutoClaimChannelPointsBonus: async () => false,
      onRefreshDropsData: async (options) => {
        refreshes.push(options ?? {});
      },
      onAutoClaimClaimableDrops: async () => true,
      onAdvanceQueueIfCompleted: async () => false,
      onSaveTimingState: async () => {},
      onWatchTransportTick: async () => false,
    });

    expect(refreshes).toEqual([
      { includeCampaignFetch: false, includeInventoryFetch: true },
      { includeCampaignFetch: false, includeInventoryFetch: true, forceInventoryFetch: true },
    ]);
  });
});
