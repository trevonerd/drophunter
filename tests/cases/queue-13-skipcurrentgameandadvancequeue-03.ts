import { describe, expect, test } from 'bun:test';
import { skipCurrentGameAndAdvanceQueue } from '../../src/background/session-lifecycle.ts';
import { createDrop, createGame, createMinimalState } from '../fixtures/queue-management.ts';

describe('skipCurrentGameAndAdvanceQueue', () => {
  test('skips a vanished queue entry after an authoritative refresh', async () => {
    // Given: the next campaign had drops before refresh, but has vanished from the authoritative result.
    const current = createGame({ id: 'game-1', campaignId: 'campaign-1' });
    const vanishedGame = createGame({ id: 'game-2', campaignId: 'campaign-2' });
    const farmableGame = createGame({ id: 'game-3', campaignId: 'campaign-3' });
    const farmableDrop = createDrop({ id: 'farmable-drop', campaignId: farmableGame.campaignId });
    const state = createMinimalState();
    state.appState.selectedGame = current;
    state.appState.queue = [current, vanishedGame, farmableGame];
    state.appState.availableGames = [current, vanishedGame, farmableGame];
    let refreshCalls = 0;
    const openedCampaigns: string[] = [];

    // When: skip progression refreshes each candidate before opening its streamer.
    await skipCurrentGameAndAdvanceQueue(state, 'stalled-progress', {
      onSaveTimingState: async () => {},
      onRefreshDropsData: async () => {
        refreshCalls += 1;
        if (refreshCalls === 1) {
          state.previousAllDropsCount = 1;
          state.appState.allDrops = [];
          state.appState.pendingDrops = [];
          state.appState.currentDrop = null;
          return;
        }
        state.appState.allDrops = [farmableDrop];
        state.appState.pendingDrops = [farmableDrop];
        state.appState.currentDrop = farmableDrop;
      },
      onOpenStreamer: async () => {
        const campaignId = state.appState.selectedGame?.campaignId;
        if (campaignId) openedCampaigns.push(campaignId);
        return true;
      },
    });

    // Then: the vanished campaign is removed and only the farmable successor is opened.
    expect(refreshCalls).toBe(2);
    expect(openedCampaigns).toEqual([farmableGame.campaignId]);
    expect(state.appState.selectedGame).toBe(farmableGame);
    expect(state.appState.queue).toEqual([farmableGame]);
  });
});
