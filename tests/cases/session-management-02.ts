import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { TWITCH_SESSION_STORAGE_KEY } from '../../src/background/constants.ts';
import { clearTwitchSessionCache } from '../../src/background/session-management.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';
import { createMinimalState, validSession } from '../support/session-management-fixtures.ts';

describe('clearTwitchSessionCache', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('nulls twitchSessionCache on state', async () => {
    const state = createMinimalState({ twitchSessionCache: validSession() });
    await clearTwitchSessionCache(state);
    expect(state.twitchSessionCache).toBeNull();
  });

  test('clears session from storage', async () => {
    const state = createMinimalState();
    await clearTwitchSessionCache(state);
    expect(mocks.storage.local._store.has(TWITCH_SESSION_STORAGE_KEY)).toBe(false);
  });
});
