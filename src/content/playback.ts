export function canAttemptPageUnmute(hasUserActivation: boolean): boolean {
  return hasUserActivation;
}

export function isExpectedTwitchPlaybackInterruption(error: unknown): boolean {
  if (!(error instanceof DOMException) || error.name !== 'AbortError') {
    return false;
  }

  return /media was removed from the document|interrupted by a new load request/i.test(error.message);
}
