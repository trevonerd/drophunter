import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import {
  fetchDropsSnapshotFromApi,
  fetchInventorySnapshotFromApi,
} from '../src/background/api-operations.ts';
import { autoClaimClaimableDrops } from '../src/background/auto-claim.ts';
import { interruptFarmingSessionMutation } from '../src/background/farming-session-revision.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerTwitchGateway } from '../src/background/service-worker-twitch-gateway.ts';
import { bindCampaignEvidenceAccount } from '../src/background/session-account-evidence.ts';
import { syncTwitchSessionFromContentScriptExt } from '../src/background/session-management.ts';
import { TwitchApiClient } from '../src/background/twitch-api/client.ts';
import type { TwitchSession } from '../src/background/twitch-api/types.ts';
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

test.each(['drops-page', 'auth-recovery'] as const)(
  '%s gateway binds account before publishing recovered credentials',
  async (path) => {
    const state = seededState();
    state.twitchSessionCache = { ...session('12345678'), clientIntegrity: 'fixture-integrity' };
    const recovered = {
      ...session('87654321'),
      oauthToken: 'recovered-oauth12345678901234567890',
      clientIntegrity: 'fixture-integrity',
    };
    mocks.chrome.tabs.query = async () => [
      { id: 90, windowId: 1, status: 'complete', url: 'https://www.twitch.tv/drops/inventory' },
    ];
    mocks.chrome.tabs.sendMessage = async () => ({ success: true, session: recovered });
    spyOn(TwitchApiClient.prototype, 'fetchCurrentUserId').mockResolvedValue(recovered.userId ?? null);
    let calls = 0;
    spyOn(TwitchApiClient.prototype, 'fetchDropsSnapshot').mockImplementation(async () => {
      if (++calls === 1) throw new Error('401 invalid oauth token');
      return { games: [], drops: [], updatedAt: Date.now() };
    });
    const gateway = createServiceWorkerTwitchGateway(state, { recoverTwitchSession: async () => {} });
    if (path === 'drops-page') await gateway.persistSessionFromDropsPage(90);
    else await gateway.fetchDropsSnapshot({ sessionRecoveryMode: 'background-tab' });
    expect(state.twitchSessionCache?.userId).toBe(recovered.userId);
    expect(state.appState.campaignEvidenceUserId).toBe(recovered.userId);
    expect(state.appState.farmingSessionTargets['campaign:campaign']?.acquired).toBe(false);
    expect(state.appState.acquiredCampaignIds).toEqual([]);
  },
);

test.each(['campaign', 'inventory'] as const)(
  '%s response from the previous account cannot recreate acquisition proof',
  async (kind) => {
    const state = seededState();
    const original = { ...session('12345678'), clientIntegrity: 'fixture-integrity' };
    state.twitchSessionCache = original;
    const started = createDeferred<void>();
    const response = createDeferred<DropsSnapshot>();
    const result = {
      games: state.appState.availableGames,
      drops: state.cachedDropsSnapshot,
      updatedAt: Date.now(),
    };
    const method = kind === 'campaign' ? 'fetchDropsSnapshot' : 'fetchInventorySnapshot';
    spyOn(TwitchApiClient.prototype, method).mockImplementation(async () => {
      started.resolve();
      return response.promise;
    });
    const pending =
      kind === 'campaign'
        ? fetchDropsSnapshotFromApi(state, original)
        : fetchInventorySnapshotFromApi(state, original, state.cachedDropsSnapshot);
    await started.promise;
    await bindCampaignEvidenceAccount(state, '87654321');
    state.twitchSessionCache = session('87654321');
    response.resolve(result);
    expect(await pending).toBeNull();
    expect(state.appState.farmingSessionTargets['campaign:campaign']?.acquired).toBe(false);
    expect(state.cachedDropsSnapshot).toEqual([]);
  },
);

