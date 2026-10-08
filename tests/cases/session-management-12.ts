import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { TWITCH_SESSION_STORAGE_KEY } from '../../src/background/constants.ts';
import { syncTwitchIntegrityFromContentScriptExt } from '../../src/background/session-management.ts';
import type { TwitchSession } from '../../src/background/twitch-api/types.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';
import { createMinimalState, validSession } from '../support/session-management-fixtures.ts';

describe('syncTwitchIntegrityFromContentScriptExt', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('rejects empty token', async () => {
    const state = createMinimalState();
    const result = await syncTwitchIntegrityFromContentScriptExt(state, { token: '   ' });
    expect(result).toEqual({ success: false, error: 'Empty integrity token' });
  });

  test('rejects missing payload', async () => {
    const state = createMinimalState();
    const result = await syncTwitchIntegrityFromContentScriptExt(state, undefined);
    expect(result).toEqual({ success: false, error: 'Empty integrity token' });
  });

  test('resets fallback flags and writes storage; no cached session means no persist call', async () => {
    const state = createMinimalState({
      integrityFallbackActive: true,
      integrityFallbackActiveUntil: 12345,
    });
    const result = await syncTwitchIntegrityFromContentScriptExt(state, {
      token: 'integrity-token-xyz',
      expiration: 9999,
      request_id: 'req-1',
    });
    expect(result).toEqual({ success: true });
    expect(state.integrityFallbackActive).toBe(false);
    expect(state.integrityFallbackActiveUntil).toBe(0);
    const stored = mocks.storage.local._store.get('twitchIntegrity') as Record<string, unknown>;
    expect(stored).toEqual({
      token: 'integrity-token-xyz',
      expiration: 9999,
      request_id: 'req-1',
    });
  });

  test('mutates cached session clientIntegrity and persists when session exists', async () => {
    const existing = validSession({ clientIntegrity: 'old-token' });
    const state = createMinimalState({
      twitchSessionCache: existing,
      integrityFallbackActive: true,
    });
    const result = await syncTwitchIntegrityFromContentScriptExt(state, {
      token: 'new-token',
      expiration: 123,
    });
    expect(result).toEqual({ success: true });
    expect(state.twitchSessionCache?.clientIntegrity).toBe('new-token');
    expect(state.integrityFallbackActive).toBe(false);
    const stored = mocks.storage.local._store.get(TWITCH_SESSION_STORAGE_KEY) as TwitchSession;
    expect(stored.clientIntegrity).toBe('new-token');
  });
});
