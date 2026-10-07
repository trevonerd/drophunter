import type { AppState } from '../types/index.ts';
import { gameKey, getGameDisplayLabel } from './game-selection.ts';

export function farmingMessages(state: AppState) {
  const messages: { id: string; kind: 'info' | 'warning'; text: string }[] = [];
  if (state.isRunning && !state.isPaused && state.watchHealth?.reason === 'user-interaction-required') {
    const selectedKey = state.selectedGame ? gameKey(state.selectedGame) : 'current';
    const attempt = state.queueEntryMetadataByKey[selectedKey]?.watchAttempt;
    messages.push({
      id: `playback-gesture:${selectedKey}:${attempt?.observedAt ?? state.tabId ?? 0}`,
      kind: 'info',
      text: 'Click Play in the Twitch tab to start the video. DropHunter will check reward progress automatically.',
    });
  }
  if (
    state.twitchSessionSyncState.status === 'retrying' &&
    (!state.twitchSessionDetected || state.recoveryReason === 'twitch-auth')
  )
    messages.push({
      id: 'sign-in-required',
      kind: 'info',
      text: 'Sign in to Twitch. DropHunter will resume the authorized queue when your session is verified.',
    });
  for (const episode of Object.values(state.campaignFailureEpisodesByKey)) {
    if (!episode.visible) continue;
    messages.push({
      id: episode.id,
      kind: 'warning',
      text: `${getGameDisplayLabel(episode.game)}: farming could not advance with the available streamers. This campaign stays queued for retry.`,
    });
  }
  return messages.filter((message) => !state.dismissedFarmingMessageIds.includes(message.id));
}
