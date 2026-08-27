import type { AppState, DropsSnapshot, TwitchDrop, TwitchGame } from '../types/index.ts';
import type { DropsSnapshotProvenance } from './drops-projection.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

export interface RefreshGamesCacheOptions {
  forceSessionRefresh?: boolean;
  acceptAuthoritativeEmpty?: boolean;
  requireFreshSnapshot?: boolean;
  requireConsecutiveEmptyConfirmation?: boolean;
  onProgressiveSnapshotApplied?: () => Promise<void> | void;
}

export interface GamesCacheRefreshDeps {
  fetchDropsSnapshot: (forceSessionRefresh: boolean) => Promise<DropsSnapshot | null>;
  fetchDropsSnapshotProgressively?: (
    forceSessionRefresh: boolean,
    options: {
      readonly priorityGameIds: readonly string[];
      readonly onProgress: (snapshot: DropsSnapshot) => Promise<void>;
    },
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
  recordEmptyCampaignObservation: (
    state: ServiceWorkerState,
    requireConfirmation: boolean,
  ) => { confirmed: boolean; streak: number };
  resetStateForAuthoritativeEmptyCampaign: (state: ServiceWorkerState) => void;
  clearSelectedCompletedIdleCampaign: (state: ServiceWorkerState) => void;
  resetStreamTrackingState: (state: ServiceWorkerState) => void;
  clearRecoveryStatus: (appState: AppState) => AppState;
  clearTerminalStopStatus: (appState: AppState) => AppState;
  stopFarmingSession: (args: { stopReason: string; stopMessage: string }) => Promise<void>;
  saveState: (state: ServiceWorkerState) => Promise<void>;
}
