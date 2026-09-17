import { expect, test } from 'bun:test';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerActivationSync } from '../src/background/service-worker-activation-sync.ts';

function createSessionRecoveryAttempt(
  onboardingCompleted: boolean,
  failureKind: 'auth' | 'integrity' = 'auth',
) {
  const state = createServiceWorkerState();
  const openedWith: Array<{ active?: boolean; openIfMissing?: boolean; waitForExistingTabMs?: number }> = [];
  const performSync = createServiceWorkerActivationSync({
    state,
    hasCompletedOnboarding: async () => onboardingCompleted,
    refreshGamesCache: async () => ({
      kind: 'unavailable' as const,
      games: [],
      failure: { kind: failureKind, message: 'Saved Twitch session is unavailable.' },
    }),
    dropsPageRefresher: {
      openDropsPageAndRefresh: async (options) => {
        openedWith.push(options);
        return {
          success: true,
          opened: true,
          refreshed: true,
          gamesCount: 1,
          inventoryVerified: true,
        };
      },
    },
    farmingSession: {
      acquireStreamerForSelectedGame: async () => false,
      advanceQueueIfCompleted: async () => true,
      handleStartFarming: async () => ({ success: false }),
    },
    automation: {
      request: async () => ({ kind: 'unchanged' as const, reason: 'no-eligible-campaign' as const }),
      snooze: async () => 'snoozed' as const,
      suppressCampaignUntilRefresh: async () => 'suppressed' as const,
    },
  });
  const controller = new AbortController();
  return { openedWith, performSync, controller };
}

test('does not open Twitch Drops automatically during the first run', async () => {
  const { openedWith, performSync, controller } = createSessionRecoveryAttempt(false);

  const result = await performSync('wake', {
    signal: controller.signal,
    isCurrent: () => true,
  });

  expect(result).toEqual({ kind: 'needs-session', errorKind: 'auth' });
  expect(openedWith).toEqual([]);
});

test('does not open Twitch Drops for integrity recovery during the first run', async () => {
  const { openedWith, performSync, controller } = createSessionRecoveryAttempt(false, 'integrity');

  const result = await performSync('wake', {
    signal: controller.signal,
    isCurrent: () => true,
  });

  expect(result).toEqual({ kind: 'needs-session', errorKind: 'integrity' });
  expect(openedWith).toEqual([]);
});

test('opens Twitch Drops in the background after wake once onboarding is complete', async () => {
  const { openedWith, performSync, controller } = createSessionRecoveryAttempt(true);

  const result = await performSync('wake', {
    signal: controller.signal,
    isCurrent: () => true,
  });

  expect(result).toEqual({ kind: 'synced', campaignCount: 1 });
  expect(openedWith).toHaveLength(1);
  expect(openedWith[0]).toMatchObject({ active: false, openIfMissing: true, waitForExistingTabMs: 10_000 });
});
