import { gameKey, isSameGameIdentity } from '../shared/game-selection.ts';
import { isExpiredGame } from '../shared/utils.ts';
import type { TwitchGame } from '../types/index.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

export type QueueCampaignRemovalReason = 'expired' | 'unavailable';

export interface RemovedQueueCampaign {
  readonly game: TwitchGame;
  readonly reason: QueueCampaignRemovalReason;
}

export interface QueueAvailabilityCleanupResult {
  readonly removed: readonly RemovedQueueCampaign[];
  readonly selectedRemoved: boolean;
}

export interface QueueAvailabilityCleanupInput {
  readonly authoritativeGames?: readonly TwitchGame[];
  readonly authoritativeCampaignIds?: readonly string[];
  readonly now?: number;
}

function removalReason(
  game: TwitchGame,
  authoritativeGames: readonly TwitchGame[] | undefined,
  authoritativeCampaignIds: readonly string[] | undefined,
  now: number,
): QueueCampaignRemovalReason | null {
  if (isExpiredGame(game, now)) return 'expired';
  if (game.campaignId && authoritativeCampaignIds) {
    return authoritativeCampaignIds.includes(game.campaignId) ? null : 'unavailable';
  }
  if (!authoritativeGames) return null;
  return authoritativeGames.some((candidate) => isSameGameIdentity(candidate, game)) ? null : 'unavailable';
}

/** Removes only queue entries proven elapsed locally or absent from a verified inventory snapshot. */
export function cleanUnavailableQueueCampaigns(
  state: ServiceWorkerState,
  input: QueueAvailabilityCleanupInput = {},
): QueueAvailabilityCleanupResult {
  const now = input.now ?? Date.now();
  const removed: RemovedQueueCampaign[] = [];
  const retained: TwitchGame[] = [];
  for (const game of state.appState.queue) {
    const reason = removalReason(game, input.authoritativeGames, input.authoritativeCampaignIds, now);
    if (reason) {
      removed.push({ game, reason });
      delete state.appState.queueEntryMetadataByKey[gameKey(game)];
    } else {
      retained.push(game);
    }
  }
  if (removed.length === 0) return { removed, selectedRemoved: false };

  state.appState.queue = retained;
  const selectedGame = state.appState.selectedGame;
  const selectedRemoved = selectedGame
    ? removed.some(({ game }) => isSameGameIdentity(game, selectedGame))
    : false;
  if (selectedRemoved && !state.appState.isRunning) state.appState.selectedGame = null;
  return { removed, selectedRemoved };
}
