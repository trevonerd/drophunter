import { expect, test } from 'bun:test';
import { createPlaybackTransport } from '../src/background/playback-transport.ts';

function fixture(response: () => Promise<unknown>, ensure: () => Promise<void> = async () => {}) {
  let requests = 0;
  let updates = 0;
  const transport = createPlaybackTransport({
    ensureContentScriptOnTab: ensure,
    ensureManagedTab: async () => 20,
    waitForTabComplete: async () => {},
    tabsApi: {
      get: async () => ({ id: 20 }),
      update: async () => {
        updates++;
      },
      sendMessage: async () => {
        requests++;
        return response();
      },
    },
  });
  return { transport, requests: () => requests, updates: () => updates };
}

test.each([
  'Could not establish connection. Receiving end does not exist.',
  'The page keeping the extension port is moved into back/forward cache, so the message channel is closed.',
])('a newly loaded tab retries a transient content channel failure: %s', async (message) => {
  let attempts = 0;
  let injections = 0;
  const { transport, requests } = fixture(
    async () => {
      if (++attempts === 1) throw new Error(message);
      return { isPlaybackReady: true };
    },
    async () => {
      injections += 1;
    },
  );
  expect(await transport.prepare(20)).toMatchObject({ isPlaybackReady: true });
  expect(requests()).toBe(2);
  expect(injections).toBe(2);
});

test('the same cold player can become ready after the old ten-second deadline', async () => {
  const previousTimeout = globalThis.setTimeout;
  const previousNow = Date.now;
  let now = 1_000;
  Object.defineProperty(globalThis, 'setTimeout', {
    configurable: true,
    value: (callback: () => void, milliseconds: number) => {
      if (milliseconds !== 500) return previousTimeout(callback, milliseconds);
      now += milliseconds;
      callback();
      return 1;
    },
  });
  Date.now = () => now;
  try {
    const { transport, requests } = fixture(async () =>
      now < 13_000 ? { isPlaybackReady: false, playbackPending: true } : { isPlaybackReady: true },
    );
    expect(await transport.prepare(20)).toMatchObject({ isPlaybackReady: true });
    expect(requests()).toBe(25);
    expect(now).toBe(13_000);
  } finally {
    globalThis.setTimeout = previousTimeout;
    Date.now = previousNow;
  }
});

test('Stop after a missing receiver prevents reinjection and retry', async () => {
  let current = true;
  let injections = 0;
  const { transport, requests } = fixture(
    async () => {
      current = false;
      throw new Error('Could not establish connection. Receiving end does not exist.');
    },
    async () => {
      injections += 1;
    },
  );
  expect(await transport.prepare(20, { isCurrent: () => current })).toEqual({});
  expect(requests()).toBe(1);
  expect(injections).toBe(1);
});

test('cancelled pending playback stops preparing the candidate', async () => {
  let current = true;
  const { transport, requests } = fixture(async () => {
    current = false;
    return { isPlaybackReady: false, playbackPending: true };
  });
  expect(await transport.prepare(20, { isCurrent: () => current })).toEqual({});
  expect(requests()).toBe(1);
});

test.each([
  { isPlaybackReady: false, userInteractionRequired: true, playbackPending: true },
  { isPlaybackReady: false },
  { isPlaybackReady: false, playbackPending: 'malformed' },
])('confirmed gesture or non-loading failure is not retried: %j', async (response) => {
  const { transport, requests } = fixture(async () => response);
  expect((await transport.prepare(20)).isPlaybackReady).toBe(false);
  expect(requests()).toBe(1);
});

