import { gameKey, getGameDisplayLabel } from '../shared/game-selection.ts';
import type { TwitchGame } from '../types/index.ts';
import { recordAutomationActivity } from './automation-activity.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import type { QueueSkipReason } from './session-lifecycle-types.ts';

export type QueueRecoveryReason = Extract<
  QueueSkipReason,
  'no-streamers' | 'directory-unavailable' | 'stalled-progress'
>;

export function isQueueRecoveryReason(reason: QueueSkipReason): reason is QueueRecoveryReason {
  return reason === 'no-streamers' || reason === 'directory-unavailable' || reason === 'stalled-progress';
}

function failureMessage(reason: QueueRecoveryReason, game: TwitchGame): string {
  const label = getGameDisplayLabel(game);
  switch (reason) {
    case 'no-streamers':
      return `No eligible streamer was found for ${label} after repeated attempts`;
    case 'directory-unavailable':
      return `Twitch streamer search remained unavailable for ${label} after repeated attempts`;
    case 'stalled-progress':
      return `Drop progress did not resume for ${label} after repeated attempts`;
  }
}

export function recordQueueRecoveryActivity(
  state: ServiceWorkerState,
  game: TwitchGame,
  reason: QueueRecoveryReason,
  outcome: { readonly kind: 'advanced'; readonly nextGame: TwitchGame } | { readonly kind: 'stopped' },
  now = Date.now(),
): void {
  const failure = failureMessage(reason, game);
  const message =
    outcome.kind === 'advanced'
      ? `${failure}, so DropHunter moved to ${getGameDisplayLabel(outcome.nextGame)}.`
      : `${failure}. DropHunter stopped because no other campaign can be farmed right now. Favorite auto-start remains available when enabled.`;
  recordAutomationActivity(state.appState, {
    id: `queue-recovery:${reason}:${gameKey(game)}:${now}`,
    kind: outcome.kind === 'advanced' ? 'queue-campaign-skipped' : 'queue-retries-exhausted',
    at: now,
    campaignId: game.campaignId ?? game.id,
    message,
  });
}
