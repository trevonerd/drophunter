import { describe, expect, test } from 'bun:test';
import { createPlaybackOrchestrator } from '../src/background/playback-orchestrator.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import type { PlaybackPrepResult } from '../src/types/index.ts';

describe('playback self-heal cancellation', () => {
  for (const boundary of ['entry', 'prepare', 'delay', 'retry'] as const) {
    test(`cancellation during ${boundary} prevents later playback and attention effects`, async () => {
      let current = boundary !== 'entry';
      let preparations = 0;
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<PlaybackPrepResult>();
      const state = createServiceWorkerState();
      state.appState.isRunning = true;
      const orchestrator = createPlaybackOrchestrator(state, {
        transport: {
          openManaged: async () => null,
          hasTab: async () => true,
          prepareVisible: async () => ({ isPlaybackReady: true, gateDismissed: false }),
          prepare: async () => {
            preparations += 1;
            if (boundary === 'prepare' || (boundary === 'retry' && preparations === 2)) {
              entered.resolve();
              return release.promise;
            }
            if (boundary !== 'retry') entered.resolve();
            return { isPlaybackReady: false, gateDismissed: true };
          },
        },
        shouldMuteManagedFarmingTab: () => true,
        streamerWatchUrl: (channel) => `https://www.twitch.tv/${channel}`,
      });
      const heal: (tabId: number, isCurrent: () => boolean) => Promise<void> =
        orchestrator.attemptPlaybackSelfHeal;
      const pending = heal(8, () => current);
      if (boundary !== 'entry') {
        await entered.promise;
        if (boundary === 'delay') await new Promise((resolve) => setTimeout(resolve, 0));
        current = false;
        release.resolve({ isPlaybackReady: false, gateDismissed: false });
      }
      await pending;
      expect(preparations).toBe(boundary === 'entry' ? 0 : boundary === 'retry' ? 2 : 1);
    });
  }
});
