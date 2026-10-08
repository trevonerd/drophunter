import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ensureTwitchSession } from '../../src/background/session-management.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';
import { createMinimalState, validSession } from '../support/session-management-fixtures.ts';

describe('ensureTwitchSession', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('invalidates a cached session when a forced tab reread finds no replacement', async () => {
    const session = validSession();
    const state = createMinimalState({ twitchSessionCache: session });
    let cacheClears = 0;

    const result = await ensureTwitchSession(
      state,
      true,
      { onFindTwitchSessionInOpenTabs: async () => null },
      {
        sanitizeTwitchSession: () => null,
        sessionDebugSummary: () => ({}),
        persistTwitchSession: async () => {},
        clearTwitchSessionCache: () => {
          cacheClears += 1;
          state.twitchSessionCache = null;
        },
      },
    );

    expect(result).toBeNull();
    expect(state.twitchSessionCache).toBeNull();
    expect(cacheClears).toBe(1);
  });

  test('does not clear a newer session synced while an older lookup is in flight', async () => {
    const session = validSession();
    const state = createMinimalState({ twitchSessionCache: null });
    let releaseLookup: (value: ReturnType<typeof validSession> | null) => void = () => {};
    const lookup = new Promise<ReturnType<typeof validSession> | null>((resolve) => {
      releaseLookup = resolve;
    });
    let cacheClears = 0;

    const pending = ensureTwitchSession(
      state,
      false,
      { onFindTwitchSessionInOpenTabs: () => lookup },
      {
        sanitizeTwitchSession: () => null,
        sessionDebugSummary: () => ({}),
        persistTwitchSession: async () => {},
        clearTwitchSessionCache: () => {
          cacheClears += 1;
          state.twitchSessionCache = null;
        },
      },
    );
    await Promise.resolve();
    state.twitchSessionCache = session;
    releaseLookup(null);

    expect(await pending).toBe(session);
    expect(cacheClears).toBe(0);
  });
});
