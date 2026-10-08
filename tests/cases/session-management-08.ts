import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { loadPageIntegrityToken } from '../../src/background/session-management.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';

describe('loadPageIntegrityToken', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('returns token when stored and not expired', async () => {
    const futureExpiration = Date.now() + 60_000;
    mocks.storage.local._store.set('twitchIntegrity', {
      token: 'page-token-abcdefghij',
      expiration: futureExpiration,
    });

    const result = await loadPageIntegrityToken();
    expect(result).toBe('page-token-abcdefghij');
  });

  test('returns null when twitchIntegrity is not set', async () => {
    const result = await loadPageIntegrityToken();
    expect(result).toBeNull();
  });

  test('returns null when token is missing from stored object', async () => {
    mocks.storage.local._store.set('twitchIntegrity', { expiration: Date.now() + 60000 });
    const result = await loadPageIntegrityToken();
    expect(result).toBeNull();
  });

  test('returns null when token has expired', async () => {
    mocks.storage.local._store.set('twitchIntegrity', {
      token: 'expired-token-xyz',
      expiration: Date.now() - 1000,
    });
    const result = await loadPageIntegrityToken();
    expect(result).toBeNull();
  });

  test('returns token when expiration is 0 (treated as non-expiring)', async () => {
    mocks.storage.local._store.set('twitchIntegrity', { token: 'zero-expiry-token', expiration: 0 });
    const result = await loadPageIntegrityToken();
    expect(result).toBe('zero-expiry-token');
  });
});
