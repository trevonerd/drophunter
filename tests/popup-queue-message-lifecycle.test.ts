import { expect, test } from 'bun:test';
import {
  INITIAL_QUEUE_FEEDBACK_STATE,
  publishQueueFeedback,
  QUEUE_MESSAGE_DISMISS_MS,
  scheduleQueueFeedbackDismissal,
} from '../src/popup/queue-feedback';

test('queue feedback dismisses after six seconds and restarts for every publication', () => {
  let scheduledCallback: () => void = () => undefined;
  let scheduledDelay = 0;
  const cancelledTimeouts: number[] = [];
  const events: string[] = [];

  const cleanup = scheduleQueueFeedbackDismissal(
    () => events.push('dismissed'),
    (callback, delayMs) => {
      scheduledCallback = callback;
      scheduledDelay = delayMs;
      return 42;
    },
    (timeout) => cancelledTimeouts.push(timeout),
  );

  expect(scheduledDelay).toBe(QUEUE_MESSAGE_DISMISS_MS);
  scheduledCallback();
  expect(events).toEqual(['dismissed']);
  cleanup();
  expect(cancelledTimeouts).toEqual([42]);
});

test('identical queue feedback publications have distinct occurrences', () => {
  const first = publishQueueFeedback(INITIAL_QUEUE_FEEDBACK_STATE, 'Added 1 campaign to queue.');
  const second = publishQueueFeedback(first, 'Added 1 campaign to queue.');

  expect(second.message).toBe(first.message);
  expect(second.occurrence).toBe(first.occurrence + 1);
});
