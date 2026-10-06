import { verifyExpectedDiagnostics } from './support/expected-diagnostics.ts';

// These recovery/failure scenarios must emit only their declared diagnostic text.
verifyExpectedDiagnostics([
  ['[DropHunter] Parking campaign because eligible stream playback could not start', 2],
  ['[DropHunter] Parking campaign because no eligible Drops streamer was found', 5],
]);

import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { splitDropsForSelectedGame } from '../src/background/drops-selected-projection.ts';
import { normalizeQueueMetadata } from '../src/shared/app-state-collection-normalizers.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import type { QueueEntryMetadata } from '../src/types/queue.ts';
import { createDrop, createGame, createMinimalState } from './fixtures/queue-management.ts';
import { createQueueProgressionFixture } from './support/queue-progression.ts';

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

describe('temporarily unavailable campaign queue', () => {
  test('playback failure parks its campaign and advances the authorized successor', async () => {
    const { state, offline, urgent } = fixture();
    await createQueueProgressionFixture(state).skipCurrent('open-failed');
    expect(state.appState.selectedGame).toEqual(urgent);
    expect(state.appState.queue).toContainEqual(offline);
    expect(state.appState.queueEntryMetadataByKey[gameKey(offline)]?.streamerRetryReason).toBe('open-failed');
    expect(state.appState.manualQueueAuthorized).toBe(true);
  });

  test('all failed playback waits for a local retry without declaring Twitch unavailable', async () => {
    const { state, offline } = fixture();
    state.appState.queue = [offline];
    await createQueueProgressionFixture(state).skipCurrent('open-failed');
    expect(state.appState.queue).toEqual([offline]);
    expect(state.appState.recoveryReason).toBe('open-failed');
    expect(state.appState.recoveryBackoffUntil).toBeGreaterThan(now);
    expect(state.appState.manualQueueAuthorized).toBe(true);
  });

  test('parks exact campaign, retains manual provenance, and farms earlier expiry next', async () => {
    const { state, offline, urgent, later } = fixture();
    await createQueueProgressionFixture(state).skipCurrent('no-streamers');
    expect(state.appState.selectedGame).toEqual(urgent);
    expect(state.appState.queue).toEqual([urgent, later, offline]);
    expect(state.appState.queueEntryMetadataByKey[gameKey(offline)]).toMatchObject({
      source: 'manual',
      addedAt: 123,
    });
    expect(state.appState.manualQueueAuthorized).toBe(true);
  });

  test('preserves explicitly configured priority list when choosing a successor', async () => {
    const { state, later, offline, urgent } = fixture();
    state.appState.campaignPriorityMode = 'priority-list-only';
    await createQueueProgressionFixture(state).skipCurrent('no-streamers');
    expect(state.appState.selectedGame).toEqual(later);
    expect(state.appState.queue).toEqual([later, urgent, offline]);
  });

  test('all unavailable campaigns wait without removing entries or declaring queue complete', async () => {
    const { state, offline } = fixture();
    state.appState.queue = [offline];
    let stopped = false;
    let searches = 0;
    const notifications: string[] = [];
    await createQueueProgressionFixture(state, {
      transitionCampaign: async () => {
        searches += 1;
        return { kind: 'failed', reason: 'no-streamers', error: 'empty' };
      },
      stopSession: async () => {
        stopped = true;
      },
      notify: async (_title, message) => {
        notifications.push(message);
      },
    }).skipCurrent('no-streamers');
    expect(stopped).toBe(false);
    expect(searches).toBe(0);
    expect(state.appState.queue).toEqual([offline]);
    expect(state.appState.manualQueueAuthorized).toBe(true);
    expect(notifications).toEqual([]);
    expect(state.recoveryBackoffUntil).toBeGreaterThan(now);
    expect(state.recoveryBackoffUntil).toBe(now + 600_000);
  });

  test('completion skips cooling campaign, then restores its deadline priority after cooldown', async () => {
    const { state, offline, urgent, later } = fixture();
    await createQueueProgressionFixture(state).skipCurrent('no-streamers');
    spyOn(Date, 'now').mockReturnValue(now + 60_001);
    // Completion provides fresh progress evidence; playback alone cannot reset the round.
    splitDropsForSelectedGame(
      state,
      [createDrop({ campaignId: urgent.campaignId, progress: 10, currentMinutes: 1 })],
      true,
    );
    splitDropsForSelectedGame(
      state,
      [createDrop({ campaignId: urgent.campaignId, progress: 100, currentMinutes: 10, claimed: true })],
      true,
    );
    state.appState.allDrops = [createDrop({ campaignId: urgent.campaignId, claimed: true })];
    state.appState.pendingDrops = [];
    state.appState.currentDrop = null;
    await createQueueProgressionFixture(state).advanceIfCompleted();
    expect(state.appState.selectedGame).toEqual(offline);
    expect(state.appState.queue).toEqual([offline, later]);
  });

  test('does not announce farming when the successor also has no streamer', async () => {
    const { state } = fixture();
    const notifications: string[] = [];
    await createQueueProgressionFixture(state, {
      transitionCampaign: async () => ({ kind: 'failed', reason: 'no-streamers', error: 'empty' }),
      notify: async (_title, message) => {
        notifications.push(message);
      },
    }).skipCurrent('no-streamers');
    expect(notifications.some((message) => message.includes('Now farming'))).toBe(false);
  });

  test('restores valid retry metadata and discards malformed timers without losing manual provenance', () => {
    const metadata: QueueEntryMetadata = { source: 'manual', reason: 'user-added', addedAt: 123 };
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
