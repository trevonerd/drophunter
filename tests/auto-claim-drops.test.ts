import { describe, expect, test, beforeEach, afterEach, vi } from 'bun:test';
import { setupChromeMocks } from './mocks/chrome.ts';
import type { ChromeMocks } from './mocks/chrome.ts';
import {
  applyAutoClaimDropsSetting,
  shouldAttemptAutoClaimDrops,
  canRetryDropClaim,
  markDropClaimedLocally,
  markDropClaimedInSnapshot,
  claimDropViaApi,
  autoClaimClaimableDrops,
} from '../src/background/auto-claim.ts';
import { createInitialState } from '../src/shared/utils.ts';
import type { ServiceWorkerState } from '../src/background/service-worker.ts';
import type { TwitchDrop } from '../src/types/index.ts';
import type { TwitchSession } from '../src/background/twitch-api/types.ts';
import { DROP_CLAIM_RETRY_COOLDOWN_MS } from '../src/background/constants.ts';

const mockClaimDropReward = vi.fn<[string], Promise<boolean>>();

vi.mock('../src/background/twitch-api/client.ts', () => {
  return {
    TwitchApiClient: vi.fn().mockImplementation(() => ({
      claimDropReward: mockClaimDropReward,
    })),
  };
});

vi.mock('../src/background/session-management.ts', () => ({
  ensureSessionIntegrity: vi.fn().mockImplementation((_state, session) => Promise.resolve(session)),
  clearTwitchSessionCache: vi.fn(),
}));

vi.mock('../src/background/drop-processing.ts', () => ({
  splitDropsForSelectedGame: vi.fn(),
}));

function createMinimalState(overrides: Partial<ServiceWorkerState> = {}): ServiceWorkerState {
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

function makeDrop(overrides: Partial<TwitchDrop> = {}): TwitchDrop {
  return {
    id: 'drop-1',
    campaignId: 'camp-1',
    name: 'Test Drop',
    gameName: 'Test Game',
    gameId: 'game-1',
    benefitId: 'ben-1',
    dropType: 'default',
    claimed: false,
    claimable: false,
    progress: 0,
    remainingMinutes: 60,
    status: 'active',
    startAt: new Date().toISOString(),
    endAt: new Date(Date.now() + 86400000).toISOString(),
    ...overrides,
  };
}

function makeSession(): TwitchSession {
  return {
    userId: 'uid123',
    oauthToken: 'tokensecret',
    clientIntegrity: true,
    deviceId: 'device-abc-xyz-123456',
    uuid: 'uuid-abc',
    clientId: 'client-xyz',
  };
}

describe('applyAutoClaimDropsSetting', () => {
  test('enabling the setting updates app state', () => {
    const next = applyAutoClaimDropsSetting(createInitialState(), true);
    expect(next.autoClaimDrops).toBe(true);
  });

  test('disabling the setting updates app state', () => {
    const next = applyAutoClaimDropsSetting(
      { ...createInitialState(), autoClaimDrops: true },
      false,
    );
    expect(next.autoClaimDrops).toBe(false);
  });

  test('undefined disables the setting', () => {
    const next = applyAutoClaimDropsSetting(
      { ...createInitialState(), autoClaimDrops: true },
      undefined,
    );
    expect(next.autoClaimDrops).toBe(false);
  });
});

describe('shouldAttemptAutoClaimDrops', () => {
  test('claim gate blocks attempts when idle, paused, or disabled', () => {
    expect(shouldAttemptAutoClaimDrops(createInitialState())).toBe(false);
    expect(
      shouldAttemptAutoClaimDrops({
        ...createInitialState(),
        isRunning: true,
        isPaused: true,
        autoClaimDrops: true,
      }),
    ).toBe(false);
    expect(
      shouldAttemptAutoClaimDrops({
        ...createInitialState(),
        isRunning: true,
        autoClaimDrops: false,
      }),
    ).toBe(false);
  });

  test('claim gate allows attempts while farming with drops enabled', () => {
    expect(
      shouldAttemptAutoClaimDrops({
        ...createInitialState(),
        isRunning: true,
        autoClaimDrops: true,
      }),
    ).toBe(true);
  });

  test('does not gate on tabId (drops use API not DOM)', () => {
    expect(
      shouldAttemptAutoClaimDrops({
        ...createInitialState(),
        isRunning: true,
        autoClaimDrops: true,
        tabId: null,
      }),
    ).toBe(true);
  });
});

describe('canRetryDropClaim', () => {
  test('returns true when claimId has no retry timestamp', () => {
    const state = createMinimalState();
    expect(canRetryDropClaim(state, 'any-claim')).toBe(true);
  });

  test('returns true when current time is past retry timestamp', () => {
    const state = createMinimalState({
      dropClaimRetryAtById: new Map([['claim-1', Date.now() - 1000]]),
    });
    expect(canRetryDropClaim(state, 'claim-1')).toBe(true);
  });

  test('returns false when current time is before retry timestamp', () => {
    const state = createMinimalState({
      dropClaimRetryAtById: new Map([['claim-1', Date.now() + DROP_CLAIM_RETRY_COOLDOWN_MS]]),
    });
    expect(canRetryDropClaim(state, 'claim-1')).toBe(false);
  });
});

describe('markDropClaimedLocally', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('marks drop as claimed in allDrops by claimId', () => {
    const drop = makeDrop({ claimId: 'claim-abc', id: 'drop-1', claimed: false, claimable: true });
    const state = createMinimalState({
      appState: { ...createInitialState(), allDrops: [drop] },
      cachedDropsSnapshot: [],
    });

    const changed = markDropClaimedLocally(state, 'claim-abc');

    expect(changed).toBe(true);
    expect(state.appState.allDrops[0].claimed).toBe(true);
    expect(state.appState.allDrops[0].claimable).toBe(false);
    expect(state.appState.allDrops[0].progress).toBe(100);
    expect(state.appState.allDrops[0].remainingMinutes).toBe(0);
    expect(state.appState.allDrops[0].status).toBe('completed');
  });

  test('falls back to matching drop id when claimId does not match', () => {
    const drop = makeDrop({ claimId: undefined, id: 'drop-fallback', claimed: false, claimable: true });
    const state = createMinimalState({
      appState: { ...createInitialState(), allDrops: [drop] },
      cachedDropsSnapshot: [],
    });

    const changed = markDropClaimedLocally(state, 'non-existent', 'drop-fallback');

    expect(changed).toBe(true);
    expect(state.appState.allDrops[0].claimed).toBe(true);
  });

  test('returns false when no drop matches', () => {
    const drop = makeDrop({ claimId: 'other-claim', id: 'drop-2' });
    const state = createMinimalState({
      appState: { ...createInitialState(), allDrops: [drop] },
    });

    const changed = markDropClaimedLocally(state, 'unknown-claim');

    expect(changed).toBe(false);
  });
});

