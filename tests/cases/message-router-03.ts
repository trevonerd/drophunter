import { describe, expect, test } from 'bun:test';
import { createRuntimeMessageListener } from '../../src/background/message-router.ts';
import { callListener, createHandlers } from '../support/message-router-fixtures.ts';

describe('runtime message router', () => {
  test('dispatches REORDER_QUEUE to the reorder handler', async () => {
    let reorderCalled = false;
    const listener = createRuntimeMessageListener(
      createHandlers({
        reorderQueue: async (message) => {
          reorderCalled = true;
          expect(message.payload).toEqual({ fromIndex: 1, toIndex: 0 });
          return { success: true, reordered: true };
        },
      }),
    );

    const result = await callListener(listener, {
      type: 'REORDER_QUEUE',
      payload: { fromIndex: 1, toIndex: 0 },
    });

    expect(reorderCalled).toBe(true);
    expect(result.response).toEqual({ success: true, reordered: true });
  });

  test('rejects malformed REORDER_QUEUE payloads before invoking handlers', async () => {
    let reorderCalled = false;
    const listener = createRuntimeMessageListener(
      createHandlers({
        reorderQueue: async () => {
          reorderCalled = true;
          return { success: true };
        },
      }),
    );

    const result = await callListener(listener, {
      type: 'REORDER_QUEUE',
      payload: { fromIndex: 0, toIndex: 0 },
    });

    expect(result.response).toEqual({ success: false, error: 'Invalid message payload' });
    expect(reorderCalled).toBe(false);
  });
});
