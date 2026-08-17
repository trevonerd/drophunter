import type { PlaybackPrepResult } from '../types/index.ts';

interface PlaybackAttentionState {
  playbackAttentionWarningSent: boolean;
}

export interface PlaybackAttentionPolicy {
  readonly beginAttempt: () => void;
  readonly muteAfterPreparation: () => boolean;
  readonly notifyIfNeeded: (prepared: PlaybackPrepResult) => Promise<void>;
}

export interface PlaybackAttentionPolicyOptions {
  readonly shouldMuteManagedFarmingTab: () => boolean;
  readonly needsPlaybackAttention: (result: PlaybackPrepResult | null | undefined) => boolean;
  readonly notify: (title: string, message: string, priority?: number) => Promise<unknown> | unknown;
}

export function createPlaybackAttentionPolicy(
  state: PlaybackAttentionState,
  options: PlaybackAttentionPolicyOptions,
): PlaybackAttentionPolicy {
  return {
    beginAttempt() {
      state.playbackAttentionWarningSent = false;
    },
    muteAfterPreparation: options.shouldMuteManagedFarmingTab,
    async notifyIfNeeded(prepared) {
      if (state.playbackAttentionWarningSent || !options.needsPlaybackAttention(prepared)) {
        return;
      }
      state.playbackAttentionWarningSent = true;
      await options.notify(
        'DropHunter needs your attention',
        "Keep Twitch in front and click the video if playback didn't start.",
        2,
      );
    },
  };
}
