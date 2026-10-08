import type { RotateStreamerIfInvalidOptions } from '../../src/background/streamer-acquisition-contracts.ts';

/** No-op defaults matching the behavior of absent callbacks. */
export function rotateIfInvalidOptions(
  overrides: Partial<RotateStreamerIfInvalidOptions> = {},
): RotateStreamerIfInvalidOptions {
  return {
    onFetchStreamContext: async () => null,
    onResolveCategorySlug: async () => '',
    onSaveState: async () => {},
    onSaveTimingState: async () => {},
    onRotateStreamer: async () => false,
    onOpenStreamer: async () => false,
    onSkipCurrentGame: async () => {},
    onTablessWatchActive: () => false,
    onRecoverStalledProgress: async () => ({ kind: 'refresh-unavailable' }),
    ...overrides,
  };
}
