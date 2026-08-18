import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test';
import { autoClaimClaimableDrops } from '../../src/background/auto-claim.ts';
import { loadClaimLog } from '../../src/background/claim-log.ts';
import type { TwitchSession } from '../../src/background/twitch-api/types.ts';
import { createInitialState } from '../../src/shared/utils.ts';
import type { TwitchDrop } from '../../src/types/index.ts';
import {
  createMinimalState,
  makeDrop,
  makeSession,
  mockClaimDropReward,
  setupClaimApiMocks,
  teardownClaimApiMocks,
} from '../fixtures/auto-claim-drops.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';

export function registerAutoClaimClaimableDropsCases() {
  describe('autoClaimClaimableDrops', () => {
    let mocks: ChromeMocks;

    beforeEach(() => {
      mocks = setupClaimApiMocks();
    });

    afterEach(() => {
      teardownClaimApiMocks(mocks);
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
      const claimableDrop = makeDrop({ claimId: 'auto-claim-1', claimable: true, claimed: false });
      const state = createMinimalState({
        appState: {
          ...createInitialState(),
          isRunning: true,
          autoClaimDrops: true,
          allDrops: [claimableDrop],
        },
        cachedDropsSnapshot: [claimableDrop],
      });
      const getSession = vi.fn<[boolean], Promise<TwitchSession | null>>().mockResolvedValue(makeSession());

      const result = await autoClaimClaimableDrops(state, getSession);

      expect(result).toBe(true);
      expect(state.appState.totalDropsClaimed).toBe(1);
      expect(mockClaimDropReward).toHaveBeenCalledWith('auto-claim-1');
      expect((await loadClaimLog()).map((entry) => entry.dropId)).toEqual(['drop-1']);
    });

    test('projects a successful Twitch-native auto-claim to verified acquisition before logging', async () => {
      const claimableDrop = makeDrop({
        id: 'auto-native-claim',
        claimId: 'auto-native-claim-id',
        claimable: true,
        claimed: false,
        rewardKind: 'twitch-badge',
        verificationState: 'unassessed',
      });
      const state = createMinimalState({
        appState: { ...createInitialState(), isRunning: true, autoClaimDrops: true },
        cachedDropsSnapshot: [claimableDrop],
      });
      const getSession = vi.fn<[boolean], Promise<TwitchSession | null>>().mockResolvedValue(makeSession());

      expect(await autoClaimClaimableDrops(state, getSession)).toBe(true);
      expect(state.cachedDropsSnapshot[0]?.verificationState).toBe('verified');
      expect(state.appState.totalDropsClaimed).toBe(1);
      expect((await loadClaimLog()).map((entry) => entry.dropId)).toEqual(['auto-native-claim']);
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

    test('filters out subscription-gated rewards', async () => {
      const eventDrop = makeDrop({
        claimId: 'event-claim',
        claimable: true,
        claimed: false,
        acquisitionMethod: 'subscription',
      });
      const state = createMinimalState({
        appState: { ...createInitialState(), isRunning: true, autoClaimDrops: true },
        cachedDropsSnapshot: [eventDrop],
      });
      const getSession = vi.fn<[boolean], Promise<TwitchSession | null>>().mockResolvedValue(makeSession());

      const result = await autoClaimClaimableDrops(state, getSession);

      expect(result).toBe(false);
      expect(mockClaimDropReward).not.toHaveBeenCalled();
    });

    test('targets only automatable rewards while keeping unknown rewards eligible', async () => {
      const watchTimeDrop = makeDrop({
        claimId: 'watch-time-claim',
        claimable: true,
        claimed: false,
        acquisitionMethod: 'watch-time',
      });
      const unknownDrop = makeDrop({
        claimId: 'unknown-claim',
        claimable: true,
        claimed: false,
        acquisitionMethod: 'unknown',
      });
      const subscriptionDrop = makeDrop({
        claimId: 'subscription-claim',
        claimable: true,
        claimed: false,
        acquisitionMethod: 'subscription',
      });
      const unverifiableNativeDrop = makeDrop({
        claimId: 'unverifiable-claim',
        claimable: true,
        claimed: false,
        rewardKind: 'twitch-badge',
        verificationState: 'unverifiable',
      });
      const state = createMinimalState({
        appState: { ...createInitialState(), isRunning: true, autoClaimDrops: true },
        cachedDropsSnapshot: [watchTimeDrop, unknownDrop, subscriptionDrop, unverifiableNativeDrop],
      });
      const getSession = vi.fn<[boolean], Promise<TwitchSession | null>>().mockResolvedValue(makeSession());

      const result = await autoClaimClaimableDrops(state, getSession);

      expect(result).toBe(true);
      expect(mockClaimDropReward).toHaveBeenCalledTimes(2);
      expect(mockClaimDropReward).toHaveBeenNthCalledWith(1, 'watch-time-claim');
      expect(mockClaimDropReward).toHaveBeenNthCalledWith(2, 'unknown-claim');
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
}
