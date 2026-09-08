import { describe, expect, test } from 'bun:test';
import { skipCurrentGameAndAdvanceQueue } from '../../src/background/session-lifecycle.ts';
import { createDrop, createGame, createMinimalState } from '../fixtures/queue-management.ts';

describe('skipCurrentGameAndAdvanceQueue', () => {
  test('uses truthful unverifiable-Twitch terminal state when no games remain', async () => {
    const current = createGame({
      id: 'game-1',
      name: 'Unverifiable Game',
      rewardSummary: { completion: 'farming-complete', remainderReasons: ['unverifiable-twitch'] },
    });
    const state = createMinimalState();
    state.appState.selectedGame = current;
    state.appState.queue = [current];
    let stop:
      | { stopReason: string; stopMessage: string; notification: { title: string; message: string } }
      | undefined;
    await skipCurrentGameAndAdvanceQueue(state, 'unverifiable-twitch', {
      onStopFarmingSession: async (options) => {
        stop = options;
      },
    });
    expect(stop?.stopReason).toBe('unverifiable-twitch');
    expect(stop?.stopMessage).toContain('could not be verified');
    expect(stop?.notification.message).toContain('could not be verified');
    expect(stop?.stopMessage).not.toMatch(/all rewards (claimed|acquired|complete)/i);
    expect(state.appState.selectedGame).toEqual(current);
  });

  test('advances with truthful unverifiable-Twitch copy when another game is queued', async () => {
    const current = createGame({ id: 'game-1', name: 'Unverifiable Game', campaignId: 'campaign-1' });
    const next = createGame({ id: 'game-2', name: 'Farmable Game', campaignId: 'campaign-2' });
    const nextDrop = createDrop({ id: 'next-drop', campaignId: next.campaignId });
    const state = createMinimalState();
    state.appState.selectedGame = current;
    state.appState.queue = [current, next];
    state.appState.availableGames = [current, next];
    const notifications: Array<{ title: string; message: string }> = [];
    await skipCurrentGameAndAdvanceQueue(state, 'unverifiable-twitch', {
      onSaveTimingState: async () => {},
      onRefreshDropsData: async () => {
        state.appState.allDrops = [nextDrop];
        state.appState.pendingDrops = [nextDrop];
        state.appState.currentDrop = nextDrop;
      },
      onOpenStreamer: async () => true,
      onNotify: async (title, message) => {
        notifications.push({ title, message });
      },
    });
    expect(state.appState.selectedGame?.campaignId).toBe(next.campaignId);
    expect(state.appState.queue).toEqual([next]);
    expect(notifications[0]?.title).toBe('Campaign farming finished');
    expect(notifications[0]?.message).toContain('could not be verified');
    expect(notifications[0]?.message).toContain('Now farming Farmable Game');
    expect(notifications[0]?.message).not.toMatch(/all rewards (claimed|acquired|complete)/i);
  });
});
