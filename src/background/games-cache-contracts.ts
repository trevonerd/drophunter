import type { AppState, DropsSnapshot, TwitchDrop, TwitchGame } from '../types/index.ts';
import type { DropsSnapshotProvenance } from './drops-projection.ts';
import type { QueueAvailabilityCleanupResult } from './queue-availability-cleanup.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import type { TwitchApiRequestOptions } from './session-orchestrator.ts';
import type { TwitchApiFailure } from './twitch-api/errors.ts';

export interface RefreshGamesCacheOptions {
  acceptAuthoritativeEmpty?: boolean;
  requireFreshSnapshot?: boolean;
  onProgressiveSnapshotApplied?: () => Promise<void> | void;
  isCurrent?: () => boolean;
}

export interface GamesCacheRefreshDeps {
  fetchDropsSnapshot: (options?: TwitchApiRequestOptions) => Promise<DropsSnapshot | null>;
  getLastTwitchApiFailure?: () => TwitchApiFailure | null;
  fetchDropsSnapshotProgressively?: (
    options: {
      readonly priorityGameIds: readonly string[];
      readonly onProgress: (snapshot: DropsSnapshot) => Promise<void>;
    },
    requestOptions?: TwitchApiRequestOptions,
  ) => Promise<DropsSnapshot | null>;
  onProgressiveSnapshotApplied?: () => void;
  replaceAvailableGames: (games: TwitchGame[]) => TwitchGame[];
  annotateGameCompletion: (
    games: TwitchGame[],
    drops: TwitchDrop[],
    provenance: DropsSnapshotProvenance,
  ) => TwitchGame[];
  normalizeGameSelection: (state: ServiceWorkerState, games: TwitchGame[], dropVanished?: boolean) => void;
  normalizeQueueSelection: (state: ServiceWorkerState, games: TwitchGame[], hasSnapshot: boolean) => void;
  splitDropsForSelectedGame: (state: ServiceWorkerState, drops: TwitchDrop[]) => void;
  resetStateForAuthoritativeEmptyCampaign: (state: ServiceWorkerState) => void;
  clearSelectedCompletedIdleCampaign: (state: ServiceWorkerState) => void;
  resetStreamTrackingState: (state: ServiceWorkerState) => void;
  clearRecoveryStatus: (appState: AppState) => AppState;
  clearTerminalStopStatus: (appState: AppState) => AppState;
  onAuthoritativeCampaignUnavailable?: (game: TwitchGame) => Promise<void>;
  onQueueCampaignsRemoved?: (result: QueueAvailabilityCleanupResult) => Promise<void>;
  stopFarmingSession: (args: { stopReason: string; stopMessage: string }) => Promise<void>;
  saveState: (state: ServiceWorkerState) => Promise<void>;
}
