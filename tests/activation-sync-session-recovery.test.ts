import { expect, test } from 'bun:test';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerActivationSync } from '../src/background/service-worker-activation-sync.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

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
        openedWith.push(options ?? {});
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

test('fresh install worker start leaves opening Twitch Drops to the user', async () => {
  const browserMocks = setupChromeMocks();
  try {
    const { openedWith, performSync, controller } = createSessionRecoveryAttempt(false);

    const result = await performSync('worker-start', {
      signal: controller.signal,
      isCurrent: () => true,
    });

    expect(result).toEqual({ kind: 'needs-session', errorKind: 'auth' });
    expect(openedWith).toEqual([]);
  } finally {
    browserMocks.teardown();
  }
});

test('fresh install worker start without any Twitch session never creates a Drops page', async () => {
  const browserMocks = setupChromeMocks();
  try {
    const state = createServiceWorkerState();
    const openedWith: Array<{ openIfMissing?: boolean }> = [];
    const performSync = createServiceWorkerActivationSync({
      state,
      hasCompletedOnboarding: async () => false,
      refreshGamesCache: async () => ({ kind: 'unavailable' as const, games: [] }),
      dropsPageRefresher: {
        openDropsPageAndRefresh: async (options) => {
          openedWith.push(options ?? {});
          return {
            success: false,
            opened: false,
            refreshed: false,
            gamesCount: 0,
            error: 'Open Twitch Drops so DropHunter can detect your session.',
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
        suppressCampaignUntilRefresh: async () => 'suppressed' as const,
      },
    });

    const result = await performSync('worker-start', {
      signal: new AbortController().signal,
      isCurrent: () => true,
    });

    expect(result).toEqual({ kind: 'needs-session', errorKind: 'session' });
    expect(openedWith.every((options) => options.openIfMissing === false)).toBe(true);
  } finally {
    browserMocks.teardown();
  }
});

test('does not recreate a closed login page after wake', async () => {
  const { openedWith, performSync, controller } = createSessionRecoveryAttempt(true);

  const result = await performSync('wake', {
    signal: controller.signal,
    isCurrent: () => true,
  });

  expect(result).toEqual({ kind: 'needs-session', errorKind: 'auth' });
  expect(openedWith).toEqual([]);
});

test('does not recreate a login page when a favorite is added', async () => {
  const { openedWith, performSync, controller } = createSessionRecoveryAttempt(true);

  const result = await performSync('favorite-change', {
    signal: controller.signal,
    isCurrent: () => true,
  });

  expect(result).toEqual({ kind: 'needs-session', errorKind: 'auth' });
  expect(openedWith).toEqual([]);
});
