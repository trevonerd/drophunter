import { expect, test } from 'bun:test';
import { createExtensionUpdateAppState } from '../src/background/extension-reset.ts';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';
import { createInitialState } from '../src/shared/utils.ts';

const campaign = { id: 'game', campaignId: 'campaign', name: 'Game', imageUrl: '' };

test('seeded action × recovery × lifecycle sequences preserve user intent across updates', () => {
  let seed = 0x4d564333;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % 6;
  };
  for (let sequence = 0; sequence < 600; sequence += 1) {
    let state = createInitialState();
    state.queue = [campaign];
    state.selectedGame = campaign;
    for (let step = 0; step < 12; step += 1) {
      switch (next()) {
        case 0: // Add queue entry without authorization.
          state.queue = [campaign];
          break;
        case 1: // Explicit Start.
          state.manualQueueAuthorized = true;
          state.isRunning = true;
          state.isPaused = false;
          state.lastStopReason = null;
          break;
        case 2: // Pause.
          if (state.isRunning) state.isPaused = true;
          break;
        case 3: // Stop.
          state.isRunning = false;
          state.isPaused = false;
          state.manualQueueAuthorized = false;
          state.lastStopReason = 'user-stop';
          break;
        case 4: // Transient recovery, including a poisoned deadline.
          state.recoveryReason = 'open-failed';
          state.recoveryBackoffUntil = Date.now() + 365 * 24 * 60 * 60_000;
          break;
        case 5: {
          // Worker reload or extension update.
          const before = state;
          state = normalizeStoredAppState(createExtensionUpdateAppState(before));
          expect(state.queue.map((game) => game.campaignId)).toEqual(['campaign']);
          expect(state.manualQueueAuthorized).toBe(before.manualQueueAuthorized);
          expect(state.isPaused).toBe(before.isPaused);
          expect(state.lastStopReason === 'user-stop').toBe(before.lastStopReason === 'user-stop');
          expect(state.recoveryBackoffUntil).toBeNull();
          if (!before.manualQueueAuthorized && before.lastStopReason === 'user-stop') {
            expect(state.isRunning).toBe(false);
          }
          break;
        }
      }
    }
  }
});
