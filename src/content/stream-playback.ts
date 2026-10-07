import { logContentDebug, logContentWarn } from './logging.ts';
import {
  isExpectedTwitchPlaybackInterruption,
  observePlaybackAdvance,
  startMutedPlayback,
} from './playback.ts';
import {
  extractChannelNameFromPath,
  isStreamNavigationPending,
  normalizeForCompare,
} from './stream-context.ts';

let playbackPreparationRevision = 0;

export async function prepareStreamPlayback() {
  const revision = ++playbackPreparationRevision;
  const pageUrl = window.location.href;
  const channelName = extractChannelNameFromPath();
  const hasUserActivation = navigator.userActivation?.hasBeenActive === true;
  if (isStreamNavigationPending()) return { isPlaybackReady: false, playbackPending: true };
  if (!channelName) {
    return {
      played: false,
      clickedSurface: false,
      isPlaybackReady: false,
      gateDismissed: false,
      userInteractionRequired: false,
    };
  }
  document.documentElement.dataset.drophunterKeepalive = '1';
  const isCurrent = () =>
    revision === playbackPreparationRevision &&
    window.location.href === pageUrl &&
    document.documentElement.dataset.drophunterKeepalive === '1';
  const suspendedResult = () => ({
    played: false,
    clickedSurface: false,
    isPlaybackReady: false,
    gateDismissed: false,
    userInteractionRequired: false,
    playbackPending: false,
  });

  // Auto-dismiss mature content warning gate
  const gateButton =
    (document.querySelector(
      'button[data-a-target="content-classification-gate-overlay-start-watching-button"]',
    ) as HTMLButtonElement | null) ||
    (Array.from(document.querySelectorAll('button')).find((btn) =>
      normalizeForCompare(btn.textContent ?? '').includes('start watching'),
    ) as HTMLButtonElement | undefined) ||
    null;

  if (gateButton) {
    const clickEvt = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
    gateButton.dispatchEvent(clickEvt);
    return {
      played: false,
      clickedSurface: false,
      isPlaybackReady: false,
      gateDismissed: true,
      userInteractionRequired: false,
    };
  }

  let played = false;
  let userInteractionRequired = false;
  let playbackError: unknown;
  let hadPausedPlayControl = false;
  const video = document.querySelector('video') as HTMLVideoElement | null;
  if (video) {
    if (video.paused) {
      const playControl = document.querySelector<HTMLButtonElement>(
        'button[data-a-target="player-play-pause-button"][data-a-player-state="paused"]',
      );
      if (video.isConnected && playControl?.isConnected && document.querySelector('video') === video) {
        hadPausedPlayControl = true;
        video.muted = true;
        try {
          playControl.click();
          played = await observePlaybackAdvance(video, undefined, true, isCurrent);
        } catch (error) {
          playbackError = error;
          userInteractionRequired = error instanceof DOMException && error.name === 'NotAllowedError';
        }
      }
    }
    if (!isCurrent()) return suspendedResult();
    if (video.paused && !played && !userInteractionRequired) {
      const playback = await startMutedPlayback(
        video,
        () => isCurrent() && document.querySelector('video') === video,
      );
      if (!isCurrent()) return suspendedResult();
      playbackError = playback.error;
      if (playback.played) {
        played = true;
      } else if (playbackError instanceof DOMException && playbackError.name === 'NotAllowedError') {
        userInteractionRequired = true;
      } else if (isExpectedTwitchPlaybackInterruption(playbackError)) {
        logContentDebug('Playback retry interrupted by Twitch player');
      } else if (__DROPHUNTER_DEBUG_LOGS__) {
        logContentWarn(
          'Muted playback failed:',
          playbackError instanceof Error ? playbackError.message : String(playbackError),
          {
            hasBeenActive: hasUserActivation,
          },
        );
      }
    }
  }

  const isPlaybackReady =
    video && document.querySelector('video') === video
      ? await observePlaybackAdvance(video, undefined, false, isCurrent)
      : false;
  if (!isCurrent()) return suspendedResult();
  // Twitch can enforce its initial gesture by pausing a native play request.
  // Native play can change the control's state before the site pauses the video.
  if (
    !isPlaybackReady &&
    navigator.userActivation?.hasBeenActive !== true &&
    video?.paused &&
    video.readyState >= 2 &&
    document.querySelector('video') === video &&
    playbackError instanceof DOMException &&
    playbackError.name === 'AbortError' &&
    /interrupted by a call to pause/i.test(playbackError.message) &&
    hadPausedPlayControl
  ) {
    userInteractionRequired = true;
  }
  return {
    played,
    clickedSurface: false,
    isPlaybackReady,
    gateDismissed: false,
    userInteractionRequired,
    playbackPending:
      !isPlaybackReady &&
      !userInteractionRequired &&
      (!video ||
        (!video.ended &&
          (playbackError === undefined || isExpectedTwitchPlaybackInterruption(playbackError)))),
  };
}
