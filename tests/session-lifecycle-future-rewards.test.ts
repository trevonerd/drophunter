import { describe, expect, test } from 'bun:test';
import { isKnownCompletedSelection } from '../src/background/session-lifecycle-completion.ts';
import {
  advanceQueueIfCompleted,
  skipCurrentGameAndAdvanceQueue,
} from '../src/background/session-lifecycle-queue.ts';
import { createDrop, createGame, createMinimalState } from './fixtures/queue-management.ts';

function futureReward() {
  return createDrop({
    gameId: 'future',
    startsAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
}

describe('scheduled rewards remain pending in the queue', () => {
  test('advances an expired persisted selection even without restored drops', async () => {
    const state = createMinimalState();
    const expired = createGame({ id: 'expired', expiresInMs: 0 });
    const live = createGame({ id: 'live' });
    state.appState.isRunning = true;
    state.appState.selectedGame = expired;
    state.appState.queue = [expired, live];
    state.appState.allDrops = [];
    state.appState.pendingDrops = [];
    const opened: string[] = [];
    await advanceQueueIfCompleted(state, {
      onSaveTimingState: async () => {},
      onRefreshDropsData: async () => {
        state.appState.allDrops = [createDrop({ gameId: 'live' })];
        state.appState.pendingDrops = [...state.appState.allDrops];
      },
      onOpenStreamer: async () => {
        opened.push(state.appState.selectedGame?.id ?? 'none');
        return true;
      },
    });
    expect(state.appState.queue).toEqual([live]);
    expect(state.appState.selectedGame).toEqual(live);
    expect(opened).toEqual(['live']);
  });

  test('does not classify future rewards as completed or publish completion', async () => {
    const state = createMinimalState();
    const game = createGame({ id: 'future' });
    state.appState.isRunning = true;
    state.appState.selectedGame = game;
    state.appState.queue = [game];
    state.appState.allDrops = [futureReward()];
    state.appState.pendingDrops = [...state.appState.allDrops];
    state.appState.currentDrop = null;
    const alerts: string[] = [];
    expect(isKnownCompletedSelection(state, null)).toBe(false);
    await advanceQueueIfCompleted(state, {
      onSendAlert: async (kind) => {
        alerts.push(kind);
      },
    });
    expect(state.appState.queue).toEqual([game]);
    expect(state.appState.selectedGame).toEqual(game);
    expect(alerts).toEqual([]);
  });

  for (const action of ['advance', 'skip'] as const) {
    test(`${action} preserves a future queue head without opening playback`, async () => {
      const state = createMinimalState();
      const future = createGame({ id: 'future' });
      state.appState.isRunning = true;
      state.appState.selectedGame = createGame({ id: 'completed' });
      state.appState.allDrops = [createDrop({ claimed: true })];
      state.appState.pendingDrops = [];
      state.appState.currentDrop = null;
      state.appState.queue = [future];
      const events: string[] = [];
      const options = {
        onSaveTimingState: async () => {},
        onRefreshDropsData: async () => {
          state.appState.allDrops = [futureReward()];
          state.appState.pendingDrops = [...state.appState.allDrops];
          state.appState.currentDrop = null;
        },
        onOpenStreamer: async () => {
          events.push('playback');
          return true;
        },
        onNotify: async () => {
          events.push('notification');
        },
        onSendAlert: async () => {
          events.push('completion');
        },
      };
      if (action === 'advance') await advanceQueueIfCompleted(state, options);
      else await skipCurrentGameAndAdvanceQueue(state, 'unfarmable', options);
      expect(state.appState.queue).toEqual([future]);
      expect(state.appState.selectedGame).toEqual(future);
      expect(events).toEqual([]);
    });
  }
});
