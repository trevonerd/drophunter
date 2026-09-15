import { logContentDebug, logContentWarn } from './logging.ts';
import {
  canAttemptPageUnmute,
  isExpectedTwitchPlaybackInterruption,
  startMutedPlayback,
} from './playback.ts';
import { extractChannelNameFromPath, normalizeForCompare } from './stream-context.ts';

export async function prepareStreamPlayback() {
  const channelName = extractChannelNameFromPath();
  const hasUserActivation = navigator.userActivation?.hasBeenActive === true;
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
  let clickedSurface = false;

  const clickElement = (element: Element | null | undefined) => {
    if (!element) {
      return;
    }
    const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true });
    const mouseUp = new MouseEvent('mouseup', { bubbles: true, cancelable: true, composed: true });
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
    element.dispatchEvent(mouseDown);
    element.dispatchEvent(mouseUp);
    element.dispatchEvent(click);
    clickedSurface = true;
  };

  const playerSurface =
    (document.querySelector('[data-a-target="video-player"]') as HTMLElement | null) ||
    (document.querySelector('[data-a-player-state]') as HTMLElement | null) ||
    (document.querySelector('div[data-test-selector*="video-player"]') as HTMLElement | null);
  if (playerSurface) {
    clickElement(playerSurface);
  }

  const playPauseButton = document.querySelector(
    '[data-a-target="player-play-pause-button"]',
  ) as HTMLButtonElement | null;
  if (playPauseButton) {
    const label = normalizeForCompare(
      playPauseButton.getAttribute('aria-label') ?? playPauseButton.textContent ?? '',
    );
    if (label.includes('play')) {
      playPauseButton.click();
      played = true;
    }
  }

  const muteButton = document.querySelector(
    '[data-a-target="player-mute-unmute-button"]',
  ) as HTMLButtonElement | null;
  if (muteButton) {
    const label = normalizeForCompare(muteButton.getAttribute('aria-label') ?? muteButton.textContent ?? '');
    if (label.includes('unmute') && canAttemptPageUnmute(hasUserActivation)) {
      muteButton.click();
    }
  }

  const overlayUnmuteButton = document.querySelector(
    '[data-a-target="player-overlay-mute-unmute-button"]',
  ) as HTMLButtonElement | null;
  if (overlayUnmuteButton) {
    const label = normalizeForCompare(
      overlayUnmuteButton.getAttribute('aria-label') ?? overlayUnmuteButton.textContent ?? '',
    );
    if (label.includes('unmute') && canAttemptPageUnmute(hasUserActivation)) {
      overlayUnmuteButton.click();
    }
  }

  const video = document.querySelector('video') as HTMLVideoElement | null;
  if (video) {
    clickElement(video);
    if (video.muted && canAttemptPageUnmute(hasUserActivation)) {
      video.muted = false;
    }
    if (video.volume <= 0.01) {
      video.volume = 0.35;
    }
    if (video.paused) {
      const playback = await startMutedPlayback(video);
      if (playback.played) {
        played = true;
      } else if (isExpectedTwitchPlaybackInterruption(playback.error)) {
        logContentDebug('Playback retry interrupted by Twitch player replacement');
      } else if (__DROPHUNTER_DEBUG_LOGS__) {
        const error = playback.error;
        logContentWarn('Muted playback failed:', error instanceof Error ? error.message : String(error), {
          hasBeenActive: hasUserActivation,
        });
      }
    }
  }

  const isPlaybackReady = Boolean(video && !video.paused);
  const userInteractionRequired = Boolean(video?.paused);
  return { played, clickedSurface, isPlaybackReady, gateDismissed: false, userInteractionRequired };
}
