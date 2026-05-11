import type { PlaybackPrepResult } from '../types/index.ts';

export function needsPlaybackAttention(result: PlaybackPrepResult | null | undefined): boolean {
  return !result?.isPlaybackReady;
}
