import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  EXTENSION_VERSION_STORAGE_KEY,
  migrateExtensionStorage,
  STORAGE_SCHEMA_VERSION,
  STORAGE_SCHEMA_VERSION_KEY,
} from '../src/background/storage-migrations.ts';
import type { ChromeMocks } from './mocks/chrome.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

describe('release version storage transition', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('resets legacy 4.0.13 state only once when entering the beta manifest version', async () => {
    // Given
    await mocks.storage.local.set({
      [STORAGE_SCHEMA_VERSION_KEY]: STORAGE_SCHEMA_VERSION,
      [EXTENSION_VERSION_STORAGE_KEY]: '4.0.13',
      appState: {
        totalDropsClaimed: 7,
        isRunning: true,
        availableGames: [{ id: 'stale-game', name: 'Stale Game', imageUrl: '' }],
      },
      twitchIntegrity: { token: 'stale-integrity' },
    });

    // When
    await migrateExtensionStorage('3.99.0.14');
    await mocks.storage.local.set({ twitchIntegrity: { token: 'current-integrity' } });
    await migrateExtensionStorage('3.99.0.14');

    // Then
    expect(mocks.storage.local._store.get(EXTENSION_VERSION_STORAGE_KEY)).toBe('3.99.0.14');
    expect(mocks.storage.local._store.get('appState')).toMatchObject({
      totalDropsClaimed: 7,
      isRunning: false,
      availableGames: [],
    });
    expect(mocks.storage.local._store.get('twitchIntegrity')).toEqual({ token: 'current-integrity' });
  });
});
