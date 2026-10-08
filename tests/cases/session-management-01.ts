import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { TWITCH_SESSION_STORAGE_KEY } from '../../src/background/constants.ts';
import {
  discardPersistedTwitchSessionIfMatches,
  persistTwitchSession,
} from '../../src/background/session-management.ts';
import type { TwitchSession } from '../../src/background/twitch-api/types.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';
import { validSession } from '../support/session-management-fixtures.ts';

describe('persistTwitchSession', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('sets session to storage when provided', async () => {
    const session = validSession();
    await persistTwitchSession(session);
    const stored = mocks.storage.local._store.get(TWITCH_SESSION_STORAGE_KEY) as TwitchSession;
    expect(stored).toEqual(session);
  });

  test('removes session key when null is passed', async () => {
    mocks.storage.local._store.set(TWITCH_SESSION_STORAGE_KEY, validSession());
    await persistTwitchSession(null);
    expect(mocks.storage.local._store.has(TWITCH_SESSION_STORAGE_KEY)).toBe(false);
  });

  test('removes only the matching late-recovery session from storage', async () => {
    const stale = validSession();
    await persistTwitchSession(stale);
    await discardPersistedTwitchSessionIfMatches(stale);
    expect(mocks.storage.local._store.has(TWITCH_SESSION_STORAGE_KEY)).toBe(false);

    const newer = validSession({ oauthToken: 'new-oauth12345678901234567890' });
    await persistTwitchSession(newer);
    await discardPersistedTwitchSessionIfMatches(stale);
    expect(mocks.storage.local._store.get(TWITCH_SESSION_STORAGE_KEY)).toEqual(newer);
  });
});
