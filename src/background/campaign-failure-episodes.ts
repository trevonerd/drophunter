import { gameKey, getGameDisplayLabel } from '../shared/game-selection.ts';
import type { TwitchGame } from '../types/index.ts';
import type { AutomationEventNotification } from './automation-event-notifier.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { MAX_STREAMER_ATTEMPTS } from './streamer-watch-attempt.ts';

export function recordCampaignFailure(
  state: ServiceWorkerState,
  game: TwitchGame,
  reason: string,
  now = Date.now(),
): AutomationEventNotification | null {
  const key = gameKey(game);
  const attempted = state.appState.queueEntryMetadataByKey[key]?.attemptedStreamerNames ?? [];
  if (
    new Set(attempted.map((name) => name.trim().toLowerCase()).filter(Boolean)).size < MAX_STREAMER_ATTEMPTS
  )
    return null;
  const previous = state.appState.campaignFailureEpisodesByKey[key];
  const qualified = previous?.exhausted === true ? previous : undefined;
  const episode = {
    id: qualified?.id ?? `campaign-failure:${key}:${globalThis.crypto.randomUUID()}`,
    game,
    reason,
    startedAt: qualified?.startedAt ?? now,
    lastAttemptAt: now,
    visible: true,
    exhausted: true,
  };
  state.appState.campaignFailureEpisodesByKey[key] = episode;
  if (previous?.visible === false)
    state.appState.dismissedFarmingMessageIds = state.appState.dismissedFarmingMessageIds.filter(
      (id) => id !== episode.id,
    );
  return {
    transitionId: episode.id,
    event: 'recovery',
    campaignId: game.campaignId ?? key,
    title: 'Campaign waiting for retry',
    telegramReason: 'recovery',
    message: `Unable to farm ${getGameDisplayLabel(game)} with the available streamers. DropHunter continues the queue and will retry this campaign.`,
  };
}
