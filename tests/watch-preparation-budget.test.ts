import { expect, test } from 'bun:test';
import { transitionAutomaticFarmingSession } from '../src/background/session-lifecycle-transition.ts';
import { createWatchHealth } from '../src/background/watch-health.ts';
import { createWatchTransportTransition } from '../src/background/watch-transport-transition.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import { createIncumbentState, dependenciesFor, request } from './helpers/farming-session-transition-race.ts';

test('unavailable managed ownership retains its failure evidence for scheduled recovery', async () => {
  const transition = createWatchTransportTransition({
    currentOwnership: null,
    prepareManaged: async () => null,
    prepareTabless: async () => null,
    release: async () => ({ kind: 'not-required' }),
  });
  expect(await transition.prepare({ gameId: 'game', channelName: 'channel' }, 'managed-tab')).toMatchObject({
    kind: 'failed',
    health: { reason: 'managed-tab-unavailable' },
  });
});

test.each(['managed-tab-unavailable', 'error', 'playback-inactive'] as const)(
  'automatic preparation %s preserves only real playback failures in the budget',
  async (reason) => {
    const state = createIncumbentState();
    const transition = request();
    const key = gameKey(transition.candidate);
    let saved: unknown;
    const dependencies = dependenciesFor(state, []);
    const health = createWatchHealth(
      reason === 'error' ? 'tabless' : 'managed-tab',
      'failed',
      reason,
      () => 1,
    );
    const run = () =>
      transitionAutomaticFarmingSession(state, transition, {
        ...dependencies,
        watch: {
          ...dependencies.watch,
          prepare: async () => ({ kind: 'failed', reason: 'candidate-unavailable', health }),
        },
        persistAttempt: async () => {
          saved = structuredClone(state.appState.queueEntryMetadataByKey[key]);
          state.appState = structuredClone(state.appState);
          return true;
        },
      });
    if (reason === 'playback-inactive') {
      expect(await run()).toMatchObject({ kind: 'failed', reason: 'candidate-preparation-failed' });
      expect(state.appState.queueEntryMetadataByKey[key]?.attemptedStreamerNames).toEqual(['channel-b']);
    } else {
      for (let attempt = 0; attempt < 5; attempt++) {
        expect(await run()).toMatchObject({ kind: 'failed', reason: 'candidate-preparation-failed' });
        expect(state.appState.queueEntryMetadataByKey[key]?.attemptedStreamerNames).toBeUndefined();
        expect(saved).toBeUndefined();
      }
    }
  },
);
