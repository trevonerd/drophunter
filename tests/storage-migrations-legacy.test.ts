import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  EXTENSION_VERSION_STORAGE_KEY,
  migrateExtensionStorage,
  STORAGE_SCHEMA_VERSION,
  STORAGE_SCHEMA_VERSION_KEY,
  transformLegacyAppState,
} from '../src/background/storage-migrations.ts';
import type { ChromeMocks } from './mocks/chrome.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

describe('legacy extension storage migration', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('clears legacy Twitch-derived state when upgrading from 3.5.2', async () => {
    await mocks.storage.local.set({
      [EXTENSION_VERSION_STORAGE_KEY]: '3.5.2',
      appState: {
        totalDropsClaimed: 12,
        notificationsEnabled: true,
        favoriteGames: [{ gameId: 'fav', lastKnownName: 'Favorite', addedAt: 1 }],
        hiddenGames: [{ gameId: 'hidden', lastKnownName: 'Hidden', hiddenAt: 2 }],
        queue: [{ id: 'stale', name: 'Stale', imageUrl: '' }],
        selectedGame: { id: 'stale', name: 'Stale', imageUrl: '' },
        allDrops: [{ id: 'drop', gameId: 'stale', name: 'Drop' }],
        availableGames: [{ id: 'stale', name: 'Stale', imageUrl: '' }],
        isRunning: true,
        recoveryReason: 'no-streamers',
        campaignAvailabilityByKey: { 'campaign:stale': { eligibleStreamerCount: 1, updatedAt: 1 } },
      },
      twitchSession: { oauthToken: 'stale' },
      twitchIntegrity: { token: 'stale' },
      timingState: { lastHeartbeatAt: 1 },
      farmingAutomationFactsV1: { version: 1 },
      farmingSessionTransitionReceiptV1: { version: 1 },
      onboardingCompleted: true,
      telegramCredentials: { botToken: 'keep-me', chatId: '42' },
      claimLog: [{ id: 'claimed-1' }],
    });

    await migrateExtensionStorage('4.0.0');

    expect(mocks.storage.local._store.get('appState')).toMatchObject({
      totalDropsClaimed: 12,
      notificationsEnabled: true,
      favoriteGames: [{ gameId: 'fav', lastKnownName: 'Favorite', addedAt: 1 }],
      hiddenGames: [{ gameId: 'hidden', lastKnownName: 'Hidden', hiddenAt: 2 }],
      queue: [],
      selectedGame: null,
      allDrops: [],
      availableGames: [],
      isRunning: false,
      recoveryReason: null,
      campaignAvailabilityByKey: {},
    });
    expect(mocks.storage.local._store.has('twitchSession')).toBe(false);
    expect(mocks.storage.local._store.has('twitchIntegrity')).toBe(false);
    expect(mocks.storage.local._store.has('timingState')).toBe(false);
    expect(mocks.storage.local._store.has('farmingAutomationFactsV1')).toBe(false);
    expect(mocks.storage.local._store.has('farmingSessionTransitionReceiptV1')).toBe(false);
    expect(mocks.storage.local._store.get('onboardingCompleted')).toBe(true);
    expect(mocks.storage.local._store.get('telegramCredentials')).toEqual({
      botToken: 'keep-me',
      chatId: '42',
    });
    expect(mocks.storage.local._store.get('claimLog')).toEqual([{ id: 'claimed-1' }]);
    expect(mocks.storage.local._store.get(STORAGE_SCHEMA_VERSION_KEY)).toBe(STORAGE_SCHEMA_VERSION);
    expect(mocks.storage.local._store.get(EXTENSION_VERSION_STORAGE_KEY)).toBe('4.0.0');
  });

  test('treats a missing version marker with app state as a legacy upgrade', async () => {
    await mocks.storage.local.set({
      appState: {
        favoriteGames: [{ gameId: 'fav', lastKnownName: 'Favorite', addedAt: 1 }],
        queue: [{ id: 'stale', name: 'Stale', imageUrl: '' }],
        isRunning: true,
      },
      twitchSession: { oauthToken: 'stale' },
    });

    await migrateExtensionStorage('4.0.0');

    expect(mocks.storage.local._store.get('appState')).toMatchObject({
      favoriteGames: [{ gameId: 'fav', lastKnownName: 'Favorite', addedAt: 1 }],
      queue: [],
      selectedGame: null,
      isRunning: false,
    });
    expect(mocks.storage.local._store.has('twitchSession')).toBe(false);
    expect(mocks.storage.local._store.get(EXTENSION_VERSION_STORAGE_KEY)).toBe('4.0.0');
  });

  test('replaces a malformed legacy app-state payload with clean defaults', async () => {
    await mocks.storage.local.set({
      [EXTENSION_VERSION_STORAGE_KEY]: 'not-a-version',
      appState: 'corrupted-state',
      twitchSession: { oauthToken: 'stale' },
      farmingAutomationFactsV1: { version: 1 },
    });

    await migrateExtensionStorage('4.0.0');

    expect(mocks.storage.local._store.get('appState')).toMatchObject({
      favoriteGames: [],
      hiddenGames: [],
      queue: [],
      selectedGame: null,
      availableGames: [],
      isRunning: false,
    });
    expect(mocks.storage.local._store.has('twitchSession')).toBe(false);
    expect(mocks.storage.local._store.has('farmingAutomationFactsV1')).toBe(false);
    expect(mocks.storage.local._store.get(STORAGE_SCHEMA_VERSION_KEY)).toBe(STORAGE_SCHEMA_VERSION);
    expect(mocks.storage.local._store.get(EXTENSION_VERSION_STORAGE_KEY)).toBe('4.0.0');
  });

  test('does not advance schema or version markers when legacy cleanup cannot write', async () => {
    await mocks.storage.local.set({
      [EXTENSION_VERSION_STORAGE_KEY]: '3.5.2',
      appState: { queue: [{ id: 'stale', name: 'Stale', imageUrl: '' }] },
      onboardingCompleted: true,
      telegramCredentials: { botToken: 'keep-me' },
    });
    const originalSet = mocks.storage.local.set;
    mocks.storage.local.set = async (values) => {
      if (STORAGE_SCHEMA_VERSION_KEY in values || EXTENSION_VERSION_STORAGE_KEY in values) {
        throw new Error('storage unavailable');
      }
      return originalSet(values);
    };

    await expect(migrateExtensionStorage('4.0.0')).rejects.toThrow('storage unavailable');

    expect(mocks.storage.local._store.has(STORAGE_SCHEMA_VERSION_KEY)).toBe(false);
    expect(mocks.storage.local._store.has(EXTENSION_VERSION_STORAGE_KEY)).toBe(true);
    expect(mocks.storage.local._store.get(EXTENSION_VERSION_STORAGE_KEY)).toBe('3.5.2');
    expect(mocks.storage.local._store.get('onboardingCompleted')).toBe(true);
    expect(mocks.storage.local._store.get('telegramCredentials')).toEqual({ botToken: 'keep-me' });
  });

  test('keeps only validated favorites in the pure legacy state transform', () => {
    const transformed = transformLegacyAppState({
      totalDropsClaimed: 8,
      favoriteGames: [
        { gameId: 'valid', lastKnownName: 'Valid', addedAt: 10 },
        { gameId: '', lastKnownName: 'Missing id', addedAt: 11 },
        { gameId: 'missing-name', lastKnownName: 42, addedAt: 12 },
        { gameId: 'missing-time', lastKnownName: 'Missing time', addedAt: 'bad' },
      ],
      hiddenGames: [],
      queue: [{ id: 'stale', name: 'Stale', imageUrl: '' }],
      isRunning: true,
    });

    expect(transformed.favoriteGames).toEqual([{ gameId: 'valid', lastKnownName: 'Valid', addedAt: 10 }]);
    expect(transformed.queue).toEqual([]);
    expect(transformed.totalDropsClaimed).toBe(8);
    expect(transformed.isRunning).toBe(false);
  });

  test('keeps queue resume behavior for modern 3.99.0 updates', async () => {
    const queuedGame = { id: 'queued', name: 'Queued', imageUrl: '' };
    await mocks.storage.local.set({
      [STORAGE_SCHEMA_VERSION_KEY]: STORAGE_SCHEMA_VERSION,
      [EXTENSION_VERSION_STORAGE_KEY]: '3.99.0.14',
      appState: { queue: [queuedGame], selectedGame: queuedGame, isRunning: true },
    });

    await migrateExtensionStorage('3.99.0.15');

    expect(mocks.storage.local._store.get('appState')).toMatchObject({
      queue: [queuedGame],
      selectedGame: queuedGame,
      isRunning: false,
      wasRunning: true,
    });
  });
});
