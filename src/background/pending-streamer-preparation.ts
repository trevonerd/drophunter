import { dropMatchesGame, gameKey } from '../shared/game-selection.ts';
import type { TwitchGame, WatchHealthSnapshot } from '../types/index.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { computeEffectiveStallThreshold } from './stream-rotation.ts';
import { isWatchPreparationUnavailable } from './watch-health.ts';

/** Loading is observed on the retained channel before it can become a failure. */
export function retainPendingStreamerPreparation(
  state: ServiceWorkerState,
  game: TwitchGame,
  health: WatchHealthSnapshot | null | undefined,
  evidence: ServiceWorkerState,
  now = Date.now(),
): boolean {
  const key = gameKey(game);
  const metadata = state.appState.queueEntryMetadataByKey[key];
  const attempt = metadata?.watchAttempt;
  if (!metadata || !attempt) return false;
  if (!attempt.preparing && health?.reason !== 'playback-pending') return false;
  if (attempt.preparing && (!health || isWatchPreparationUnavailable(health))) return true;
  const { preparing: _preparing, preparationProgress: _progress, ...settled } = attempt;
  const progress = evidence.appState.allDrops
    .filter((drop) => dropMatchesGame(drop, game))
    .reduce(
      (total, drop) => total + (drop.claimed ? 100 : Math.max(0, Math.min(100, drop.progress ?? 0))),
      0,
    );
  const observedAt =
    attempt.preparationProgress !== undefined && progress > attempt.preparationProgress
      ? now
      : attempt.observedAt;
  const pending =
    health?.reason === 'playback-pending' &&
    now - observedAt < computeEffectiveStallThreshold(evidence.appState.currentDrop?.requiredMinutes);
  state.appState.queueEntryMetadataByKey[key] = {
    ...metadata,
    watchAttempt: pending
      ? {
          ...settled,
          observedAt,
          preparing: true,
          preparationProgress: Math.max(progress, attempt.preparationProgress ?? 0),
        }
      : settled,
  };
  return pending;
}
