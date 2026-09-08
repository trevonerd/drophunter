import { gameKey } from '../shared/game-selection.ts';
import type { TwitchGame } from '../types/index.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

export function isAutomaticFavoriteSession(state: ServiceWorkerState, campaign: TwitchGame | null): boolean {
  return (
    campaign !== null &&
    !state.appState.manualQueueAuthorized &&
    state.appState.farmingSessionOrigin === 'automatic'
  );
}

export function parkBlockedCampaignAtQueueTail(state: ServiceWorkerState, campaign: TwitchGame): void {
  const key = gameKey(campaign);
  const metadata = state.appState.queueEntryMetadataByKey[key];
  state.appState.queue = [...state.appState.queue.filter((queued) => gameKey(queued) !== key), campaign];
  if (metadata) state.appState.queueEntryMetadataByKey[key] = metadata;
}

export function rotateBlockedQueueHead(state: ServiceWorkerState): void {
  const [head, ...tail] = state.appState.queue;
  if (head) state.appState.queue = [...tail, head];
}
