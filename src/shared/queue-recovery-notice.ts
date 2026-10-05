import type { AppState } from '../types/index.ts';
import { campaignRejectionReason } from './campaign-eligibility.ts';
import { gameKey, getGameDisplayLabel } from './game-selection.ts';
import { formatRetryLabel } from './runtime-status.ts';

const reasons = {
  'no-streamers': 'No eligible streamer available',
  'open-failed': 'Eligible stream playback could not start',
  'directory-unavailable': 'Streamer directory unavailable',
  'stalled-progress': 'Twitch progress is not advancing',
};

/** Current unresolved campaigns, independent of the bounded activity history. */
export function queueRecoveryNotice(state: AppState, now = Date.now()) {
  const seen = new Set<string>();
  const entries = state.queue.flatMap((queued) => {
    const key = gameKey(queued);
    if (seen.has(key)) return [];
    seen.add(key);
    const game = state.availableGames.find((candidate) => gameKey(candidate) === key) ?? queued;
    if (campaignRejectionReason(game, now) !== null) return [];
    const metadata = state.queueEntryMetadataByKey[key];
    const reason =
      metadata?.streamerRetryReason ?? (state.stalledCampaignBlocksByKey[key] ? 'stalled-progress' : null);
    if (!reason) return [];
    const round = state.queueAcquisitionRound;
    const selected = state.selectedGame !== null && gameKey(state.selectedGame) === key;
    const afterRound = round?.nextRoundAt == null && !selected;
    const nextRetryAt =
      round?.nextRoundAt ?? (afterRound || state.activeStreamer ? null : (metadata?.streamerRetryAt ?? null));
    return [
      {
        key,
        label: getGameDisplayLabel(game),
        reason: reasons[reason],
        nextRetryAt,
        retry: state.isPaused
          ? 'Paused'
          : state.lastStopReason === 'user-stop' || !state.isRunning
            ? 'Waiting for Start'
            : afterRound
              ? 'After the current queue round'
              : (formatRetryLabel(nextRetryAt, now) ?? 'Attempt in progress'),
      },
    ];
  });
  return entries;
}
