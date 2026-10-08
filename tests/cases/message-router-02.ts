import { describe, expect, test } from 'bun:test';
import { createRuntimeMessageListener } from '../../src/background/message-router.ts';
import { callListener, createHandlers } from '../support/message-router-fixtures.ts';

describe('runtime message router', () => {
  test('rejects unknown messages without invoking handlers', async () => {
    const listener = createRuntimeMessageListener(createHandlers());

    const result = await callListener(listener, { type: 'NOT_A_REAL_MESSAGE' });

    expect(result.keepChannelOpen).toBe(true);
    expect(result.response).toEqual({ success: false, error: 'Unknown message type' });
  });

  test('rejects critical messages with malformed payloads before invoking handlers', async () => {
    let startCalled = false;
    let syncCalled = false;
    const listener = createRuntimeMessageListener(
      createHandlers({
        startFarming: async () => {
          startCalled = true;
          return { success: true };
        },
        syncTwitchIntegrity: async () => {
          syncCalled = true;
          return { success: true };
        },
      }),
    );

    const start = await callListener(listener, { type: 'START_FARMING', payload: { game: null } });
    const integrity = await callListener(listener, {
      type: 'SYNC_TWITCH_INTEGRITY',
      payload: { token: 123 },
    });

    expect(start.response).toEqual({ success: false, error: 'Invalid message payload' });
    expect(integrity.response).toEqual({ success: false, error: 'Invalid message payload' });
    expect(startCalled).toBe(false);
    expect(syncCalled).toBe(false);
  });

  test('rejects messages that are not handled by the background service worker', async () => {
    const listener = createRuntimeMessageListener(createHandlers());

    const result = await callListener(listener, { type: 'GET_STREAM_CONTEXT' });

    expect(result.keepChannelOpen).toBe(true);
    expect(result.response).toEqual({ success: false, error: 'Unsupported message target' });
  });
});
