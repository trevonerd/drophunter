import type { AppState, TwitchGame } from '../types/index.ts';
import { gameKey } from './game-selection.ts';
import { isTwitchGameLike } from './message-validation.ts';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeStoredGame(value: unknown): TwitchGame | null {
  if (!isRecord(value)) return null;
  // Older snapshots can carry a stale boolean alongside an authoritative reward summary.
  // Repair the redundant boolean instead of deleting the campaign and its queue position.
  const completion = isRecord(value.rewardSummary) ? value.rewardSummary.completion : undefined;
  const candidate =
    completion === 'all-acquired' || completion === 'farmable' || completion === 'farming-complete'
      ? { ...value, allDropsCompleted: completion === 'all-acquired' }
      : value;
  return isTwitchGameLike(candidate) ? candidate : null;
}

export function normalizeStoredGames(value: unknown): TwitchGame[] {
  return Array.isArray(value)
    ? value.map(normalizeStoredGame).filter((game): game is TwitchGame => game !== null)
    : [];
}

export function normalizeCampaignFailureEpisodes(value: unknown): AppState['campaignFailureEpisodesByKey'] {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.values(value).flatMap((episode) => {
      if (
        !isRecord(episode) ||
        typeof episode.id !== 'string' ||
        !episode.id.startsWith('campaign-failure:') ||
        typeof episode.reason !== 'string' ||
        typeof episode.startedAt !== 'number' ||
        !Number.isFinite(episode.startedAt) ||
        typeof episode.lastAttemptAt !== 'number' ||
        !Number.isFinite(episode.lastAttemptAt)
      )
        return [];
      const game = normalizeStoredGame(episode.game);
      return game
        ? [
            [
              gameKey(game),
              {
                id: episode.id,
                game,
                reason: episode.reason,
                startedAt: episode.startedAt,
                lastAttemptAt: episode.lastAttemptAt,
                visible: episode.visible !== false && episode.exhausted === true,
                exhausted: episode.exhausted === true,
              },
            ],
          ]
        : [];
    }),
  );
}

export const RECOVERY_REASONS = new Set([
  'twitch-auth',
  'twitch-integrity',
  'twitch-network',
  'twitch-rate-limit',
  'twitch-invalid-response',
  'twitch-data-unavailable',
  'stalled-progress',
  'open-failed',
  'directory-unavailable',
  'no-streamers',
  'drops-inactive',
  'wrong-game',
  'wrong-channel',
  'offline',
  'rewards-pending',
]);

export const STOP_REASONS = new Set([
  'user-stop',
  'queue-complete',
  'farming-complete',
  'sign-in-required',
  'stall-skipped',
  'queue-retries-exhausted',
  'no-active-campaigns',
  'unverifiable-twitch',
]);
