import { vi } from 'bun:test';
import type { ServiceWorkerState } from '../../src/background/service-worker.ts';
import type { TwitchSession } from '../../src/background/twitch-api/types.ts';
import { createInitialState } from '../../src/shared/utils.ts';
import type { TwitchDrop } from '../../src/types/index.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';

export const mockClaimDropReward = vi.fn<[string], Promise<boolean>>();
const originalFetch = globalThis.fetch;

function setupFetchMock() {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;

    if (url.includes('/integrity')) {
      return new Response(JSON.stringify({ token: 'mock-integrity-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (body?.operationName === 'DropsPage_ClaimDropRewards') {
      const claimId = body?.variables?.input?.dropInstanceID;
      if (typeof claimId === 'string') {
        const success = await mockClaimDropReward(claimId);
        return new Response(
          JSON.stringify({
            data: { claimDropRewards: { status: success ? 'SUCCESS' : 'FAILED' } },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }

    return originalFetch(input, init);
  };
}

export function setupClaimApiMocks(): ChromeMocks {
  const mocks = setupChromeMocks();
  mockClaimDropReward.mockReset();
  mockClaimDropReward.mockResolvedValue(true);
  setupFetchMock();
  return mocks;
}

export function teardownClaimApiMocks(mocks: ChromeMocks) {
  mocks.teardown();
  globalThis.fetch = originalFetch;
}

export function createMinimalState(overrides: Partial<ServiceWorkerState> = {}): ServiceWorkerState {
  return {
    appState: createInitialState(),
    monitorTickInFlight: false,
    invalidStreamChecks: 0,
    lastStreamRotationAt: 0,
    streamValidationGraceUntil: 0,
    lastTrackedProgress: 0,
    lastTrackedMinutes: 0,
    lastTrackedDropKey: null,
    lastProgressAdvanceAt: 0,
    noProgressRotationAttempts: 0,
    playbackAttentionWarningSent: false,
    gamesCacheRefreshInFlight: null,
    twitchSessionCache: null,
    twitchSessionFetchInFlight: null,
    twitchSessionLastAttemptAt: 0,
    cachedDropsSnapshot: [],
    previousAllDropsCount: 0,
    cachedCampaignChannelsMap: {},
    lastFullRefreshAt: 0,
    dropClaimInFlight: false,
    dropClaimRetryAtById: new Map(),
    queueMissingStreak: new Map(),
    lastActivityAt: 0,
    apiConsecutiveFailures: 0,
    apiBackoffUntil: 0,
    integrityFallbackActive: false,
    integrityFallbackActiveUntil: 0,
    recoveryBackoffUntil: 0,
    lastRecoveryAttemptAt: 0,
    stalledRecoveryAttempts: 0,
    recoveryNotificationSent: false,
    lastGamesCacheRefreshAt: 0,
    ...overrides,
  };
}

export function makeDrop(overrides: Partial<TwitchDrop> = {}): TwitchDrop {
  return {
    id: 'drop-1',
    campaignId: 'camp-1',
    name: 'Test Drop',
    gameName: 'Test Game',
    gameId: 'game-1',
    benefitId: 'ben-1',
    imageUrl: '',
    claimed: false,
    claimable: false,
    progress: 0,
    currentMinutes: 0,
    remainingMinutes: 60,
    status: 'active',
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
    startAt: new Date().toISOString(),
    endAt: new Date(Date.now() + 86400000).toISOString(),
    ...overrides,
  };
}

export function makeSession(): TwitchSession {
  return {
    userId: 'uid123',
    oauthToken: 'tokensecret',
    clientIntegrity: true,
    deviceId: 'device-abc-xyz-123456',
    uuid: 'uuid-abc',
    clientId: 'client-xyz',
  };
}
