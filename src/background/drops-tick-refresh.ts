// Owns campaign/inventory snapshot refresh and projection into runtime state.
import type { DropsSnapshot, TwitchDrop, TwitchGame } from '../types';
import { detectNewlyClaimedDrops, recordClaimedDrops } from './claim-log.ts';
import { completedDropKeys, type DropsSnapshotProvenance } from './drops-projection.ts';
import { snapshotProvenance } from './drops-snapshot-provenance.ts';
import { cleanUnavailableQueueCampaigns } from './queue-availability-cleanup.ts';
import { notifyQueueCleanup, recordQueueCleanupActivity } from './queue-availability-cleanup-activity.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import type { SessionRecoveryMode, TwitchApiRequestOptions } from './session-orchestrator.ts';

export type RefreshDropsOutcome = 'refreshed' | 'transient-failure' | 'auth-required';

export interface RefreshDropsDataCallbacks {
  onFetchDropsSnapshotFromApi: (options?: TwitchApiRequestOptions) => Promise<DropsSnapshot | null>;
  onFetchInventorySnapshotFromApi?: (
    baseDrops: TwitchDrop[],
    options?: TwitchApiRequestOptions,
  ) => Promise<DropsSnapshot | null>;
  onEvaluateDropTransitions: (previousCompletedKeys: Set<string>) => Promise<void>;
  onSaveState: (state: ServiceWorkerState) => Promise<void>;
  onQueueCampaignsRemoved?: (
    result: import('./queue-availability-cleanup.ts').QueueAvailabilityCleanupResult,
  ) => Promise<void>;
}

export interface RefreshDropsDataDeps {
  replaceAvailableGames: (games: TwitchGame[]) => TwitchGame[];
  getGameDisplayLabel: (game: TwitchGame) => string;
  projectDropsSnapshot: (
    state: ServiceWorkerState,
    snapshot: DropsSnapshot,
    provenance: DropsSnapshotProvenance,
  ) => void;
  normalizeQueueSelection: (state: ServiceWorkerState, games: TwitchGame[], dropVanished?: boolean) => void;
}

