import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  currentTwitchSessionRevision,
  syncTwitchSessionFromContentScriptExt,
} from '../../src/background/session-management.ts';
import { createInitialState } from '../../src/shared/utils.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';
import { createMinimalState, validSession } from '../support/session-management-fixtures.ts';

describe('syncTwitchSessionFromContentScriptExt', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('rejects invalid payload without touching state', async () => {
    const state = createMinimalState();
    const callbacks = {
      shouldRefreshCampaignsAfterSessionSync: () => false,
      onRefreshCampaigns: async () => {},
      onSaveState: async () => {},
      onBroadcastStateUpdate: () => {},
    };
    const result = await syncTwitchSessionFromContentScriptExt(state, { bogus: true }, null, callbacks);
    expect(result).toEqual({ success: false, error: 'Invalid session payload' });
    expect(state.twitchSessionCache).toBeNull();
  });

  test('mutates cache/timing/appState and persists; no refresh branch without tab', async () => {
    const state = createMinimalState();
    let saved = 0;
    let broadcasted = 0;
    let refreshed = 0;
    const callbacks = {
      shouldRefreshCampaignsAfterSessionSync: () => true,
      onRefreshCampaigns: async () => {
        refreshed += 1;
      },
      onSaveState: async () => {
        saved += 1;
      },
      onBroadcastStateUpdate: () => {
        broadcasted += 1;
      },
    };
    const session = validSession();
    const result = await syncTwitchSessionFromContentScriptExt(state, session, null, callbacks);
    expect(result).toEqual({ success: true });
    expect(state.twitchSessionCache).toEqual(session);
    expect(state.twitchSessionLastAttemptAt).toBe(0);
    expect(state.appState.twitchSessionDetected).toBe(true);
    expect(refreshed).toBe(0);
    expect(saved).toBe(0);
    expect(broadcasted).toBe(0);
  });

  test.each([
    { report: { userId: '' }, expectedUserId: '12345678', revisionChanged: false },
    {
      report: { userId: '', oauthToken: 'different12345678901234567890' },
      expectedUserId: '',
      revisionChanged: true,
    },
    { report: { userId: '87654321' }, expectedUserId: '87654321', revisionChanged: true },
  ])(
    'retains known identity only for an incomplete report of the same credentials (%j)',
    async ({ report, expectedUserId, revisionChanged }) => {
      const state = createMinimalState({ twitchSessionCache: validSession() });
      const revision = currentTwitchSessionRevision(state);
      const result = await syncTwitchSessionFromContentScriptExt(state, validSession(report), 42, {
        shouldRefreshCampaignsAfterSessionSync: () => false,
        onRefreshCampaigns: async () => {},
        onSaveState: async () => {},
        onBroadcastStateUpdate: () => {},
      });
      expect(result).toEqual({ success: true });
      expect(state.twitchSessionCache?.userId).toBe(expectedUserId);
      expect(mocks.storage.local._store.get('twitchSession')).toMatchObject({ userId: expectedUserId });
      expect(currentTwitchSessionRevision(state)).toBe(revision + Number(revisionChanged));
    },
  );

  test('refreshes + saves + broadcasts when sender has tab id and callback says refresh', async () => {
    const state = createMinimalState();
    let saved = 0;
    let broadcasted = 0;
    let refreshed = 0;
    const callbacks = {
      shouldRefreshCampaignsAfterSessionSync: () => true,
      onRefreshCampaigns: async () => {
        refreshed += 1;
      },
      onSaveState: async () => {
        saved += 1;
      },
      onBroadcastStateUpdate: () => {
        broadcasted += 1;
      },
    };
    const result = await syncTwitchSessionFromContentScriptExt(state, validSession(), 42, callbacks);
    expect(result).toEqual({ success: true });
    expect(refreshed).toBe(1);
    expect(saved).toBe(1);
    expect(broadcasted).toBe(1);
  });

  test('save+broadcast but no refresh when tab id present, callback says no refresh, but stale stop existed', async () => {
    const state = createMinimalState({
      appState: { ...createInitialState(), lastStopReason: 'sign-in-required' },
    });
    let saved = 0;
    let broadcasted = 0;
    let refreshed = 0;
    const callbacks = {
      shouldRefreshCampaignsAfterSessionSync: () => false,
      onRefreshCampaigns: async () => {
        refreshed += 1;
      },
      onSaveState: async () => {
        saved += 1;
      },
      onBroadcastStateUpdate: () => {
        broadcasted += 1;
      },
    };
    const result = await syncTwitchSessionFromContentScriptExt(state, validSession(), 42, callbacks);
    expect(result).toEqual({ success: true });
    expect(state.appState.lastStopReason).toBeNull();
    expect(refreshed).toBe(0);
    expect(saved).toBe(1);
    expect(broadcasted).toBe(1);
  });

  test('save+broadcast fires for stale stop even without tab id', async () => {
    const state = createMinimalState({
      appState: { ...createInitialState(), lastStopReason: 'sign-in-required' },
    });
    let saved = 0;
    let broadcasted = 0;
    const callbacks = {
      shouldRefreshCampaignsAfterSessionSync: () => true,
      onRefreshCampaigns: async () => {},
      onSaveState: async () => {
        saved += 1;
      },
      onBroadcastStateUpdate: () => {
        broadcasted += 1;
      },
    };
    const result = await syncTwitchSessionFromContentScriptExt(state, validSession(), null, callbacks);
    expect(result).toEqual({ success: true });
    expect(state.appState.lastStopReason).toBeNull();
    expect(saved).toBe(1);
    expect(broadcasted).toBe(1);
  });
});
