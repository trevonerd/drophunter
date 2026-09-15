import { describe, expect, test } from 'bun:test';
import {
  advanceQueueIfCompleted,
  skipCurrentGameAndAdvanceQueue,
} from '../src/background/session-lifecycle-queue.ts';
import { createGame, createMinimalState } from './fixtures/queue-management.ts';

describe('queue advancement cancellation', () => {
  test.each([
    'complete',
    'skip',
  ] as const)('does not open a streamer after Stop during %s refresh', async (kind) => {
    // Given: a queue transition is current until its campaign refresh sees a concurrent Stop.
    const state = createMinimalState();
    const current = createGame({ campaignId: 'current', allDropsCompleted: true });
    const next = createGame({ campaignId: 'next' });
    state.appState.queue = [current, next];
    state.appState.selectedGame = current;
    state.appState.isRunning = true;
    let currentOperation = true;
    let opened = 0;
    const options = {
      isCurrent: () => currentOperation,
      onSaveState: async () => {},
      onSaveTimingState: async () => {},
      onRefreshDropsData: async () => {
        currentOperation = false;
        state.appState.isRunning = false;
      },
      onOpenStreamer: async () => {
        opened += 1;
        return true;
      },
    };
    // When: completion/skip resumes after that stale refresh.
    if (kind === 'complete') await advanceQueueIfCompleted(state, options);
    else await skipCurrentGameAndAdvanceQueue(state, 'no-streamers', options);
    // Then: the superseded operation cannot start the next stream or reactivate farming.
    expect(opened).toBe(0);
    expect(state.appState.isRunning).toBe(false);
  });
});
