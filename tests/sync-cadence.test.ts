import { describe, expect, test } from 'bun:test';
import { CAMPAIGN_SYNC_INTERVAL_MS } from '../src/background/activation-sync-coordinator.ts';
import { INVENTORY_REFRESH_INTERVAL_MS, PROGRESS_POLL_MS } from '../src/background/constants.ts';
import { checkDropProgress } from '../src/background/drops-tick-monitoring.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';

describe('farming and campaign cadence separation', () => {
  test('uses 60 seconds for heartbeat, 5 minutes for inventory, and 30 minutes for campaigns', () => {
    expect(PROGRESS_POLL_MS).toBe(60_000);
    expect(INVENTORY_REFRESH_INTERVAL_MS).toBe(5 * 60_000);
    expect(CAMPAIGN_SYNC_INTERVAL_MS).toBe(30 * 60_000);
  });

  test('the farming tick never requests a campaign fetch, including after a claim', async () => {
    const state = createServiceWorkerState();
    state.appState.isRunning = true;
    const refreshes: Array<{
      includeCampaignFetch?: boolean;
      includeInventoryFetch?: boolean;
    }> = [];

    await checkDropProgress(state, {
      onEnforcePlaybackPolicy: async () => {},
      onRotateStreamerIfInvalid: async () => {},
      onAcquireStreamerForSelectedGame: async () => false,
      onAttemptAutoClaimChannelPointsBonus: async () => false,
      onRefreshDropsData: async (options) => {
        refreshes.push(options ?? {});
        return 'refreshed';
      },
      onAutoClaimClaimableDrops: async () => true,
      onAdvanceQueueIfCompleted: async () => false,
      onSaveTimingState: async () => {},
      onWatchTransportTick: async () => false,
    });

    expect(refreshes).toEqual([
      { includeCampaignFetch: false, includeInventoryFetch: true },
      { includeCampaignFetch: false, includeInventoryFetch: true },
    ]);
  });

  test('minute ticks refresh inventory only once inside the five-minute window', async () => {
    const state = createServiceWorkerState();
    state.appState.isRunning = true;
    let inventoryRefreshes = 0;
    const callbacks = {
      onEnforcePlaybackPolicy: async () => {},
      onRotateStreamerIfInvalid: async () => {},
      onAcquireStreamerForSelectedGame: async () => false,
      onAttemptAutoClaimChannelPointsBonus: async () => false,
      onRefreshDropsData: async (options?: { includeInventoryFetch?: boolean }) => {
        if (options?.includeInventoryFetch) inventoryRefreshes += 1;
        return 'refreshed' as const;
      },
      onAutoClaimClaimableDrops: async () => false,
      onAdvanceQueueIfCompleted: async () => false,
      onSaveTimingState: async () => {},
      onWatchTransportTick: async () => false,
    };

    await checkDropProgress(state, callbacks);
    await checkDropProgress(state, callbacks);

    expect(inventoryRefreshes).toBe(1);
  });
});
