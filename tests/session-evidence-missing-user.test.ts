import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import {
  clearTwitchSessionCache,
  ensureTwitchSession,
  persistTwitchSession,
} from '../src/background/session-management.ts';
import { loadState } from '../src/background/state-persistence.ts';
import { sanitizeTwitchSession } from '../src/background/twitch-api/types.ts';
import { createInitialState } from '../src/shared/utils.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

let mocks: ReturnType<typeof setupChromeMocks>;
beforeEach(() => {
  mocks = setupChromeMocks();
});
afterEach(() => mocks.teardown());

test('startup retains owned acquisition evidence while a stored session awaits user ID detection', async () => {
  const state = createServiceWorkerState();
  const appState = createInitialState();
  appState.campaignEvidenceUserId = '12345';
  appState.acquiredCampaignIds = ['completed-campaign'];
  await mocks.storage.local.set({
    appState,
    twitchSession: {
      oauthToken: 'a'.repeat(30),
      deviceId: 'b'.repeat(32),
      userId: '',
    },
  });

  await loadState(
    state,
    {
      onLoadTimingState: async () => {},
      onEnforceInactivityReset: async () => false,
    },
    {
      sanitizeTwitchSession,
      sessionDebugSummary: () => ({}),
      createInitialState,
      clearRotationMetadata: (value) => value,
      TWITCH_SESSION_STORAGE_KEY: 'twitchSession',
      DROPS_SNAPSHOT_CACHE_KEY: 'dropsSnapshotCache',
      LAST_ACTIVITY_AT_KEY: 'lastActivityAt',
      TIMING_STATE_KEY: 'timingState',
      STREAM_VALIDATION_GRACE_MS: 30_000,
    },
  );

  expect(state.appState.acquiredCampaignIds).toEqual(['completed-campaign']);
  expect(state.appState.campaignEvidenceUserId).toBe('12345');
});

for (const recoveredUserId of ['12345', '67890']) {
  test(`session recovery with unresolved identity retains evidence until account ${recoveredUserId} resolves`, async () => {
    const state = createServiceWorkerState();
    state.appState.campaignEvidenceUserId = '12345';
    state.appState.acquiredCampaignIds = ['completed-campaign'];
    const unresolvedSession = sanitizeTwitchSession({
      oauthToken: 'a'.repeat(30),
      deviceId: 'b'.repeat(32),
      userId: '',
    });
    if (!unresolvedSession) throw new Error('invalid fixture session');
    const deps = {
      sanitizeTwitchSession,
      sessionDebugSummary: () => ({}),
      clearTwitchSessionCache,
      persistTwitchSession,
    };
    await ensureTwitchSession(
      state,
      true,
      {
        onFindTwitchSessionInOpenTabs: async () => unresolvedSession,
      },
      deps,
    );
    expect(state.appState.acquiredCampaignIds).toEqual(['completed-campaign']);
    expect(state.appState.campaignEvidenceUserId).toBe('12345');
    await clearTwitchSessionCache(state);
    expect(state.appState.acquiredCampaignIds).toEqual(['completed-campaign']);
    await ensureTwitchSession(
      state,
      true,
      {
        onFindTwitchSessionInOpenTabs: async () => ({ ...unresolvedSession, userId: recoveredUserId }),
      },
      deps,
    );
    expect(state.appState.campaignEvidenceUserId).toBe(recoveredUserId);
    expect(state.appState.acquiredCampaignIds).toEqual(
      recoveredUserId === '12345' ? ['completed-campaign'] : [],
    );
  });
}
