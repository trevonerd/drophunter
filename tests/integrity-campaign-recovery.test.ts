import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createServiceWorkerTwitchContentHandlers } from '../src/background/service-worker-twitch-content-handlers.ts';
import {
  ensureSessionIntegrity,
  syncTwitchIntegrityFromContentScriptExt,
} from '../src/background/session-management.ts';
import { createSession } from './api-operations-fixtures.ts';
import { createMinimalState } from './fixtures/queue-management.ts';
import { type ChromeMocks, setupChromeMocks } from './mocks/chrome.ts';

describe('campaign integrity recovery', () => {
  let chrome: ChromeMocks;
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    chrome = setupChromeMocks();
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    chrome.teardown();
  });

  test('uses a newly intercepted page token when the previous token failed integrity', async () => {
    // Given: Twitch's page has a new valid token after the cached one failed.
    const state = createMinimalState();
    const session = { ...createSession(), clientIntegrity: 'rejected-token' };
    chrome.storage.local._store.set('twitchIntegrity', {
      token: 'fresh-page-token',
      expiration: Date.now() + 60_000,
    });
    let requests = 0;
    globalThis.fetch = async () => {
      requests += 1;
      return Response.json({});
    };

    // When: the campaign API requests integrity recovery.
    const refreshed = await ensureSessionIntegrity(state, session, true);

    // Then: the new page-issued token is used without reacquiring the rejected one.
    expect(refreshed.clientIntegrity).toBe('fresh-page-token');
    expect(requests).toBe(0);
  });

  for (const page of ['inventory', 'campaigns']) {
    test(`retries integrity-blocked campaign validation when Twitch ${page} supplies a new token`, async () => {
      // Given: authentication is valid, but campaign validation is waiting on integrity.
      const state = createMinimalState();
      state.twitchSessionCache = { ...createSession(), clientIntegrity: 'rejected-token' };
      state.appState.campaignSyncState = {
        ...state.appState.campaignSyncState,
        status: 'retry-scheduled',
        lastErrorKind: 'integrity',
        nextRetryAt: Date.now() + 600_000,
      };
      let initialized = false;
      let retries = 0;
      const handlers = createServiceWorkerTwitchContentHandlers(state, {
        awaitInitialization: async () => {
          initialized = true;
        },
        shouldRefreshCampaignsAfterSessionSync: () => true,
        requestAuthRecoveredSync: async () => {
          expect(initialized).toBe(true);
          retries += 1;
        },
        resumeAfterAuthRecovery: async () => {},
        recordChannelPointsBonusClaimed: async () => {},
      });

      // When: the existing Twitch content script sends fresh integrity evidence.
      const result = await handlers.handleSyncTwitchIntegrity(
        { token: 'fresh-page-token', expiration: Date.now() + 60_000 },
        { url: `https://www.twitch.tv/drops/${page}` },
      );

      // Then: validation retries promptly instead of waiting through the obsolete failure cooldown.
      expect(result.success).toBe(true);
      expect(retries).toBe(1);
      expect(state.twitchSessionCache?.clientIntegrity).toBe('fresh-page-token');
    });
  }

  for (const scenario of ['same-token', 'network-error', 'untrusted-origin'] as const) {
    test(`does not restart campaign validation for ${scenario}`, async () => {
      const state = createMinimalState();
      state.twitchSessionCache = { ...createSession(), clientIntegrity: 'current-token' };
      state.appState.campaignSyncState = {
        ...state.appState.campaignSyncState,
        status: 'retry-scheduled',
        lastErrorKind: scenario === 'network-error' ? 'network' : 'integrity',
      };
      let retries = 0;
      const handlers = createServiceWorkerTwitchContentHandlers(state, {
        awaitInitialization: async () => {},
        shouldRefreshCampaignsAfterSessionSync: () => true,
        requestAuthRecoveredSync: async () => {
          retries += 1;
        },
        resumeAfterAuthRecovery: async () => {},
        recordChannelPointsBonusClaimed: async () => {},
      });
      const result = await handlers.handleSyncTwitchIntegrity(
        {
          token: scenario === 'same-token' ? 'current-token' : 'fresh-token',
          expiration: Date.now() + 60_000,
        },
        {
          url:
            scenario === 'untrusted-origin'
              ? 'https://twitch.tv.example.com/drops/inventory'
              : 'https://www.twitch.tv/drops/inventory',
        },
      );
      expect(retries).toBe(0);
      expect(result.success).toBe(scenario !== 'untrusted-origin');
    });
  }

  test('acknowledges integrity only after storage has finished writing with no cached session', async () => {
    // Given: Chrome storage completes asynchronously and session discovery needs the stored page token.
    const state = createMinimalState();
    const originalSet = chrome.storage.local.set;
    chrome.storage.local.set = async (values) => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await originalSet(values);
    };

    // When: the content-script integrity synchronization is acknowledged.
    const result = await syncTwitchIntegrityFromContentScriptExt(state, { token: 'fresh-page-token' });

    // Then: a subsequent validation attempt can already discover that token in storage.
    expect(result.success).toBe(true);
    expect(chrome.storage.local._store.get('twitchIntegrity')).toMatchObject({ token: 'fresh-page-token' });
  });

  test('retries the same fresh token after its first storage write fails', async () => {
    const state = createMinimalState();
    state.twitchSessionCache = { ...createSession(), clientIntegrity: 'old-token' };
    state.appState.campaignSyncState = {
      ...state.appState.campaignSyncState,
      status: 'retry-scheduled',
      lastErrorKind: 'integrity',
    };
    let retries = 0;
    const handlers = createServiceWorkerTwitchContentHandlers(state, {
      awaitInitialization: async () => {},
      shouldRefreshCampaignsAfterSessionSync: () => true,
      requestAuthRecoveredSync: async () => {
        retries += 1;
      },
      resumeAfterAuthRecovery: async () => {},
      recordChannelPointsBonusClaimed: async () => {},
    });
    const originalSet = chrome.storage.local.set;
    let rejectWrite = true;
    chrome.storage.local.set = async (values) => {
      if (rejectWrite) {
        rejectWrite = false;
        throw new DOMException('storage unavailable', 'OperationError');
      }
      await originalSet(values);
    };
    const payload = { token: 'fresh-token', expiration: Date.now() + 60_000 };
    const sender = { url: 'https://www.twitch.tv/drops/inventory' };
    await expect(handlers.handleSyncTwitchIntegrity(payload, sender)).rejects.toThrow('storage unavailable');
    expect(state.twitchSessionCache.clientIntegrity).toBe('old-token');

    await handlers.handleSyncTwitchIntegrity(payload, sender);

    expect(retries).toBe(1);
    expect(state.twitchSessionCache.clientIntegrity).toBe('fresh-token');
  });

  test('does not overwrite a newer session received while integrity storage is pending', async () => {
    const state = createMinimalState();
    state.twitchSessionCache = { ...createSession(), clientIntegrity: 'old-token' };
    const newerSession = { ...createSession(), userId: '987654321', clientIntegrity: 'newer-session-token' };
    const originalSet = chrome.storage.local.set;
    chrome.storage.local.set = async (values) => {
      state.twitchSessionCache = newerSession;
      await originalSet(values);
    };

    await syncTwitchIntegrityFromContentScriptExt(state, { token: 'old-session-fresh-token' });

    expect(state.twitchSessionCache).toBe(newerSession);
  });
});
