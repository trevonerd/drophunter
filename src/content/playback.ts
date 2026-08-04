export function canAttemptPageUnmute(hasUserActivation: boolean): boolean {
  return hasUserActivation;
}

export function isExpectedTwitchPlaybackInterruption(error: unknown): boolean {
  if (!(error instanceof DOMException) || error.name !== 'AbortError') {
    return false;
  }

  return /media was removed from the document|interrupted by a new load request|interrupted by a call to pause/i.test(
    error.message,
  );
}

export interface PlayableVideo {
  muted: boolean;
  paused: boolean;
  play(): Promise<void>;
}

export async function startMutedPlayback(
  video: PlayableVideo,
): Promise<{ played: boolean; error?: unknown }> {
  if (!video.paused) return { played: true };
  try {
    await video.play();
    return { played: true };
  } catch {
    video.muted = true;
    try {
      await video.play();
      return { played: true };
    } catch (error) {
      return { played: false, error };
    }
  }
}