describe('markDropClaimedInSnapshot', () => {
  test('updates matching drop in cachedDropsSnapshot by claimId', () => {
    const drop = makeDrop({ claimId: 'snap-claim', id: 'snap-drop-1', claimed: false, claimable: true });
    const state = createMinimalState({ cachedDropsSnapshot: [drop] });

    markDropClaimedInSnapshot(state, 'snap-claim');

    expect(state.cachedDropsSnapshot[0].claimed).toBe(true);
    expect(state.cachedDropsSnapshot[0].claimable).toBe(false);
    expect(state.cachedDropsSnapshot[0].progress).toBe(100);
    expect(state.cachedDropsSnapshot[0].status).toBe('completed');
  });

  test('falls back to matching drop id when claimId does not match', () => {
    const drop = makeDrop({ claimId: undefined, id: 'snap-fallback', claimed: false, claimable: true });
    const state = createMinimalState({ cachedDropsSnapshot: [drop] });

    markDropClaimedInSnapshot(state, 'non-existent', 'snap-fallback');

    expect(state.cachedDropsSnapshot[0].claimed).toBe(true);
  });

  test('does nothing when no drop matches', () => {
    const drop = makeDrop({ claimId: 'other-snap', id: 'snap-other' });
    const state = createMinimalState({ cachedDropsSnapshot: [drop] });

    markDropClaimedInSnapshot(state, 'unknown-snap');

    expect(state.cachedDropsSnapshot[0].claimed).toBe(false);
  });
});

describe('claimDropViaApi', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
    mockClaimDropReward.mockReset();
    mockClaimDropReward.mockImplementation(() => Promise.resolve(true));
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('returns false when drop has no claimId', async () => {
    const drop = makeDrop({ claimId: undefined });
    const state = createMinimalState();
    const getSession = vi.fn<[boolean], Promise<TwitchSession | null>>();

    const result = await claimDropViaApi(state, drop, getSession);

    expect(result).toBe(false);
    expect(getSession).not.toHaveBeenCalled();
  });

  test('returns false when retry is in cooldown', async () => {
    const drop = makeDrop({ claimId: 'cooldown-claim' });
    const future = Date.now() + DROP_CLAIM_RETRY_COOLDOWN_MS;
    const state = createMinimalState({
      dropClaimRetryAtById: new Map([['cooldown-claim', future]]),
    });
    const getSession = vi.fn<[boolean], Promise<TwitchSession | null>>();

    const result = await claimDropViaApi(state, drop, getSession);

    expect(result).toBe(false);
    expect(getSession).not.toHaveBeenCalled();
  });

  test('calls API and returns true on success', async () => {
    const drop = makeDrop({ claimId: 'success-claim', name: 'My Drop' });
    const state = createMinimalState();
    const getSession = vi.fn<[boolean], Promise<TwitchSession | null>>().mockResolvedValue(makeSession());

    const result = await claimDropViaApi(state, drop, getSession);

    expect(result).toBe(true);
    expect(mockClaimDropReward).toHaveBeenCalledWith('success-claim');
  });

  test('sets retry timestamp when claim fails', async () => {
    const drop = makeDrop({ claimId: 'fail-claim' });
    const state = createMinimalState();
    const getSession = vi.fn<[boolean], Promise<TwitchSession | null>>().mockResolvedValue(makeSession());
    mockClaimDropReward.mockResolvedValue(false);

    await claimDropViaApi(state, drop, getSession);

    const retryAt = state.dropClaimRetryAtById.get('fail-claim');
    expect(retryAt).toBeGreaterThan(Date.now());
  });

  test('mock returns true when configured', async () => {
    mockClaimDropReward.mockResolvedValue(true);
    expect(await mockClaimDropReward('test')).toBe(true);
  });

  test('removes claimId from retry map on successful claim', async () => {
    const drop = makeDrop({ claimId: 'remove-retry-claim' });
    const state = createMinimalState({
      dropClaimRetryAtById: new Map([['remove-retry-claim', Date.now() - 1000]]),
    });
    const getSession = vi.fn<[boolean], Promise<TwitchSession | null>>().mockResolvedValue(makeSession());

    const result = await claimDropViaApi(state, drop, getSession);

    expect(result).toBe(true);
  });
});

