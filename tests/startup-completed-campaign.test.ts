import { afterEach, describe, expect, test } from 'bun:test';
import { LAST_ACTIVITY_AT_KEY, TIMING_STATE_KEY } from '../src/background/constants.ts';
import { applyStopState } from '../src/background/recovery-state.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerStateLifecycle } from '../src/background/service-worker-state-lifecycle.ts';
import { advanceQueueIfCompleted } from '../src/background/session-lifecycle-queue.ts';
import { saveState } from '../src/background/state-persistence.ts';
import {
  EXTENSION_VERSION_STORAGE_KEY,
  STORAGE_SCHEMA_VERSION,
  STORAGE_SCHEMA_VERSION_KEY,
} from '../src/background/storage-migrations.ts';
import { createInitialState } from '../src/shared/utils.ts';
import type { TwitchGame } from '../src/types';
import { type ChromeMocks, setupChromeMocks } from './mocks/chrome.ts';

const completed: TwitchGame = {
  id: 'game',
  campaignId: 'completed',
  name: 'Completed campaign',
  imageUrl: '',
  allDropsCompleted: true,
};
const next: TwitchGame = {
  id: 'game',
  campaignId: 'next',
  name: 'Next campaign',
  imageUrl: '',
};
let mocks: ChromeMocks | undefined;

afterEach(() => {
  mocks?.teardown();
  mocks = undefined;
});

async function resume(game: TwitchGame, withNext: boolean, heartbeatAge = 1_000, selected = true) {
  mocks = setupChromeMocks();
  const saved = createInitialState();
  saved.isRunning = true;
  saved.campaignEvidenceUserId = 'test-user';
  saved.autoResumeOnStartup = true;
  saved.manualQueueAuthorized = true;
  saved.selectedGame = selected ? game : null;
  saved.queue = withNext ? [game, next] : [game];
  saved.availableGames = [game, next];
  saved.tabId = 12;
  await mocks.storage.local.set({
    appState: saved,
    [STORAGE_SCHEMA_VERSION_KEY]: STORAGE_SCHEMA_VERSION,
    [EXTENSION_VERSION_STORAGE_KEY]: '4.0.0',
    [LAST_ACTIVITY_AT_KEY]: Date.now(),
    [TIMING_STATE_KEY]: { lastHeartbeatAt: Date.now() - heartbeatAge },
  });
  const state = createServiceWorkerState();
  const events: string[] = [];
  const acquireStreamerForSelectedGame = async () => {
    events.push(`acquire:${state.appState.selectedGame?.campaignId}`);
    return true;
  };
  const farmingSession = {
    acquireStreamerForSelectedGame,
    startMonitoring: () => {
      events.push(`monitor:${state.appState.selectedGame?.campaignId}`);
    },
    stopMonitoring: () => {
      events.push('stop-monitoring');
    },
    stop: async () => {},
    advanceQueueIfCompleted: async () =>
      advanceQueueIfCompleted(state, {
        onOpenStreamer: acquireStreamerForSelectedGame,
        onCloseManagedTabIfSafe: async (tabId) => {
          events.push(`close:${tabId}`);
        },
        onClearManagedTabOwnership: () => {
          state.appState.tabId = null;
        },
        onStopMonitoring: () => {
          events.push('stop-monitoring');
        },
        onApplyStopState: applyStopState,
        onSaveState: () => saveState(state),
        onSaveTimingState: async () => {},
      }),
  };
  const lifecycle = createServiceWorkerStateLifecycle(state, { getFarmingSession: () => farmingSession });
  await lifecycle.beginInitialization(async () => {});
  return { state, events };
}

describe('startup persisted completed campaign', () => {
  test.each([1_000, 600_000])('advances before monitoring after a %i ms heartbeat gap', async (age) => {
    const { state, events } = await resume(completed, true, age);

    expect(state.appState.selectedGame?.campaignId).toBe('next');
    expect(events).toEqual(['acquire:next', 'monitor:next']);
    expect(state.appState.queue.map((game) => game.campaignId)).toEqual(['next']);
  });

  test('advances a persisted completed head when selected campaign is missing', async () => {
    const { state, events } = await resume(completed, true, 1_000, false);

    expect(state.appState.selectedGame?.campaignId).toBe('next');
    expect(events).toEqual(['acquire:next', 'monitor:next']);
  });

  test('stops and releases managed ownership through lifecycle when no campaign remains', async () => {
    const { state, events } = await resume(completed, false);

    expect(state.appState.isRunning).toBe(false);
    expect(state.appState.lastStopReason).toBe('queue-complete');
    expect(state.appState.tabId).toBeNull();
    expect(events).toEqual(['close:12', 'stop-monitoring']);
  });

  test('keeps farming-complete truth instead of treating gated rewards as acquired', async () => {
    const { state, events } = await resume(
      {
        ...next,
        rewardSummary: { completion: 'farming-complete', remainderReasons: ['subscription-required'] },
      },
      false,
    );

    expect(state.appState.isRunning).toBe(false);
    expect(state.appState.lastStopReason).toBe('farming-complete');
    expect(state.appState.selectedGame?.allDropsCompleted).not.toBe(true);
    expect(events).toEqual(['close:12', 'stop-monitoring']);
  });

  test('preserves ordinary startup monitoring for a campaign without completion evidence', async () => {
    const { state, events } = await resume(next, false);

    expect(state.appState.isRunning).toBe(true);
    expect(events).toEqual(['monitor:next']);
  });

  test.each([
    {
      ...completed,
      allDropsCompleted: false,
      rewardSummary: { completion: 'all-acquired', remainderReasons: [] },
    },
    { ...completed, allDropsCompleted: false, expiresInMs: 0 },
  ] satisfies TwitchGame[])('advances a terminal summary or expired campaign with no restored drops: %j', async (game) => {
    const { state, events } = await resume(game, true);

    expect(state.appState.selectedGame?.campaignId).toBe('next');
    expect(events).toEqual(['acquire:next', 'monitor:next']);
  });
});
