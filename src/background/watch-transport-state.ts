import { toSlug } from '../shared/utils.ts';
import type { TwitchStreamer, WatchHealthSnapshot, WatchTransportMode } from '../types/index.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import type { FarmingTarget } from './watch-transport.ts';

export function createFarmingTarget(
  state: ServiceWorkerState,
  streamer: TwitchStreamer,
): FarmingTarget | null {
  const selected = state.appState.selectedGame;
  if (!selected || !streamer.name.trim()) return null;
  return {
    gameId: selected.categoryId ?? selected.id,
    selectionId: selected.id,
    campaignId: selected.campaignId,
    categorySlug: selected.categorySlug?.trim() || toSlug(selected.name),
    categoryName: selected.name,
    channelName: streamer.name,
  };
}

export function createInactiveWatchHealth(
  progress: number | null,
  mode: WatchTransportMode,
  now: number,
): WatchHealthSnapshot {
  return {
    mode,
    isHealthy: false,
    status: 'not-started',
    reason: 'not-started',
    consecutiveFailures: 0,
    consecutiveStalls: 0,
    progress,
    shouldFallback: false,
    checkedAt: now,
  };
}