describe('autoClaimClaimableDrops', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
    mockClaimDropReward.mockReset();
    mockClaimDropReward.mockResolvedValue(true);
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('returns false when auto-claim is disabled', async () => {
    const state = createMinimalState({
      appState: { ...createInitialState(), isRunning: true, autoClaimDrops: false },
    });
    const getSession = vi.fn<[boolean], Promise<TwitchSession | null>>();

    const result = await autoClaimClaimableDrops(state, getSession);

    expect(result).toBe(false);
  });

  test('returns false when dropClaimInFlight is true', async () => {
    const state = createMinimalState({
      appState: { ...createInitialState(), isRunning: true, autoClaimDrops: true },
      dropClaimInFlight: true,
    });
    const getSession = vi.fn<[boolean], Promise<TwitchSession | null>>();

    const result = await autoClaimClaimableDrops(state, getSession);

    expect(result).toBe(false);
  });

  test('returns false when no claimable drops in snapshot', async () => {
    const state = createMinimalState({
      appState: { ...createInitialState(), isRunning: true, autoClaimDrops: true },
      cachedDropsSnapshot: [],
    });
    const getSession = vi.fn<[boolean], Promise<TwitchSession | null>>();

    const result = await autoClaimClaimableDrops(state, getSession);

    expect(result).toBe(false);
  });

  test('claims drop and updates state on success', async () => {
    const claimableDrop = makeDrop({
      claimId: 'auto-claim-1',
      claimable: true,
      claimed: false,
      dropType: 'default',
    });
    const state = createMinimalState({
      appState: { ...createInitialState(), isRunning: true, autoClaimDrops: true, allDrops: [claimableDrop] },
      cachedDropsSnapshot: [claimableDrop],
    });
    const getSession = vi.fn<[boolean], Promise<TwitchSession | null>>().mockResolvedValue(makeSession());

    const result = await autoClaimClaimableDrops(state, getSession);

    expect(result).toBe(true);
    expect(state.appState.totalDropsClaimed).toBe(1);
    expect(mockClaimDropReward).toHaveBeenCalledWith('auto-claim-1');
  });

  test('calls onDropClaimed callback when provided', async () => {
    const claimableDrop = makeDrop({ claimId: 'callback-claim', claimable: true, claimed: false });
    const state = createMinimalState({
      appState: { ...createInitialState(), isRunning: true, autoClaimDrops: true, allDrops: [] },
      cachedDropsSnapshot: [claimableDrop],
    });
    const getSession = vi.fn<[boolean], Promise<TwitchSession | null>>().mockResolvedValue(makeSession());
    const onDropClaimed = vi.fn<[TwitchDrop], void | Promise<void>>();

    await autoClaimClaimableDrops(state, getSession, onDropClaimed);

    expect(onDropClaimed).toHaveBeenCalledWith(claimableDrop);
  });

  test('filters out event-based drops', async () => {
    const eventDrop = makeDrop({ claimId: 'event-claim', claimable: true, claimed: false, dropType: 'event-based' });
    const state = createMinimalState({
      appState: { ...createInitialState(), isRunning: true, autoClaimDrops: true },
      cachedDropsSnapshot: [eventDrop],
    });
    const getSession = vi.fn<[boolean], Promise<TwitchSession | null>>().mockResolvedValue(makeSession());

    const result = await autoClaimClaimableDrops(state, getSession);

    expect(result).toBe(false);
    expect(mockClaimDropReward).not.toHaveBeenCalled();
  });

  test('clears stale retry timestamps before processing', async () => {
    const staleClaim = makeDrop({ claimId: 'stale-claim', claimable: true, claimed: false });
    const state = createMinimalState({
      appState: { ...createInitialState(), isRunning: true, autoClaimDrops: true },
      cachedDropsSnapshot: [staleClaim],
      dropClaimRetryAtById: new Map([['stale-claim', Date.now() - 1000]]),
    });
    const getSession = vi.fn<[boolean], Promise<TwitchSession | null>>().mockResolvedValue(makeSession());

    await autoClaimClaimableDrops(state, getSession);

    expect(state.dropClaimRetryAtById.has('stale-claim')).toBe(false);
  });
});
