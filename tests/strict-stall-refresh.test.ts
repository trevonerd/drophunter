import { describe, expect, test } from 'bun:test';
import { projectDropsSnapshot } from '../src/background/drops-projection.ts';
import { refreshDropsData } from '../src/background/drops-tick-refresh.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';

describe('strict stall refresh evidence', () => {
  test('does not accept a partial campaign snapshot as confirmed stall evidence', async () => {
    const state = createServiceWorkerState();
    const outcome = await refreshDropsData(
      state,
      { includeCampaignFetch: true, strictFreshProof: true, suppressNotifications: true } as never,
      {
        onFetchDropsSnapshotFromApi: async () => ({
          games: [],
          drops: [],
          campaignsVerified: false,
          inventoryVerified: true,
          updatedAt: Date.now(),
        }),
        onEvaluateDropTransitions: async () => {},
        onSaveState: async () => {},
      },
      {
        replaceAvailableGames: (games) => games,
        getGameDisplayLabel: (game) => game.name,
        projectDropsSnapshot,
        normalizeQueueSelection: () => {},
      },
    );

    expect(outcome).toBe('transient-failure');
    expect(state.hasCurrentGenerationCampaignValidation).toBe(false);
  });
});
