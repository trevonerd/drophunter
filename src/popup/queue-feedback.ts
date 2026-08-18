import type { SetStateAction } from 'react';

export interface QueueFeedbackState {
  readonly message: string | null;
  readonly occurrence: number;
}

export const INITIAL_QUEUE_FEEDBACK_STATE: QueueFeedbackState = {
  message: null,
  occurrence: 0,
};

export function publishQueueFeedback(
  state: QueueFeedbackState,
  action: SetStateAction<string | null>,
): QueueFeedbackState {
  const message = typeof action === 'function' ? action(state.message) : action;
  return { message, occurrence: state.occurrence + 1 };
}
