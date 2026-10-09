import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  clearTwitchSessionCache,
  ensureTwitchSession,
  persistTwitchSession,
  syncTwitchSessionFromContentScriptExt,
} from '../../src/background/session-management.ts';
import { sanitizeTwitchSession } from '../../src/background/twitch-api/types.ts';
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

  test('retains a newer synchronized account when a previous tab lookup returns credentials', async () => {
    const previous = validSession({ userId: '101' });
    const current = validSession({ userId: '202', oauthToken: 'new-oauth12345678901234567890' });
    const state = createMinimalState({ twitchSessionCache: previous });
    let releaseLookup: (value: typeof previous) => void = () => {};
    const lookup = new Promise<typeof previous>((resolve) => {
      releaseLookup = resolve;
    });
    const pending = ensureTwitchSession(
      state,
      true,
      { onFindTwitchSessionInOpenTabs: () => lookup },
      {
        sanitizeTwitchSession,
        sessionDebugSummary: () => ({}),
        persistTwitchSession,
        clearTwitchSessionCache,
      },
    );
    await syncTwitchSessionFromContentScriptExt(state, current, null, {
      shouldRefreshCampaignsAfterSessionSync: () => false,
      onRefreshCampaigns: async () => {},
      onSaveState: async () => {},
      onBroadcastStateUpdate: () => {},
    });
    state.appState.acquiredCampaignIds = ['current-account-reward'];
    releaseLookup(previous);

    expect(await pending).toEqual(current);
    expect(state.twitchSessionCache).toEqual(current);
    expect(state.appState.campaignEvidenceUserId).toBe('202');
    expect(state.appState.acquiredCampaignIds).toEqual(['current-account-reward']);
    expect(mocks.storage.local._store.get('twitchSession')).toEqual(current);
  });

  test.each([false, true])('keeps account evidence current during sync (%p)', async (forced) => {
    const previous = validSession({ userId: '101' });
    const current = validSession({ userId: '202', oauthToken: 'new-oauth12345678901234567890' });
    const state = createMinimalState({ twitchSessionCache: previous });
    const write = mocks.storage.local.set;
    let releaseWrite = () => {};
    let enteredWrite = () => {};
    const blocked = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      enteredWrite = resolve;
    });
    mocks.storage.local.set = async (value) => {
      const snapshot = structuredClone(value);
      if (snapshot.appState && Reflect.get(snapshot.appState, 'campaignEvidenceUserId') === '101') {
        enteredWrite();
        await blocked;
      }
      await write(snapshot);
    };
    const pending = ensureTwitchSession(
      state,
      forced,
      { onFindTwitchSessionInOpenTabs: async () => previous },
      {
        sanitizeTwitchSession,
        sessionDebugSummary: () => ({}),
        persistTwitchSession,
        clearTwitchSessionCache,
      },
    );
    await entered;
    const syncing = syncTwitchSessionFromContentScriptExt(state, current, null, {
      shouldRefreshCampaignsAfterSessionSync: () => false,
      onRefreshCampaigns: async () => {},
      onSaveState: async () => {},
      onBroadcastStateUpdate: () => {},
    });
    await Promise.resolve();
    await Promise.resolve();
    releaseWrite();
    await Promise.all([pending, syncing]);

    expect(state.twitchSessionCache).toEqual(current);
    expect(state.appState.campaignEvidenceUserId).toBe('202');
    expect(mocks.storage.local._store.get('appState')).toMatchObject({ campaignEvidenceUserId: '202' });
    expect(mocks.storage.local._store.get('twitchSession')).toEqual(current);
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
