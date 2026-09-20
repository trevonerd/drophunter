import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import {
  advanceQueueIfCompleted,
  skipCurrentGameAndAdvanceQueue,
} from '../src/background/session-lifecycle.ts';
import { normalizeQueueMetadata } from '../src/shared/app-state-collection-normalizers.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import { createDrop, createGame, createMinimalState } from './fixtures/queue-management.ts';

const now = Date.parse('2026-09-09T08:00:00Z');
afterEach(() => mock.restore());

function fixture() {
  spyOn(Date, 'now').mockReturnValue(now);
  const offline = createGame({ campaignId: 'offline', endsAt: new Date(now + 3_600_000).toISOString() });
  const later = createGame({ campaignId: 'later', endsAt: new Date(now + 10 * 86_400_000).toISOString() });
  const urgent = createGame({ campaignId: 'urgent', endsAt: new Date(now + 2 * 3_600_000).toISOString() });
  const state = createMinimalState();
  state.appState.isRunning = true;
  state.appState.manualQueueAuthorized = true;
  state.appState.campaignPriorityMode = 'ending-soonest';
  state.appState.selectedGame = offline;
  state.appState.queue = [offline, later, urgent];
  state.appState.availableGames = [...state.appState.queue];
  state.appState.queueEntryMetadataByKey[gameKey(offline)] = {
    source: 'manual',
    reason: 'user-added',
    addedAt: 123,
  };
  return { state, offline, later, urgent };
}

const saveTiming = async () => {};

describe('temporarily unavailable campaign queue', () => {
  test('parks exact campaign, retains manual provenance, and farms earlier expiry next', async () => {
    const { state, offline, urgent, later } = fixture();
    await skipCurrentGameAndAdvanceQueue(state, 'no-streamers', {
      onSaveTimingState: saveTiming,
      onOpenStreamer: async () => true,
    });
    expect(state.appState.selectedGame).toEqual(urgent);
    expect(state.appState.queue).toEqual([urgent, offline, later]);
    expect(state.appState.queueEntryMetadataByKey[gameKey(offline)]).toMatchObject({
      source: 'manual',
      addedAt: 123,
    });
    expect(state.appState.manualQueueAuthorized).toBe(true);
  });

  test('preserves explicitly configured priority list when choosing a successor', async () => {
    const { state, later, offline, urgent } = fixture();
    state.appState.campaignPriorityMode = 'priority-list-only';
    await skipCurrentGameAndAdvanceQueue(state, 'no-streamers', {
      onSaveTimingState: saveTiming,
      onOpenStreamer: async () => true,
    });
    expect(state.appState.selectedGame).toEqual(later);
    expect(state.appState.queue).toEqual([later, offline, urgent]);
  });

  test('all unavailable campaigns wait without removing entries or declaring queue complete', async () => {
    const { state, offline } = fixture();
    state.appState.queue = [offline];
    let stopped = false;
    let searches = 0;
    const notifications: string[] = [];
    await skipCurrentGameAndAdvanceQueue(state, 'no-streamers', {
      onSaveTimingState: saveTiming,
      onOpenStreamer: async () => {
        searches += 1;
        return false;
      },
      onStopFarmingSession: async () => {
        stopped = true;
      },
      onNotify: async (_title, message) => {
        notifications.push(message);
      },
    });
    expect(stopped).toBe(false);
    expect(searches).toBe(0);
    expect(state.appState.queue).toEqual([offline]);
    expect(state.appState.manualQueueAuthorized).toBe(true);
    expect(notifications).toEqual([]);
    expect(state.recoveryBackoffUntil).toBeGreaterThan(now);
    expect(state.recoveryBackoffUntil).toBeLessThanOrEqual(now + 60_000);
  });

  test('completion skips cooling campaign, then restores its deadline priority after cooldown', async () => {
    const { state, offline, urgent, later } = fixture();
    await skipCurrentGameAndAdvanceQueue(state, 'no-streamers', {
      onSaveTimingState: saveTiming,
      onOpenStreamer: async () => true,
    });
    spyOn(Date, 'now').mockReturnValue(now + 60_001);
    state.appState.allDrops = [createDrop({ campaignId: urgent.campaignId, claimed: true })];
    state.appState.pendingDrops = [];
    state.appState.currentDrop = null;
    await advanceQueueIfCompleted(state, {
      onSaveTimingState: saveTiming,
      onRefreshDropsData: async () => {
        const drop = createDrop({ campaignId: state.appState.selectedGame?.campaignId });
        state.appState.allDrops = [drop];
        state.appState.pendingDrops = [drop];
        state.appState.currentDrop = drop;
      },
      onOpenStreamer: async () => true,
    });
    expect(state.appState.selectedGame).toEqual(offline);
    expect(state.appState.queue).toEqual([offline, later]);
  });

  test('does not announce farming when the successor also has no streamer', async () => {
    const { state } = fixture();
    const notifications: string[] = [];
    await skipCurrentGameAndAdvanceQueue(state, 'no-streamers', {
      onSaveTimingState: saveTiming,
      onOpenStreamer: async () => false,
      onNotify: async (_title, message) => {
        notifications.push(message);
      },
    });
    expect(notifications.some((message) => message.includes('Now farming'))).toBe(false);
  });

  test('a successor without a refreshed snapshot does not inherit vanished-drop evidence', async () => {
    const { state, urgent, offline } = fixture();
    state.previousAllDropsCount = 1;
    state.apiBackoffUntil = now + 600_000;
    await skipCurrentGameAndAdvanceQueue(state, 'no-streamers', {
      onSaveTimingState: saveTiming,
      onOpenStreamer: async () => false,
      onRefreshDropsData: async () => {
        throw new Error('Network refresh during cooldown');
      },
    });
    await advanceQueueIfCompleted(state, { onSaveTimingState: saveTiming });
    expect(state.appState.selectedGame).toEqual(urgent);
    expect(state.appState.queue).toContainEqual(urgent);
    expect(state.appState.queue).toContainEqual(offline);
  });

  test('restores valid retry metadata and discards malformed timers without losing manual provenance', () => {
    const metadata = { source: 'manual', reason: 'user-added', addedAt: 123 };
    const restored = normalizeQueueMetadata({
      good: { ...metadata, streamerRetryAt: now + 60_000, streamerRetryCycles: 2 },
      bad: { ...metadata, streamerRetryAt: 'tomorrow', streamerRetryCycles: -1 },
    });
    expect(restored.good).toEqual({
      ...metadata,
      streamerRetryAt: now + 60_000,
      streamerRetryCycles: 2,
    });
    expect(restored.bad).toEqual(metadata);
  });
});