test.each(['player-loading', 'receiver-unavailable'] as const)(
  'persistent %s is bounded even with a frozen clock',
  async (failure) => {
    const previousTimeout = globalThis.setTimeout;
    const previousNow = Date.now;
    let waits = 0;
    Object.defineProperty(globalThis, 'setTimeout', {
      configurable: true,
      value: (callback: () => void, milliseconds: number) => {
        if (milliseconds !== 500) return previousTimeout(callback, milliseconds);
        waits++;
        callback();
        return 1;
      },
    });
    Date.now = () => 1_000;
    try {
      const { transport, requests } = fixture(async () => {
        if (failure === 'receiver-unavailable') throw new Error('Receiving end does not exist.');
        return { isPlaybackReady: false, playbackPending: true };
      });
      const result = await transport.prepare(20);
      expect(result.isPlaybackReady).toBe(failure === 'player-loading' ? false : undefined);
      expect(result.userInteractionRequired).not.toBe(true);
      expect(requests()).toBe(60);
      expect(waits).toBeLessThanOrEqual(60);
    } finally {
      globalThis.setTimeout = previousTimeout;
      Date.now = previousNow;
    }
  },
);

test.each(['ensure', 'content'] as const)(
  'a never-settling %s request expires without late effects',
  async (phase) => {
    const previousTimeout = globalThis.setTimeout;
    let expire: (() => void) | undefined;
    const { promise: pending, resolve: settle } = Promise.withResolvers<void>();
    Object.defineProperty(globalThis, 'setTimeout', {
      configurable: true,
      value: (callback: () => void, milliseconds: number) => {
        if (milliseconds === 30_000) {
          expire = callback;
          return 1;
        }
        return previousTimeout(callback, milliseconds);
      },
    });
    try {
      const { transport, requests, updates } = fixture(
        async () => {
          if (phase === 'content') await pending;
          return { isPlaybackReady: true };
        },
        async () => {
          if (phase === 'ensure') await pending;
        },
      );
      const preparation = transport.prepare(20, { unmuteTab: false, muteAfterPrep: true });
      for (let i = 0; i < 5; i++) await Promise.resolve();
      expect(requests()).toBe(phase === 'content' ? 1 : 0);
      expect(expire).toBeDefined();
      expire?.();
      expect(await preparation).toEqual({});
      settle();
      for (let i = 0; i < 5; i++) await Promise.resolve();
      expect(updates()).toBe(0);
      expect(requests()).toBe(phase === 'content' ? 1 : 0);
    } finally {
      globalThis.setTimeout = previousTimeout;
      settle();
    }
  },
);

test.each([false, true])(
  'timeout preserves pending playback only while the operation is current: cancelled=%s',
  async (cancelled) => {
    const previousTimeout = globalThis.setTimeout;
    let expire: (() => void) | undefined;
    let current = true;
    const { promise: pending, resolve: settle } = Promise.withResolvers<void>();
    Object.defineProperty(globalThis, 'setTimeout', {
      configurable: true,
      value: (callback: () => void, milliseconds: number) => {
        if (milliseconds === 30_000) expire = callback;
        else if (milliseconds === 500) callback();
        else return previousTimeout(callback, milliseconds);
        return 1;
      },
    });
    let attempts = 0;
    try {
      const { transport, updates } = fixture(async () => {
        if (++attempts > 1) {
          await pending;
          return { isPlaybackReady: true };
        }
        return { isPlaybackReady: false, playbackPending: true };
      });
      const preparation = transport.prepare(20, {
        unmuteTab: false,
        muteAfterPrep: true,
        isCurrent: () => current,
      });
      for (let i = 0; i < 10; i++) await Promise.resolve();
      expect(attempts).toBe(2);
      expect(expire).toBeDefined();
      current = !cancelled;
      expire?.();
      expect(await preparation).toEqual(cancelled ? {} : { isPlaybackReady: false, playbackPending: true });
      settle();
      for (let i = 0; i < 5; i++) await Promise.resolve();
      expect(updates()).toBe(0);
    } finally {
      globalThis.setTimeout = previousTimeout;
      settle();
    }
  },
);

test('Stop during a content reply discards readiness and prevents late tab updates', async () => {
  let current = true;
  const { promise: pending, resolve: settle } = Promise.withResolvers<void>();
  const { transport, requests, updates } = fixture(async () => {
    await pending;
    return { isPlaybackReady: true };
  });
  const preparation = transport.prepare(20, {
    unmuteTab: false,
    muteAfterPrep: true,
    isCurrent: () => current,
  });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(requests()).toBe(1);
  current = false;
  settle();
  expect(await preparation).toEqual({});
  expect(updates()).toBe(0);
});