test.each(['current', 'superseded'] as const)(
  'account auto-detection binds evidence and rejects %s late credentials',
  async (outcome) => {
    const state = seededState();
    state.twitchSessionCache = { ...session('12345678'), userId: '', clientIntegrity: 'fixture-integrity' };
    const started = createDeferred<void>();
    const response = createDeferred<string | null>();
    spyOn(TwitchApiClient.prototype, 'fetchCurrentUserId').mockImplementation(async () => {
      started.resolve();
      return response.promise;
    });
    spyOn(TwitchApiClient.prototype, 'fetchDropsSnapshot').mockResolvedValue({
      games: [],
      drops: [],
      updatedAt: Date.now(),
    });
    const gateway = createServiceWorkerTwitchGateway(state, { recoverTwitchSession: async () => {} });
    const pending = gateway.fetchDropsSnapshot();
    await started.promise;
    if (outcome === 'superseded')
      await syncTwitchSessionFromContentScriptExt(state, session('99999999'), null, callbacks);
    response.resolve('87654321');
    const result = await pending;
    expect(state.twitchSessionCache?.userId).toBe(outcome === 'current' ? '87654321' : '99999999');
    expect(state.appState.campaignEvidenceUserId).toBe(outcome === 'current' ? '87654321' : '99999999');
    expect(state.appState.farmingSessionTargets['campaign:campaign']?.acquired).toBe(false);
    expect(result).toEqual(
      outcome === 'current' ? { games: [], drops: [], updatedAt: expect.any(Number) } : null,
    );
  },
);

test.each(['Pause', 'Play'])(
  '%s cancels a pending claim without blocking the next authorized claim',
  async () => {
    const state = seededState();
    state.appState.isRunning = true;
    const credentials = { ...session('12345678'), clientIntegrity: 'fixture-integrity' };
    state.twitchSessionCache = credentials;
    const drop = {
      ...required(state.cachedDropsSnapshot[0]),
      verificationState: 'unassessed' as const,
      claimed: false,
      claimable: true,
      claimId: 'pending-claim',
    };
    state.cachedDropsSnapshot = [drop];
    const started = createDeferred<void>();
    const response = createDeferred<boolean>();
    let calls = 0;
    spyOn(TwitchApiClient.prototype, 'claimDropReward').mockImplementation(async () => {
      if (++calls === 1) {
        started.resolve();
        return response.promise;
      }
      return false;
    });
    const first = autoClaimClaimableDrops(state, async () => credentials);
    await started.promise;
    await interruptFarmingSessionMutation(state, async () => {
      state.appState.isPaused = true;
    });
    response.resolve(true);
    expect(await first).toBe(false);
    expect(state.dropClaimInFlight).toBe(false);
    state.appState.isPaused = false;
    await autoClaimClaimableDrops(state, async () => credentials);
    expect(calls).toBe(2);
  },
);

test('a successful old-account claim cannot mark the new account reward acquired', async () => {
  const state = seededState();
  state.appState.isRunning = true;
  state.appState.autoClaimDrops = true;
  const original = { ...session('12345678'), clientIntegrity: 'fixture-integrity' };
  state.twitchSessionCache = original;
  const drop = {
    ...required(state.cachedDropsSnapshot[0]),
    requiredMinutes: 60,
    verificationState: 'unassessed' as const,
    claimed: false,
    claimable: true,
    claimId: 'claim-a',
  };
  state.cachedDropsSnapshot = [drop];
  state.appState.allDrops = [drop];
  const started = createDeferred<void>();
  const response = createDeferred<boolean>();
  spyOn(TwitchApiClient.prototype, 'claimDropReward').mockImplementation(async () => {
    started.resolve();
    return response.promise;
  });
  const pending = autoClaimClaimableDrops(state, async () => original);
  await started.promise;
  await bindCampaignEvidenceAccount(state, '87654321');
  state.twitchSessionCache = session('87654321');
  const nextDrop = { ...drop, claimId: 'claim-b' };
  state.appState.allDrops = [nextDrop];
  state.cachedDropsSnapshot = [nextDrop];
  response.resolve(true);
  expect(await pending).toBe(false);
  expect(state.appState.allDrops[0]?.claimed).toBe(false);
  expect(state.cachedDropsSnapshot[0]?.claimed).toBe(false);
  expect(state.dropClaimRetryAtById.size).toBe(0);
});
