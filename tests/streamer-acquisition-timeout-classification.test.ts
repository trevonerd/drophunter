import { afterEach, expect, test } from 'bun:test';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { runStreamerAcquisitionAttempt } from '../src/background/streamer-acquisition-attempt.ts';
import { beginStreamerWatchAttempt } from '../src/background/streamer-watch-attempt.ts';

const originalSetTimeout = globalThis.setTimeout;
afterEach(() => {
  globalThis.setTimeout = originalSetTimeout;
});

test.each(['directory', 'playback'] as const)('%s timeout retains its failure domain', async (phase) => {
  globalThis.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) =>
    originalSetTimeout(handler, delay === 60_000 ? 0 : delay, ...args)) as typeof setTimeout;
  const state = createServiceWorkerState();
  state.appState.isRunning = true;
  state.appState.selectedGame = { id: 'game', campaignId: 'campaign', name: 'Game', imageUrl: '' };
  const result = await runStreamerAcquisitionAttempt(
    state,
    async () => {
      state.streamerAcquisitionPhase = phase;
      if (phase === 'playback' && state.appState.selectedGame)
        beginStreamerWatchAttempt(state, state.appState.selectedGame, 'channel');
      return new Promise<boolean>(() => undefined);
    },
    {},
  );
  expect(result).toBe(false);
  expect(state.streamerAcquisitionInFlight).toBeNull();
  if (phase === 'playback') {
    expect(state.appState.recoveryReason).toBe('open-failed');
    expect(state.apiConsecutiveFailures).toBe(0);
    expect(state.appState.queueEntryMetadataByKey['campaign:campaign']?.attemptedStreamerNames?.length).toBe(
      1,
    );
  } else {
    expect(state.appState.recoveryReason).toBe('twitch-network');
    expect(state.apiConsecutiveFailures).toBeGreaterThan(0);
  }
});
