import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { recoverTwitchSessionFromStorageKeys } from '../../src/background/session-management.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';

describe('recoverTwitchSessionFromStorageKeys', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('recovers session from flat local storage keys', async () => {
    mocks.storage.local._store.set('oauthToken', 'oauth12345678901234567890');
    mocks.storage.local._store.set('deviceId', 'device-abc-12345678901234567');
    mocks.storage.local._store.set('userId', '12345678');

    const session = await recoverTwitchSessionFromStorageKeys();
    expect(session).not.toBeNull();
    expect(session?.oauthToken).toBe('oauth12345678901234567890');
    expect(session?.deviceId).toBe('device-abc-12345678901234567');
  });

  test('prefers local over sync for flat keys', async () => {
    mocks.storage.local._store.set('oauthToken', 'local-token-12345678901234567890');
    mocks.storage.sync._store.set('oauthToken', 'sync-token-12345678901234567890');
    mocks.storage.local._store.set('deviceId', 'local-device-12345678901234567');
    mocks.storage.sync._store.set('deviceId', 'sync-device-12345678901234567');

    const session = await recoverTwitchSessionFromStorageKeys();
    expect(session?.oauthToken).toBe('local-token-12345678901234567890');
    expect(session?.deviceId).toBe('local-device-12345678901234567');
  });

  test('falls back to sync when local is missing for flat keys', async () => {
    mocks.storage.sync._store.set('oauthToken', 'sync-token-12345678901234567890');
    mocks.storage.sync._store.set('deviceId', 'sync-device-12345678901234567');

    const session = await recoverTwitchSessionFromStorageKeys();
    expect(session).not.toBeNull();
    expect(session?.oauthToken).toBe('sync-token-12345678901234567890');
  });

  test('returns null when no session data in storage', async () => {
    const session = await recoverTwitchSessionFromStorageKeys();
    expect(session).toBeNull();
  });

  test('deep searches storage values when flat keys fail', async () => {
    mocks.storage.local._store.set('someKey', {
      oauthToken: 'oauth12345678901234567890',
      deviceId: 'device-abc-12345678901234567',
      uuid: 'deep-session-uuid',
    });

    const session = await recoverTwitchSessionFromStorageKeys();
    expect(session).not.toBeNull();
    expect(session?.oauthToken).toBe('oauth12345678901234567890');
    expect(session?.uuid).toBe('deep-session-uuid');
  });
});
