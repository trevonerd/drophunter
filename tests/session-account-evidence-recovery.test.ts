import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { fetchDropsSnapshotFromApi } from '../src/background/api-operations.ts';
import { autoClaimClaimableDrops } from '../src/background/auto-claim.ts';
import {
  DROPS_SNAPSHOT_CACHE_KEY,
  LAST_ACTIVITY_AT_KEY,
  TIMING_STATE_KEY,
  TWITCH_SESSION_STORAGE_KEY,
} from '../src/background/constants.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { bindCampaignEvidenceAccount } from '../src/background/session-account-evidence.ts';
import {
  clearTwitchSessionCache,
  ensureTwitchSession,
  persistTwitchSession,
  syncTwitchSessionFromContentScriptExt,
} from '../src/background/session-management.ts';
import { loadState, sessionDebugSummary } from '../src/background/state-persistence.ts';
import { TwitchApiClient } from '../src/background/twitch-api/client.ts';
import { sanitizeTwitchSession, type TwitchSession } from '../src/background/twitch-api/types.ts';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';
import { createInitialState } from '../src/shared/utils.ts';
import type { DropsSnapshot } from '../src/types/index.ts';
import { type ChromeMocks, setupChromeMocks } from './mocks/chrome.ts';
import { createDeferred } from './support/farming-automation-fixtures.ts';
import { required } from './support/required.ts';

let mocks: ChromeMocks;
beforeEach(() => {
  mocks = setupChromeMocks();
});
afterEach(() => {
  mock.restore();
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
  state.appState.campaignEvidenceUserId = '12345678';
  state.appState.farmingSessionTargets = { 'campaign:campaign': { game, acquired: true } };
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

test('old-account integrity retry failure cannot apply backoff to the next account', async () => {
  const state = seededState();
  const original = { ...session('12345678'), clientIntegrity: 'old-integrity' };
  state.twitchSessionCache = original;
  await mocks.chrome.storage.local.set({ twitchIntegrity: { token: 'new-integrity' } });
  const started = createDeferred<void>();
  const response = createDeferred<DropsSnapshot>();
  let calls = 0;
  spyOn(TwitchApiClient.prototype, 'fetchDropsSnapshot').mockImplementation(async () => {
    if (++calls === 1) throw new Error('integrity error');
    started.resolve();
    return response.promise;
  });
  const pending = fetchDropsSnapshotFromApi(state, original);
  await started.promise;
  await bindCampaignEvidenceAccount(state, '87654321');
  state.twitchSessionCache = session('87654321');
  response.reject(new Error('network failed'));
  expect(await pending).toBeNull();
  expect(calls).toBe(2);
  expect(state.apiBackoffUntil).toBe(0);
  expect(state.apiConsecutiveFailures).toBe(0);
});

test('an old claim cannot release the next account pending claim', async () => {
  const state = seededState();
  state.appState.isRunning = true;
  const original = { ...session('12345678'), clientIntegrity: 'fixture-integrity' };
  state.twitchSessionCache = original;
  const drop = {
    ...required(state.cachedDropsSnapshot[0]),
    requiredMinutes: 60,
    verificationState: 'unassessed' as const,
    claimed: false,
    claimable: true,
    claimId: 'old-claim',
  };
  state.cachedDropsSnapshot = [drop];
  const firstStarted = createDeferred<void>();
  const secondStarted = createDeferred<void>();
  const firstResponse = createDeferred<boolean>();
  const secondResponse = createDeferred<boolean>();
  spyOn(TwitchApiClient.prototype, 'claimDropReward').mockImplementation(async (claimId) => {
    if (claimId === 'old-claim') {
      firstStarted.resolve();
      return firstResponse.promise;
    }
    secondStarted.resolve();
    return secondResponse.promise;
  });
  const first = autoClaimClaimableDrops(state, async () => original);
  await firstStarted.promise;
  await bindCampaignEvidenceAccount(state, '87654321');
  state.twitchSessionCache = { ...session('87654321'), clientIntegrity: 'next-integrity' };
  state.cachedDropsSnapshot = [{ ...drop, claimId: 'next-claim' }];
  const second = autoClaimClaimableDrops(state, async () => state.twitchSessionCache);
  await secondStarted.promise;
  firstResponse.resolve(true);
  expect(await first).toBe(false);
  expect(state.dropClaimInFlight).toBe(true);
  secondResponse.resolve(false);
  await second;
  expect(state.dropClaimInFlight).toBe(false);
});

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
  mocks.storage.local._store.set('appState', structuredClone(state.appState));
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
