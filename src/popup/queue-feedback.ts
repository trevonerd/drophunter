import type { SetStateAction } from 'react';

export interface QueueFeedbackState {
  readonly message: string | null;
  readonly occurrence: number;
}

export const INITIAL_QUEUE_FEEDBACK_STATE: QueueFeedbackState = {
  message: null,
  occurrence: 0,
};

export const QUEUE_MESSAGE_DISMISS_MS = 6_000;

export function scheduleQueueFeedbackDismissal<TimeoutHandle>(
  dismiss: () => void,
  schedule: (callback: () => void, delayMs: number) => TimeoutHandle,
  cancel: (timeout: TimeoutHandle) => void,
): () => void {
  const timeout = schedule(dismiss, QUEUE_MESSAGE_DISMISS_MS);
  return () => cancel(timeout);
}

export function publishQueueFeedback(
  state: QueueFeedbackState,
  action: SetStateAction<string | null>,
): QueueFeedbackState {
  const message = typeof action === 'function' ? action(state.message) : action;
  return { message, occurrence: state.occurrence + 1 };
}
