import { expect, test } from 'bun:test';
import { createGame, createMinimalState } from './fixtures/queue-management.ts';
import { verifyExpectedDiagnostics } from './support/expected-diagnostics.ts';
import { createDeferred } from './support/farming-automation-fixtures.ts';
import { createQueueProgressionFixture } from './support/queue-progression.ts';

verifyExpectedDiagnostics([
  ['[DropHunter] Parking campaign because no eligible Drops streamer was found', 2],
]);

test.each(['complete', 'skip'] as const)(
  'cancels %s progression across Stop and Pause during preparation',
  async (kind) => {
    for (const action of ['stop', 'pause'] as const) {
      const state = createMinimalState();
      const current = createGame({ campaignId: 'current', allDropsCompleted: true });
      const next = createGame({ campaignId: 'next' });
      Object.assign(state.appState, { queue: [current, next], selectedGame: current, isRunning: true });
      const entered = createDeferred<void>();
      const resume = createDeferred<void>();
      let commits = 0;
      const progression = createQueueProgressionFixture(state, {
        transitionCampaign: async (_game, isCurrent) => {
          entered.resolve();
          await resume.promise;
          if (!isCurrent()) return { kind: 'cancelled' };
          commits += 1;
          return { kind: 'started' };
        },
      });
      const pending =
        kind === 'complete' ? progression.advanceIfCompleted() : progression.skipCurrent('no-streamers');
      await entered.promise;
      if (action === 'pause') state.appState.isPaused = true;
      else {
        state.tickGeneration += 1;
        state.appState.isRunning = false;
        state.appState.lastStopReason = 'user-stop';
      }
      resume.resolve();
      await pending;
      expect(commits).toBe(0);
      expect(state.appState.selectedGame).toEqual(current);
      expect(state.appState.isPaused || !state.appState.isRunning).toBe(true);
    }
  },
);
