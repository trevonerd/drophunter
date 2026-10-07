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

type PlaybackSample = { time: number; advancedAt: number | null };
const playbackSamples = new WeakMap<object, PlaybackSample>();

export function resetPlaybackObservation(video: object): void {
  playbackSamples.delete(video);
}

export function isVideoPlaybackAdvancing(
  video: Pick<HTMLVideoElement, 'currentTime' | 'paused' | 'ended' | 'readyState'>,
  now = Date.now(),
): boolean {
  if (video.paused || video.ended || video.readyState < 2 || !Number.isFinite(video.currentTime)) {
    playbackSamples.delete(video);
    return false;
  }
  const previous = playbackSamples.get(video);
  if (previous && video.currentTime < previous.time) {
    playbackSamples.set(video, { time: video.currentTime, advancedAt: null });
    return false;
  }
  const advancedAt =
    previous && video.currentTime > previous.time + 0.01 ? now : (previous?.advancedAt ?? null);
  playbackSamples.set(video, { time: video.currentTime, advancedAt });
  return advancedAt !== null && now - advancedAt <= 3_000;
}

export async function observePlaybackAdvance(
  video: Pick<HTMLVideoElement, 'currentTime' | 'paused' | 'ended' | 'readyState'>,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  waitWhilePaused = false,
  isCurrent: () => boolean = () => true,
): Promise<boolean> {
  if (!isCurrent()) return false;
  if (isVideoPlaybackAdvancing(video)) return true;
  for (let attempt = 0; attempt < 8; attempt++) {
    await wait(250);
    if (!isCurrent()) return false;
    if (isVideoPlaybackAdvancing(video)) return true;
    if (video.ended || (video.paused && !waitWhilePaused)) return false;
  }
  return false;
}

export async function startMutedPlayback(
  video: PlayableVideo,
  isCurrent: () => boolean = () => true,
): Promise<{ played: boolean; error?: unknown }> {
  if (!isCurrent()) return { played: false };
  if (!video.paused) return { played: true };
  video.muted = true;
  const play = async () => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        video.play(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new DOMException('Playback did not start', 'TimeoutError')),
            2_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  };
  try {
    await play();
    return { played: isCurrent() };
  } catch {
    if (!isCurrent()) return { played: false };
    video.muted = true;
    try {
      await play();
      return { played: isCurrent() };
    } catch (error) {
      return { played: false, error };
    }
  }
}
