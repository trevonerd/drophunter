import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { INITIAL_QUEUE_FEEDBACK_STATE, publishQueueFeedback } from '../src/popup/queue-feedback';

const source = readFileSync(new URL('../src/popup/hooks/usePopupActions.ts', import.meta.url), 'utf8');

test('queue feedback dismisses after six seconds and restarts for every publication', () => {
  expect(source).toContain('const QUEUE_MESSAGE_DISMISS_MS = 6_000;');
  expect(source).toContain('globalThis.setTimeout(() => setQueueMessage(null), QUEUE_MESSAGE_DISMISS_MS)');
  expect(source).toContain('return () => globalThis.clearTimeout(timeout);');
  expect(source).toContain('[queueMessage, queueMessageOccurrence]');
});

test('identical queue feedback publications have distinct occurrences', () => {
  const first = publishQueueFeedback(INITIAL_QUEUE_FEEDBACK_STATE, 'Added 1 campaign to queue.');
  const second = publishQueueFeedback(first, 'Added 1 campaign to queue.');

  expect(second.message).toBe(first.message);
  expect(second.occurrence).toBe(first.occurrence + 1);
});
