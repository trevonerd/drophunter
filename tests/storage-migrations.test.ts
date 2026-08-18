import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  EXTENSION_VERSION_STORAGE_KEY,
  initializeAfterStorageMigration,
  migrateExtensionStorage,
  STORAGE_SCHEMA_VERSION,
  STORAGE_SCHEMA_VERSION_KEY,
} from '../src/background/storage-migrations.ts';
import type { ChromeMocks } from './mocks/chrome.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

describe('extension storage migration', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('removes stale Twitch runtime data while preserving user-owned data', async () => {
    const appState = {
      totalDropsClaimed: 42,
      totalChannelPointsClaimed: 17,
      monitorAutoOpen: false,
      notificationsEnabled: true,
      queue: [{ id: 'game-1', campaignId: 'campaign-1' }],
      selectedGame: { id: 'game-1', campaignId: 'campaign-1' },
    };
    const telegramCredentials = { botToken: 'preserve-me', chatId: '1234' };
    const claimLog = [{ id: 'claimed-1' }];

    await mocks.storage.local.set({
      [EXTENSION_VERSION_STORAGE_KEY]: '4.0.0',
      appState,
      onboardingCompleted: true,
      telegramCredentials,
      claimLog,
      twitchSession: { oauthToken: 'stale-oauth', deviceId: 'stale-device' },
      twitchIntegrity: { token: 'stale-integrity' },
      dropsSnapshotCache: [{ id: 'stale-drop' }],
      timingState: { lastHeartbeatAt: 123 },
      oauthToken: 'stale-flat-local-oauth',
      deviceId: 'stale-flat-local-device',
    });
    await mocks.storage.sync.set({
      oauthToken: 'stale-flat-sync-oauth',
      deviceId: 'stale-flat-sync-device',
      unrelatedSyncedPreference: 'preserve-me',
    });
    await mocks.storage.session.set({
      timingState: { lastHeartbeatAt: 456 },
      unrelatedSessionValue: 'preserve-me',
    });

    await migrateExtensionStorage();

    expect(mocks.storage.local._store.get('appState')).toEqual({
      ...appState,
      campaignPriorityMode: 'priority-list-only',
    });
    expect(mocks.storage.local._store.get('onboardingCompleted')).toBe(true);
    expect(mocks.storage.local._store.get('telegramCredentials')).toEqual(telegramCredentials);
    expect(mocks.storage.local._store.get('claimLog')).toEqual(claimLog);
    expect(mocks.storage.sync._store.get('unrelatedSyncedPreference')).toBe('preserve-me');
    expect(mocks.storage.session._store.get('unrelatedSessionValue')).toBe('preserve-me');

    for (const key of [
      'twitchSession',
      'twitchIntegrity',
      'dropsSnapshotCache',
      'timingState',
      'oauthToken',
      'deviceId',
    ]) {
      expect(mocks.storage.local._store.has(key)).toBe(false);
    }
    expect(mocks.storage.sync._store.has('oauthToken')).toBe(false);
    expect(mocks.storage.sync._store.has('deviceId')).toBe(false);
    expect(mocks.storage.session._store.has('timingState')).toBe(false);
    expect(mocks.storage.local._store.get(STORAGE_SCHEMA_VERSION_KEY)).toBe(STORAGE_SCHEMA_VERSION);
  });

  test('finishes migration before persisted state is hydrated', async () => {
    await mocks.storage.local.set({
      [EXTENSION_VERSION_STORAGE_KEY]: '4.0.0',
      appState: { totalDropsClaimed: 42, monitorAutoOpen: false },
      twitchSession: { oauthToken: 'stale-oauth', deviceId: 'stale-device' },
    });
    let hydratedSession: unknown = 'not-loaded';
    let hydratedAppState: unknown;

    await initializeAfterStorageMigration(async () => {
      const stored = await mocks.storage.local.get(['appState', 'twitchSession']);
      hydratedSession = stored.twitchSession;
      hydratedAppState = stored.appState;
    });

    expect(hydratedSession).toBeUndefined();
    expect(hydratedAppState).toEqual({
      totalDropsClaimed: 42,
      monitorAutoOpen: false,
      campaignPriorityMode: 'priority-list-only',
    });
  });

  test('does not advance the schema or overwrite app state when cleanup fails', async () => {
    const appState = { totalDropsClaimed: 99, notificationsEnabled: true };
    await mocks.storage.local.set({ appState, twitchSession: { oauthToken: 'stale' } });
    mocks.storage.local.remove = async () => {
      throw new Error('storage unavailable');
    };

    await expect(migrateExtensionStorage()).rejects.toThrow('storage unavailable');

    expect(mocks.storage.local._store.has(STORAGE_SCHEMA_VERSION_KEY)).toBe(false);
    expect(mocks.storage.local._store.get('appState')).toEqual(appState);
  });

  test('leaves current-schema storage unchanged', async () => {
    const currentSession = { oauthToken: 'current-oauth', deviceId: 'current-device' };
    await mocks.storage.local.set({
      [STORAGE_SCHEMA_VERSION_KEY]: STORAGE_SCHEMA_VERSION,
      twitchSession: currentSession,
    });
    let removeCalls = 0;
    const originalRemove = mocks.storage.local.remove;
    mocks.storage.local.remove = async (keys) => {
      removeCalls += 1;
      return originalRemove(keys);
    };

    await migrateExtensionStorage();

    expect(removeCalls).toBe(0);
    expect(mocks.storage.local._store.get('twitchSession')).toEqual(currentSession);
  });

  test('preserves the current queue behavior during a schema-only migration', async () => {
    await mocks.storage.local.set({
      [STORAGE_SCHEMA_VERSION_KEY]: 1,
      [EXTENSION_VERSION_STORAGE_KEY]: '4.0.0',
      appState: { queue: [{ id: 'game-1', campaignId: 'campaign-1' }] },
    });

    await migrateExtensionStorage();

    expect(mocks.storage.local._store.get('appState')).toEqual({
      queue: [{ id: 'game-1', campaignId: 'campaign-1' }],
      campaignPriorityMode: 'priority-list-only',
    });
    expect(mocks.storage.local._store.get(STORAGE_SCHEMA_VERSION_KEY)).toBe(STORAGE_SCHEMA_VERSION);
  });

  test('resets volatile extension state before hydrating a different extension version', async () => {
    const releasedTabs: number[] = [];
    mocks.chrome.tabs.setTabsGetResult({
      id: 91,
      windowId: 7,
      url: 'https://www.twitch.tv/legacy-channel',
    });
    mocks.chrome.tabs.setTabsQueryResult([{ id: 91 }, { id: 92 }]);
    mocks.chrome.tabs.remove = async (tabId) => {
      releasedTabs.push(tabId);
    };
    await mocks.storage.local.set({
      [STORAGE_SCHEMA_VERSION_KEY]: STORAGE_SCHEMA_VERSION,
      [EXTENSION_VERSION_STORAGE_KEY]: '4.0.0',
      appState: {
        totalDropsClaimed: 42,
        notificationsEnabled: true,
        watchTransportPreference: 'tabless',
        favoriteGames: [
          { gameId: 'favorite-1', lastKnownName: 'Favorite', addedAt: 1, identityKeys: ['id:favorite-1'] },
        ],
        availableGames: [{ id: 'game-1', name: 'Stale Game', imageUrl: '' }],
        queue: [{ id: 'game-1', name: 'Stale Game', imageUrl: '' }],
        selectedGame: { id: 'game-1', name: 'Stale Game', imageUrl: '' },
        isRunning: true,
        dropsPageRefreshInProgress: true,
        lastDropsPageRefreshError: 'stale refresh failure',
        watchTransportMode: 'managed-tab',
        watchFallbackReason: 'legacy fallback',
        tabId: 91,
      },
      twitchSession: { oauthToken: 'stale-token', deviceId: 'stale-device' },
      twitchIntegrity: { token: 'stale-integrity' },
      dropsSnapshotCache: [{ id: 'stale-drop' }],
      timingState: { apiBackoffUntil: Date.now() + 60_000 },
      farmingAutomationFactsV1: { version: 1 },
      farmingSessionTransitionReceiptV1: {
        version: 1,
        attemptId: 'legacy-attempt',
        transition: 'start',
        fromCampaignKey: null,
        toCampaignKey: 'legacy-campaign',
        toStreamerName: 'legacy-channel',
        committedAt: 1,
        sessionRevision: 'legacy-revision',
        fromWatch: null,
        toWatch: {
          kind: 'managed-tab',
          tabId: 91,
          ownershipToken: 'legacy-token',
          expectedChannel: 'legacy-channel',
        },
        cleanup: { kind: 'not-required' },
      },
    });
    await mocks.storage.session.set({
      timingState: { apiBackoffUntil: Date.now() + 60_000 },
      autoStartSnoozedForBrowserSession: true,
      'farmingAutomationOwnedWatch:legacy-token': {
        version: 1,
        expectedUrl: 'https://www.twitch.tv/legacy-channel',
      },
    });

    await migrateExtensionStorage('4.0.1');

    expect(mocks.storage.local._store.get('appState')).toMatchObject({
      totalDropsClaimed: 42,
      notificationsEnabled: true,
      watchTransportPreference: 'tabless',
      favoriteGames: [
        { gameId: 'favorite-1', lastKnownName: 'Favorite', addedAt: 1, identityKeys: ['id:favorite-1'] },
      ],
      availableGames: [],
      queue: [],
      selectedGame: null,
      isRunning: false,
      dropsPageRefreshInProgress: false,
      lastDropsPageRefreshError: null,
      watchTransportMode: 'managed-tab',
      watchFallbackReason: null,
      tabId: null,
    });
    expect(mocks.storage.local._store.get(EXTENSION_VERSION_STORAGE_KEY)).toBe('4.0.1');
    for (const key of [
      'twitchSession',
      'twitchIntegrity',
      'dropsSnapshotCache',
      'timingState',
      'farmingAutomationFactsV1',
      'farmingSessionTransitionReceiptV1',
    ]) {
      expect(mocks.storage.local._store.has(key)).toBe(false);
    }
    expect(mocks.storage.session._store.has('timingState')).toBe(false);
    expect(mocks.storage.session._store.has('autoStartSnoozedForBrowserSession')).toBe(false);
    expect(mocks.storage.session._store.has('farmingAutomationOwnedWatch:legacy-token')).toBe(false);
    expect(releasedTabs).toEqual([91]);
  });
});
