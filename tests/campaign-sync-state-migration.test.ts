import { describe, expect, test } from 'bun:test';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';

describe('campaign sync state migration', () => {
  test('migrates legacy refresh metadata without preserving a blocking error or in-flight flag', () => {
    const state = normalizeStoredAppState({
      dropsPageRefreshInProgress: true,
      lastDropsPageRefreshAttemptAt: 100,
      lastSuccessfulRefreshAt: 90,
      lastDropsPageRefreshCampaignCount: 12,
      lastDropsPageRefreshError: 'Twitch is temporarily unavailable',
    });

    expect(state.campaignSyncState).toEqual({
      status: 'idle',
      lastAttemptAt: 100,
      lastSuccessAt: 90,
      campaignCount: 12,
      nextRetryAt: null,
    });
  });

  test('turns a persisted syncing state into idle after an MV3 recycle', () => {
    const state = normalizeStoredAppState({
      campaignSyncState: {
        status: 'syncing',
        lastAttemptAt: 200,
        lastSuccessAt: 150,
        campaignCount: 4,
        nextRetryAt: null,
      },
    });

    expect(state.campaignSyncState.status).toBe('idle');
    expect(state.campaignSyncState.lastAttemptAt).toBe(200);
  });
});
