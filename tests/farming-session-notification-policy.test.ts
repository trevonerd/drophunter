import { expect, test } from 'bun:test';
import { createFarmingSessionContext } from '../src/background/farming-session-context.ts';
import { createFarmingSessionStallRecovery } from '../src/background/farming-session-stall-recovery.ts';
import {
  createDrop,
  createFarmingSessionAdapters,
  createGame,
  createMinimalState,
} from './fixtures/queue-management.ts';

test('keeps routine stalled-progress retries silent', async () => {
  const state = createMinimalState();
  state.appState.isRunning = true;
  state.appState.selectedGame = createGame();
  state.appState.currentDrop = createDrop({ progress: 10 });
  const notifications: string[] = [];
  const context = createFarmingSessionContext(
    state,
    createFarmingSessionAdapters({
      now: () => 1_000,
      automationNotify: async ({ event }) => {
        notifications.push(event);
      },
    }),
  );
  const recover = createFarmingSessionStallRecovery(context, {
    onRefreshDropsData: async () => 'refreshed',
    onAdvanceQueueIfCompleted: async () => false,
    onAcquireStreamer: async () => true,
    onSkipCurrentGame: async () => {},
    onEnterPersistentRecovery: async () => {},
  });

  const result = await recover({ kind: 'managed-tab', tabId: 42 });

  expect(result).toMatchObject({ kind: 'retry-scheduled', attempt: 1, started: true });
  expect(notifications).toEqual([]);
});
