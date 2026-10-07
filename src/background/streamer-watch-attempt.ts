import { gameKey } from '../shared/game-selection.ts';
import type { QueueEntryMetadata, TwitchGame, TwitchStreamer } from '../types/index.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

export const MAX_STREAMER_ATTEMPTS = 4;

export function streamerCandidatesForWatchAttempt(
  streamers: readonly TwitchStreamer[],
  metadata: QueueEntryMetadata | undefined,
): TwitchStreamer[] {
  const watch = metadata?.watchAttempt;
  const retained =
    watch?.preparing || watch?.suspendedAt !== undefined
      ? streamers.filter((streamer) => streamer.name.trim().toLowerCase() === watch.channelName)
      : [];
  if (retained.length) return retained;
  return streamers.filter((streamer) => {
    const name = streamer.name.trim().toLowerCase();
    return (
      !(metadata?.attemptedStreamerNames ?? []).includes(name) ||
      (watch?.channelName === name && watch.suspendedAt !== undefined)
    );
  });
}

type WatchAttempt = NonNullable<QueueEntryMetadata['watchAttempt']>;

/** Shifts observation clocks past the suspended interval. */
function resumedAttempt({ suspendedAt, ...attempt }: WatchAttempt, now: number): WatchAttempt {
  const elapsed = Math.max(0, now - (suspendedAt ?? now));
  return {
    ...attempt,
    observedAt: attempt.observedAt + elapsed,
    ...(attempt.firstPlaybackAt !== undefined ? { firstPlaybackAt: attempt.firstPlaybackAt + elapsed } : {}),
  };
}

export function beginStreamerWatchAttempt(
  state: ServiceWorkerState,
  game: TwitchGame,
  channel: string,
  now = Date.now(),
): boolean {
  const key = gameKey(game);
  const metadata = state.appState.queueEntryMetadataByKey[key] ?? {
    source: 'manual',
    addedAt: now,
    reason: 'user-added',
  };
  const name = channel.trim().toLowerCase();
  const attempted = metadata.attemptedStreamerNames ?? [];
  const interrupted = metadata.watchAttempt;
  if (name && attempted.includes(name) && interrupted?.channelName === name) {
    if (interrupted.suspendedAt !== undefined) {
      state.appState.queueEntryMetadataByKey[key] = {
        ...metadata,
        watchAttempt: resumedAttempt(interrupted, now),
      };
      return true;
    }
    if (interrupted.preparing) return true;
  }
  if (!name || attempted.includes(name) || attempted.length >= MAX_STREAMER_ATTEMPTS) return false;
  state.appState.queueEntryMetadataByKey[key] = {
    ...metadata,
    attemptedStreamerNames: [...attempted, name],
    watchAttempt: { channelName: name, observedAt: now },
  };
  return true;
}

export function suspendWatchObservation(state: ServiceWorkerState, now = Date.now()): void {
  const game = state.appState.selectedGame;
  const active = state.appState.activeStreamer;
  if (!game || !active || state.appState.recoveryReason || state.appState.watchHealth?.shouldFallback) return;
  const key = gameKey(game);
  const metadata = state.appState.queueEntryMetadataByKey[key];
  if (metadata?.watchAttempt?.channelName === active.name.trim().toLowerCase())
    state.appState.queueEntryMetadataByKey[key] = {
      ...metadata,
      watchAttempt: {
        ...metadata.watchAttempt,
        suspendedAt: metadata.watchAttempt.suspendedAt ?? now,
      },
    };
}

export function resumeWatchObservation(state: ServiceWorkerState, now: number): void {
  const game = state.appState.selectedGame;
  const metadata = game ? state.appState.queueEntryMetadataByKey[gameKey(game)] : undefined;
  const attempt = metadata?.watchAttempt;
  if (!game || !metadata || !attempt?.suspendedAt) return;
  state.appState.queueEntryMetadataByKey[gameKey(game)] = {
    ...metadata,
    watchAttempt: resumedAttempt(attempt, now),
  };
  if (state.lastProgressAdvanceAt > 0) state.lastProgressAdvanceAt += Math.max(0, now - attempt.suspendedAt);
}

export function watchObservationStartedAt(state: ServiceWorkerState): number {
  const selected = state.appState.selectedGame;
  const attempt = selected ? state.appState.queueEntryMetadataByKey[gameKey(selected)]?.watchAttempt : null;
  return Math.max(state.lastProgressAdvanceAt, attempt?.firstPlaybackAt ?? attempt?.observedAt ?? 0);
}
