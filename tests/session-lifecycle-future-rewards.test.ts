import { verifyExpectedDiagnostics } from './support/expected-diagnostics.ts';

// These recovery/failure scenarios must emit only their declared diagnostic text.
verifyExpectedDiagnostics([
  '[DropHunter] Removing campaign after an authoritative refresh proved it unfarmable',
]);

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
  test('moves a campaign with future-only drops behind a playable queued campaign', async () => {
    const state = createMinimalState();
    const future = createGame({ id: 'future', campaignId: 'future' });
    const laterFuture = createGame({ id: 'later-future', campaignId: 'later-future' });
    const live = createGame({ id: 'live', campaignId: 'live' });
    state.appState.isRunning = true;
    state.appState.manualQueueAuthorized = true;
    state.appState.campaignPriorityMode = 'priority-list-only';
    state.appState.selectedGame = future;
    state.appState.queue = [future, laterFuture, live];
    state.appState.availableGames = [future, laterFuture, live];
    state.appState.allDrops = [futureReward()];
    state.appState.pendingDrops = [...state.appState.allDrops];
    const opened: string[] = [];

    await advanceQueueIfCompleted(state, {
      onSaveTimingState: async () => {},
      onRefreshDropsData: async () => {
        const selected = state.appState.selectedGame;
        state.appState.allDrops =
          selected?.campaignId !== 'live'
            ? [
                createDrop({
                  gameId: selected?.id,
                  campaignId: selected?.campaignId,
                  startsAt: new Date(Date.now() + 3_600_000).toISOString(),
                }),
              ]
            : [createDrop({ gameId: 'live', campaignId: 'live' })];
        state.appState.pendingDrops = [...state.appState.allDrops];
      },
      onOpenStreamer: async () => {
        opened.push(state.appState.selectedGame?.campaignId ?? 'none');
        return true;
      },
    });

    expect(opened).toEqual(['live']);
    expect(state.appState.selectedGame?.campaignId).toBe('live');
    expect(state.appState.queue.map((game) => game.campaignId)).toEqual(['live', 'future', 'later-future']);
    expect(state.appState.isRunning).toBe(true);
    expect(state.appState.isPaused).toBe(false);
    expect(state.appState.manualQueueAuthorized).toBe(true);
  });

  test('keeps a future-only queue authorized and active while waiting for its start time', async () => {
    const state = createMinimalState();
    const future = createGame({ id: 'future', campaignId: 'future' });
    state.appState.isRunning = true;
    state.appState.manualQueueAuthorized = true;
    state.appState.selectedGame = future;
    state.appState.queue = [future];
    state.appState.availableGames = [future];
    state.appState.allDrops = [futureReward()];
    state.appState.pendingDrops = [...state.appState.allDrops];
    let stopped = false;

    await advanceQueueIfCompleted(state, {
      onSaveTimingState: async () => {},
      onRefreshDropsData: async () => {
        state.appState.allDrops = [futureReward()];
        state.appState.pendingDrops = [...state.appState.allDrops];
      },
      onStopMonitoring: () => {
        stopped = true;
      },
      onOpenStreamer: async () => {
        throw new Error('Future rewards cannot start playback');
      },
    });

    expect(stopped).toBe(false);
    expect(state.appState.isRunning).toBe(true);
    expect(state.appState.isPaused).toBe(false);
    expect(state.appState.manualQueueAuthorized).toBe(true);
    expect(state.appState.queue).toEqual([future]);
  });

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
      const savedRounds: Array<number | null> = [];
      const options = {
        onSaveState: async () => {
          savedRounds.push(state.appState.queueAcquisitionRound?.nextRoundAt ?? null);
        },
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
      expect(savedRounds.at(-1)).toBeGreaterThan(Date.now());
    });
  }
});
