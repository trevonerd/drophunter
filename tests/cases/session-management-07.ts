import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { refreshTwitchIntegrityToken } from '../../src/background/session-management.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';
import { createMinimalState, validSession } from '../support/session-management-fixtures.ts';

describe('refreshTwitchIntegrityToken', () => {
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

  test('updates state cache and persists session with new token', async () => {
    const state = createMinimalState();
    const session = validSession();

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ token: 'fresh-integrity-token-12345' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const result = await refreshTwitchIntegrityToken(state, session);

    expect(result).not.toBeNull();
    expect(result?.clientIntegrity).toBe('fresh-integrity-token-12345');
    expect(state.twitchSessionCache).not.toBeNull();
    expect(state.twitchSessionCache?.clientIntegrity).toBe('fresh-integrity-token-12345');
  });

  test('returns null when fetch returns empty token', async () => {
    const state = createMinimalState();
    const session = validSession();

    globalThis.fetch = async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const result = await refreshTwitchIntegrityToken(state, session);
    expect(result).toBeNull();
  });

  test('returns null when fetch fails', async () => {
    const state = createMinimalState();
    const session = validSession();

    globalThis.fetch = async () => new Response(null, { status: 500 });

    const result = await refreshTwitchIntegrityToken(state, session);
    expect(result).toBeNull();
  });
});
