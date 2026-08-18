import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test';
import { claimDropViaApi } from '../../src/background/auto-claim.ts';
import { DROP_CLAIM_RETRY_COOLDOWN_MS } from '../../src/background/constants.ts';
import type { TwitchSession } from '../../src/background/twitch-api/types.ts';
import {
  createMinimalState,
  makeDrop,
  makeSession,
  mockClaimDropReward,
  setupClaimApiMocks,
  teardownClaimApiMocks,
} from '../fixtures/auto-claim-drops.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';

export function registerClaimDropViaApiCases() {
  describe('claimDropViaApi', () => {
    let mocks: ChromeMocks;

    beforeEach(() => {
      mocks = setupClaimApiMocks();
    });

    afterEach(() => {
      teardownClaimApiMocks(mocks);
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

    test('refreshes the session and retries immediately when Twitch does not confirm the first claim', async () => {
      const drop = makeDrop({ claimId: 'ambiguous-claim' });
      const state = createMinimalState();
      const getSession = vi.fn<[boolean], Promise<TwitchSession | null>>().mockResolvedValue(makeSession());
      mockClaimDropReward.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      const result = await claimDropViaApi(state, drop, getSession);

      expect(result).toBe(true);
      expect(mockClaimDropReward).toHaveBeenCalledTimes(2);
      expect(getSession).toHaveBeenNthCalledWith(1, false);
      expect(getSession).toHaveBeenNthCalledWith(2, true);
      expect(state.dropClaimRetryAtById.has('ambiguous-claim')).toBe(false);
    });

    test('retries immediately after a recoverable claim error', async () => {
      const drop = makeDrop({ claimId: 'recoverable-claim' });
      const state = createMinimalState();
      const getSession = vi.fn<[boolean], Promise<TwitchSession | null>>().mockResolvedValue(makeSession());
      mockClaimDropReward
        .mockRejectedValueOnce(new TypeError('temporary network failure'))
        .mockResolvedValueOnce(true);

      const result = await claimDropViaApi(state, drop, getSession);

      expect(result).toBe(true);
      expect(mockClaimDropReward).toHaveBeenCalledTimes(2);
      expect(getSession).toHaveBeenNthCalledWith(1, false);
      expect(getSession).toHaveBeenNthCalledWith(2, true);
    });

    test('sets retry timestamp only after two failed claims', async () => {
      const drop = makeDrop({ claimId: 'fail-claim' });
      const state = createMinimalState();
      const getSession = vi.fn<[boolean], Promise<TwitchSession | null>>().mockResolvedValue(makeSession());
      mockClaimDropReward.mockResolvedValue(false);

      await claimDropViaApi(state, drop, getSession);

      const retryAt = state.dropClaimRetryAtById.get('fail-claim');
      expect(retryAt).toBeGreaterThan(Date.now());
      expect(mockClaimDropReward).toHaveBeenCalledTimes(2);
      expect(getSession).toHaveBeenNthCalledWith(1, false);
      expect(getSession).toHaveBeenNthCalledWith(2, true);

      expect(await claimDropViaApi(state, drop, getSession)).toBe(false);
      expect(mockClaimDropReward).toHaveBeenCalledTimes(2);
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
}
