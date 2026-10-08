import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ensureSessionIntegrity } from '../../src/background/session-management.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';
import { createMinimalState, validSession } from '../support/session-management-fixtures.ts';

describe('ensureSessionIntegrity', () => {
  let mocks: ChromeMocks;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    mocks = setupChromeMocks();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mocks.teardown();
  });

  test('returns session unchanged when clientIntegrity already present and forceRefresh=false', async () => {
    const state = createMinimalState();
    const session = validSession({ clientIntegrity: 'existing-integrity-token' });

    const result = await ensureSessionIntegrity(state, session, false);
    expect(result.clientIntegrity).toBe('existing-integrity-token');
    expect(state.twitchSessionCache).toBeNull();
  });

  test('uses page token when available and no forceRefresh', async () => {
    const state = createMinimalState();
    const session = validSession();
    const futureExpiration = Date.now() + 60_000;
    mocks.storage.local._store.set('twitchIntegrity', {
      token: 'page-intercept-token-12345',
      expiration: futureExpiration,
    });

    const result = await ensureSessionIntegrity(state, session, false);
    expect(result.clientIntegrity).toBe('page-intercept-token-12345');
    expect(state.twitchSessionCache).not.toBeNull();
    expect(state.twitchSessionCache?.clientIntegrity).toBe('page-intercept-token-12345');
  });

  test('forces endpoint refresh when the page still holds the rejected integrity token', async () => {
    const state = createMinimalState();
    const session = validSession({ clientIntegrity: 'old-token' });
    mocks.storage.local._store.set('twitchIntegrity', {
      token: 'old-token',
      expiration: Date.now() + 60_000,
    });

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ token: 'refreshed-token-xyz' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const result = await ensureSessionIntegrity(state, session, true);
    expect(result.clientIntegrity).toBe('refreshed-token-xyz');
  });

  test('falls back to refresh when no page token available', async () => {
    const state = createMinimalState();
    const session = validSession();

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ token: 'fallback-refresh-token-abc' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const result = await ensureSessionIntegrity(state, session, false);
    expect(result.clientIntegrity).toBe('fallback-refresh-token-abc');
  });

  test('returns original session when refresh returns null', async () => {
    const state = createMinimalState();
    const session = validSession();

    globalThis.fetch = async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const result = await ensureSessionIntegrity(state, session, false);
    expect(result).toBe(session);
  });
});
