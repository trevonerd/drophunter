import { afterEach, beforeEach, expect, test } from 'bun:test';
import {
  DROPS_SNAPSHOT_CACHE_KEY,
  LAST_ACTIVITY_AT_KEY,
  TIMING_STATE_KEY,
  TWITCH_SESSION_STORAGE_KEY,
} from '../src/background/constants.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import {
  clearTwitchSessionCache,
  ensureTwitchSession,
  persistTwitchSession,
  syncTwitchSessionFromContentScriptExt,
} from '../src/background/session-management.ts';
import { loadState, sessionDebugSummary } from '../src/background/state-persistence.ts';
import type { TwitchSession } from '../src/background/twitch-api/types.ts';
import { sanitizeTwitchSession } from '../src/background/twitch-api/types.ts';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';
import { createInitialState } from '../src/shared/utils.ts';
import type { ChromeMocks } from './mocks/chrome.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

let mocks: ChromeMocks;
beforeEach(() => {
  mocks = setupChromeMocks();
});
afterEach(() => {
  mocks.teardown();
});
const session = (userId: string): TwitchSession => ({
  userId,
  oauthToken: 'oauth12345678901234567890',
  deviceId: 'device-abc-12345678901234567',
  uuid: 'abc12345',
  clientId: 'kimne78kx3ncx6brgo4mv6wki5h1ko',
});
const callbacks = {
  shouldRefreshCampaignsAfterSessionSync: () => false,
  onRefreshCampaigns: async () => {},
  onSaveState: async () => {},
  onBroadcastStateUpdate: () => {},
};
function seededState() {
  const state = createServiceWorkerState();
  state.twitchSessionCache = session('12345678');
  const game = {
    id: 'game',
    name: 'Game',
    imageUrl: '',
    campaignId: 'campaign',
    allDropsCompleted: true,
    rewardSummary: { completion: 'all-acquired', remainderReasons: [] },
  } satisfies NonNullable<typeof state.appState.selectedGame>;
  state.appState.queue = [game];
  state.appState.selectedGame = game;
  state.appState.availableGames = [game];
  state.appState.manualQueueAuthorized = true;
  state.appState.tabId = 77;
  state.appState.totalDropsClaimed = 42;
  state.appState.acquiredCampaignIds = ['campaign'];
  const drop = {
    id: 'drop',
    name: 'Reward',
    gameId: 'game',
    gameName: 'Game',
    imageUrl: '',
    campaignId: 'campaign',
    progress: 100,
    currentMinutes: 60,
    claimed: true,
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'verified',
  } satisfies NonNullable<typeof state.appState.currentDrop>;
  state.cachedDropsSnapshot = [drop];
  state.appState.campaignDropsByKey = { campaign: [drop] };
  state.appState.allDrops = [drop];
  state.appState.completedDrops = [drop];
  state.appState.currentDrop = drop;
  return state;
}
test('account switch removes acquired summaries while preserving manual queue and owned tab', async () => {
  const state = seededState();
  await syncTwitchSessionFromContentScriptExt(state, session('87654321'), null, callbacks);
  expect(state.appState.queue[0]?.rewardSummary).toBeUndefined();
  expect(state.appState.selectedGame?.allDropsCompleted).toBeUndefined();
  expect(state.appState.availableGames[0]?.rewardSummary).toBeUndefined();
  expect(state.appState.manualQueueAuthorized).toBe(true);
  expect(state.appState.tabId).toBe(77);
  expect(state.appState.totalDropsClaimed).toBe(42);
  expect(state.appState.acquiredCampaignIds).toEqual([]);
  expect(state.cachedDropsSnapshot).toEqual([]);
  expect(state.appState.campaignDropsByKey).toEqual({});
  expect(state.appState.allDrops).toEqual([]);
  expect(state.appState.completedDrops).toEqual([]);
  expect(state.appState.currentDrop).toBeNull();
  expect(mocks.storage.local._store.get(DROPS_SNAPSHOT_CACHE_KEY)).toEqual([]);
  expect(
    normalizeStoredAppState(mocks.storage.local._store.get('appState')).queue[0]?.rewardSummary,
  ).toBeUndefined();
});
test('same account credential refresh retains acquired evidence', async () => {
  const state = seededState();
  await syncTwitchSessionFromContentScriptExt(
    state,
    { ...session('12345678'), oauthToken: 'new-oauth12345678901234567890' },
    null,
    callbacks,
  );
  expect(state.appState.queue[0]?.rewardSummary?.completion).toBe('all-acquired');
  expect(state.appState.acquiredCampaignIds).toEqual(['campaign']);
  expect(state.cachedDropsSnapshot[0]?.claimed).toBe(true);
});
test('clearing credentials then restarting retains owner for a later account switch', async () => {
  const state = seededState();
  await clearTwitchSessionCache(state);
  const restarted = createServiceWorkerState();
  await loadState(
    restarted,
    { onLoadTimingState: async () => {}, onEnforceInactivityReset: async () => false },
    {
      sanitizeTwitchSession,
      sessionDebugSummary,
      createInitialState,
      clearRotationMetadata: (appState) => appState,
      TWITCH_SESSION_STORAGE_KEY,
      DROPS_SNAPSHOT_CACHE_KEY,
      LAST_ACTIVITY_AT_KEY,
      TIMING_STATE_KEY,
      STREAM_VALIDATION_GRACE_MS: 0,
    },
  );
  expect(restarted.appState.queue).toHaveLength(1);
  expect(restarted.appState.acquiredCampaignIds).toEqual(['campaign']);
  await syncTwitchSessionFromContentScriptExt(restarted, session('87654321'), null, callbacks);
  expect(restarted.appState.queue[0]?.rewardSummary).toBeUndefined();
  expect(restarted.appState.acquiredCampaignIds).toEqual([]);
});
test('stored acquired campaign identities accept only nonempty deduplicated Twitch IDs', () => {
  expect(
    normalizeStoredAppState({ acquiredCampaignIds: ['campaign', 'campaign', '', '   ', 42, null, 'second'] })
      .acquiredCampaignIds,
  ).toEqual(['campaign', 'second']);
  expect(normalizeStoredAppState({ acquiredCampaignIds: 'campaign' }).acquiredCampaignIds).toEqual([]);
});
test('forced session recovery clears previous account evidence before publishing replacement credentials', async () => {
  const state = seededState();
  await ensureTwitchSession(
    state,
    true,
    { onFindTwitchSessionInOpenTabs: async () => session('87654321') },
    {
      sanitizeTwitchSession,
      sessionDebugSummary,
      clearTwitchSessionCache,
      persistTwitchSession: async (incoming) => {
        expect(
          normalizeStoredAppState(mocks.storage.local._store.get('appState')).queue[0]?.rewardSummary,
        ).toBeUndefined();
        await persistTwitchSession(incoming);
      },
    },
  );
  expect(state.appState.queue[0]?.rewardSummary).toBeUndefined();
});
