import { describe, expect, test } from 'bun:test';
import { createPlaybackOrchestrator } from '../src/background/playback-orchestrator.ts';
import { createInitialState } from '../src/shared/utils.ts';
import type { PlaybackPrepResult } from '../src/types/index.ts';

describe('playback self-heal cancellation', () => {
  for (const boundary of ['entry', 'prepare', 'delay', 'retry'] as const) {
    test(`cancellation during ${boundary} prevents later playback and attention effects`, async () => {
      let current = boundary !== 'entry';
      let preparations = 0;
      let notices = 0;
      let attempts = 0;
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<PlaybackPrepResult>();
      const orchestrator = createPlaybackOrchestrator(
        { appState: createInitialState(), invalidStreamChecks: 0, streamValidationGraceUntil: 0 },
        {
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
          attention: {
            beginAttempt: () => {
              attempts += 1;
            },
            muteAfterPreparation: () => false,
            notifyIfNeeded: async () => {
              notices += 1;
            },
          },
          streamerWatchUrl: (channel) => `https://www.twitch.tv/${channel}`,
        },
      );
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
      expect(notices).toBe(0);
      expect(preparations).toBe(boundary === 'entry' ? 0 : boundary === 'retry' ? 2 : 1);
      expect(attempts).toBe(boundary === 'entry' ? 0 : 1);
    });
  }
});