export async function refreshDropsData(
  state: ServiceWorkerState,
  options: {
    includeCampaignFetch?: boolean;
    includeInventoryFetch?: boolean;
    isCurrent?: () => boolean;
    sessionRecoveryMode?: SessionRecoveryMode;
    suppressNotifications?: boolean;
  },
  callbacks: RefreshDropsDataCallbacks,
  deps: RefreshDropsDataDeps,
): Promise<RefreshDropsOutcome> {
  const isCurrent = options.isCurrent ?? (() => true);
  if (!isCurrent()) return 'transient-failure';
  const includeCampaignFetch = options.includeCampaignFetch ?? false;
  const includeInventoryFetch = options.includeInventoryFetch ?? state.appState.isRunning;
  const previousCompletedKeys = completedDropKeys(state.appState.completedDrops);
  const queueCleanup = cleanUnavailableQueueCampaigns(state);
  recordQueueCleanupActivity(state, queueCleanup);
  const previousSnapshotForClaims =
    state.cachedDropsSnapshot.length > 0 ? state.cachedDropsSnapshot : state.appState.allDrops;
  let games = state.appState.availableGames;
  let drops = state.cachedDropsSnapshot.length > 0 ? state.cachedDropsSnapshot : state.appState.allDrops;
  let apiSnapshotUsed = false;
  let refreshAttempted = false;
  let refreshSucceeded = false;
  let provenance: DropsSnapshotProvenance = 'cached';
  let campaignCatalogEmpty = false;

  if (includeCampaignFetch) {
    refreshAttempted = true;
    const apiSnapshot = await callbacks.onFetchDropsSnapshotFromApi({
      sessionRecoveryMode: options.sessionRecoveryMode,
    });
    if (!isCurrent()) return 'transient-failure';
    if (apiSnapshot) {
      refreshSucceeded = true;
      state.lastFullRefreshAt = Date.now();
      const provenanceFromSnapshot = snapshotProvenance(apiSnapshot);
      const hasAuthoritativeEmptyRewardSet =
        provenanceFromSnapshot === 'campaign-authoritative' &&
        (apiSnapshot.authoritativeCampaignIds?.length ?? 0) === 0 &&
        apiSnapshot.drops.length === 0 &&
        (apiSnapshot.games.length === 0 || apiSnapshot.games.every((game) => game.dropCount === 0));
      campaignCatalogEmpty = hasAuthoritativeEmptyRewardSet;
      games =
        apiSnapshot.games.length > 0
          ? deps.replaceAvailableGames(apiSnapshot.games)
          : hasAuthoritativeEmptyRewardSet
            ? []
            : state.appState.availableGames;
      drops = apiSnapshot.drops;
      if (apiSnapshot.drops.length > 0) {
        state.cachedDropsSnapshot = apiSnapshot.drops;
        provenance = provenanceFromSnapshot;
      } else if (hasAuthoritativeEmptyRewardSet) {
        state.cachedDropsSnapshot = [];
        provenance = provenanceFromSnapshot;
      } else if (state.cachedDropsSnapshot.length > 0) {
        drops = state.cachedDropsSnapshot;
      } else {
        provenance = provenanceFromSnapshot;
      }
      if (apiSnapshot.campaignChannelsMap) {
        state.cachedCampaignChannelsMap = apiSnapshot.campaignChannelsMap;
      }
      apiSnapshotUsed = true;
    }
  } else if (includeInventoryFetch && callbacks.onFetchInventorySnapshotFromApi) {
    const baseDrops = state.cachedDropsSnapshot.length > 0 ? state.cachedDropsSnapshot : drops;
    if (baseDrops.length > 0) {
      refreshAttempted = true;
      const inventorySnapshot = await callbacks.onFetchInventorySnapshotFromApi(baseDrops, {
        sessionRecoveryMode: options.sessionRecoveryMode,
      });
      if (!isCurrent()) return 'transient-failure';
      state.lastInventoryRefreshAt = Date.now();
      refreshSucceeded = inventorySnapshot !== null;
      if (inventorySnapshot?.drops.length) {
        drops = inventorySnapshot.drops;
        state.cachedDropsSnapshot = inventorySnapshot.drops;
        apiSnapshotUsed = true;
        provenance = 'inventory-partial';
      }
    }
  }

  if (
    !includeCampaignFetch &&
    !includeInventoryFetch &&
    drops.length === 0 &&
    state.appState.allDrops.length > 0
  ) {
    drops = state.appState.allDrops;
  }

  if (includeCampaignFetch && !apiSnapshotUsed && state.cachedDropsSnapshot.length > 0) {
    drops = state.cachedDropsSnapshot;
  }

  if (drops.length === 0 && state.appState.allDrops.length > 0 && !apiSnapshotUsed) {
    drops = state.appState.allDrops;
  }

  const isAuthoritativeEmptyCampaign =
    apiSnapshotUsed &&
    provenance === 'campaign-authoritative' &&
    campaignCatalogEmpty &&
    games.length === 0 &&
    drops.length === 0;
  if (isAuthoritativeEmptyCampaign) {
    state.appState.availableGames = [];
  }

  if (!isCurrent()) return 'transient-failure';

  deps.projectDropsSnapshot(
    state,
    {
      games,
      drops,
      updatedAt: Date.now(),
    },
    provenance,
  );
  deps.normalizeQueueSelection(state, state.appState.availableGames);

  const newlyClaimed = detectNewlyClaimedDrops(drops, previousSnapshotForClaims);
  if (newlyClaimed.length > 0) {
    await recordClaimedDrops(state, newlyClaimed);
    if (!isCurrent()) return 'transient-failure';
  }

  if (!options.suppressNotifications) {
    await callbacks.onEvaluateDropTransitions(previousCompletedKeys);
    if (!isCurrent()) return 'transient-failure';
  }
  if (!isCurrent()) return 'transient-failure';
  await callbacks.onSaveState(state);
  if (!isCurrent()) return 'transient-failure';
  await notifyQueueCleanup(queueCleanup, callbacks);
  if (!refreshAttempted || refreshSucceeded) return 'refreshed';
  if (
    options.sessionRecoveryMode === 'background-tab' &&
    (state.appState.twitchSessionSyncState.status === 'retrying' ||
      state.appState.twitchSessionSyncState.status === 'blocked')
  ) {
    return 'auth-required';
  }
  return 'transient-failure';
}
