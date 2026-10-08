import { describe, expect, test } from 'bun:test';
import { createRuntimeMessageListener } from '../../src/background/message-router.ts';
import { callListener, createHandlers } from '../support/message-router-fixtures.ts';

describe('runtime message router', () => {
  test('waits for initialization before dispatching a valid message', async () => {
    let releaseInitialization: () => void = () => undefined;
    const initialization = new Promise<void>((resolve) => {
      releaseInitialization = resolve;
    });
    let handlerCalled = false;
    const listener = createRuntimeMessageListener(
      createHandlers({
        syncTwitchIntegrity: async () => {
          handlerCalled = true;
          return { success: true };
        },
      }),
      { beforeHandle: () => initialization },
    );

    const response = callListener(
      listener,
      { type: 'SYNC_TWITCH_INTEGRITY', payload: { token: 'fresh-integrity-token' } },
      {
        tab: {
          id: 1,
          index: 0,
          windowId: 1,
          url: 'https://www.twitch.tv/drops/campaigns',
          pinned: false,
          highlighted: true,
          active: true,
          frozen: false,
          incognito: false,
          selected: true,
          discarded: false,
          autoDiscardable: true,
          groupId: -1,
          lastAccessed: Date.now(),
        },
      },
    );
    await Promise.resolve();

    expect(handlerCalled).toBe(false);
    releaseInitialization();
    expect((await response).response).toEqual({ success: true });
    expect(handlerCalled).toBe(true);
  });

  test('does not dispatch a valid message when initialization fails', async () => {
    let handlerCalled = false;
    const listener = createRuntimeMessageListener(
      createHandlers({
        setMonitorAutoOpen: async () => {
          handlerCalled = true;
          return { success: true };
        },
      }),
      {
        beforeHandle: async () => {
          throw new Error('storage migration failed');
        },
      },
    );

    const result = await callListener(listener, {
      type: 'SET_MONITOR_AUTO_OPEN',
      payload: { enabled: false },
    });

    expect(handlerCalled).toBe(false);
    expect(result.response).toEqual({ success: false, error: 'Error: storage migration failed' });
  });
});
