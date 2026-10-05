import { verifyExpectedDiagnostics } from './support/expected-diagnostics.ts';

// These recovery/failure scenarios must emit only their declared diagnostic text.
verifyExpectedDiagnostics([
  ['[DropHunter] Parking campaign because no eligible Drops streamer was found', 2],
]);

import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { cheapFarmingAutomationGate } from '../src/background/farming-automation-gates.ts';
import {
  deriveSafeRefreshPatch,
  type FarmingAutomationTwitchAdapter,
  type FarmingAutomationTwitchSnapshot,
} from '../src/background/farming-automation-twitch.ts';
import { skipCurrentGameAndAdvanceQueue, stopFarmingSession } from '../src/background/session-lifecycle.ts';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import type { TwitchDrop, TwitchGame, TwitchStreamer } from '../src/types/index.ts';
import { createDrop, createGame, createMinimalState } from './fixtures/queue-management.ts';
import { fixture } from './support/farming-automation-queue-fixture.ts';

const now = Date.parse('2026-09-23T12:00:00.000Z');
afterEach(() => mock.restore());

function campaign(id: string): TwitchGame {
  return {
    id: 'same-game',
    name: 'Same game',
    imageUrl: '',
    campaignId: id,
    endsAt: new Date(now + 86_400_000).toISOString(),
    rewardSummary: { completion: 'farmable', remainderReasons: [] },
  };
}

function drop(game: TwitchGame): TwitchDrop {
  return {
    id: `drop-${game.campaignId}`,
    name: 'Reward',
    gameId: game.id,
    gameName: game.name,
    imageUrl: '',
    progress: 0,
    currentMinutes: 0,
    claimed: false,
    campaignId: game.campaignId,
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
  };
}

describe('continuous availability recovery queue', () => {
  test('a future reward does not hide a queue whose streamer checks are exhausted', async () => {
    spyOn(Date, 'now').mockReturnValue(now);
    const state = createMinimalState();
    const unavailable = createGame({ id: 'unavailable', campaignId: 'unavailable' });
    const scheduled = createGame({ id: 'scheduled', campaignId: 'scheduled' });
    state.appState.isRunning = true;
    state.appState.manualQueueAuthorized = true;
    state.appState.campaignPriorityMode = 'priority-list-only';
    state.appState.selectedGame = unavailable;
    state.appState.queue = [unavailable, scheduled];
    state.appState.availableGames = [unavailable, scheduled];
    state.appState.queueEntryMetadataByKey[gameKey(unavailable)] = {
      source: 'manual',
      reason: 'user-added',
      addedAt: now,
      streamerRetryCycles: 2,
    };
    state.appState.queueEntryMetadataByKey[gameKey(scheduled)] = {
      source: 'manual',
      reason: 'user-added',
      addedAt: now,
    };
    const waitingTransitions: number[] = [];
    await skipCurrentGameAndAdvanceQueue(state, 'no-streamers', {
      onRefreshDropsData: async () => {
        state.appState.allDrops = [
          createDrop({
            gameId: scheduled.id,
            campaignId: scheduled.campaignId,
            startsAt: new Date(now + 3_600_000).toISOString(),
          }),
        ];
        state.appState.pendingDrops = [...state.appState.allDrops];
      },
      onOpenStreamer: async () => {
        throw new Error('Future reward cannot start playback');
      },
      onSaveState: async () => {},
      onSaveTimingState: async () => {},
      onQueueWaiting: async (transitionAt) => {
        waitingTransitions.push(transitionAt);
      },
    });
    expect(state.appState.isRunning).toBe(true);
    expect(state.appState.isPaused).toBe(false);
    expect(state.appState.queueResumeOnAvailability).toBe(false);
    expect(state.appState.queue).toHaveLength(2);
    expect(waitingTransitions).toEqual([now]);
  });

  test('an explicit Stop cancels the durable resume intent', async () => {
    const subject = fixture('priority-list-only', { favorite: false });
    subject.state.appState.autoStartFavoriteGames = false;
    subject.state.appState.queueResumeOnAvailability = true;
    subject.state.appState.manualQueueAuthorized = true;
    subject.state.appState.queueEntryMetadataByKey[gameKey(subject.manual)] = {
      source: 'manual',
      reason: 'user-added',
      addedAt: now,
      streamerWaitState: 'availability',
    };
    await stopFarmingSession(subject.state, {
      stopReason: 'user-stop',
      onSaveState: async () => {},
      onSaveTimingState: async () => {},
    });
    expect(subject.state.appState.queueResumeOnAvailability).toBe(false);
    expect(subject.state.appState.manualQueueAuthorized).toBe(false);
    expect(
      subject.state.appState.queueEntryMetadataByKey[gameKey(subject.manual)]?.streamerWaitState,
    ).toBeUndefined();
    expect(cheapFarmingAutomationGate(subject.state, false)).toEqual({
      kind: 'unchanged',
      reason: 'disabled',
    });
  });

  test('three unavailable campaigns wait without acquisition, then resume after a worker restart', async () => {
    spyOn(Date, 'now').mockReturnValue(now);
    const games = ['first', 'second', 'third'].map(campaign);
    const drops = games.map(drop);
    const snapshot: FarmingAutomationTwitchSnapshot = {
      games,
      drops,
      campaignDropsByKey: Object.fromEntries(games.map((game, index) => [gameKey(game), [drops[index]]])),
      campaignChannelsMap: {},
      updatedAt: now,
    };
    const streamer: TwitchStreamer = {
      id: 'eligible',
      name: 'eligible',
      displayName: 'Eligible',
      isLive: true,
      viewerCount: 2,
    };
    let availableCampaign: string | null = null;
    let directoryFails = false;
    let checks = 0;
    const twitch: FarmingAutomationTwitchAdapter = {
      refresh: async () => ({ kind: 'ready', snapshot, refreshPatch: deriveSafeRefreshPatch(snapshot) }),
      fetchDirectory: async (game) => {
        checks += 1;
        if (directoryFails && game.campaignId === 'second') throw new Error('Twitch directory unavailable');
        return {
          kind: 'ready',
          target: {
            campaignKey: gameKey(game),
            campaignId: game.campaignId ?? null,
            gameId: game.id,
            gameName: game.name,
            categoryId: null,
            categorySlug: game.name,
          },
          streamers: game.campaignId === availableCampaign ? [streamer] : [],
          languageFilterApplied: false,
        };
      },
    };
    const initial = fixture('priority-list-only', { twitch, favorite: false, now: () => now });
    const state = initial.state;
    state.appState.autoStartFavoriteGames = false;
    state.appState.manualQueueAuthorized = true;
    state.appState.isRunning = true;
    state.appState.selectedGame = games[0];
    state.appState.queue = [...games];
    state.appState.queueEntryMetadataByKey = Object.fromEntries(
      games.map((game, index) => [
        gameKey(game),
        {
          source: 'manual' as const,
          reason: 'user-added' as const,
          addedAt: now,
          ...(index > 0
            ? { streamerRetryCycles: 3, streamerWaitState: 'availability' as const }
            : { streamerRetryCycles: 2 }),
        },
      ]),
    );
    let stoppedMonitoring = 0;
    const waitingTransitions: number[] = [];
    await skipCurrentGameAndAdvanceQueue(state, 'no-streamers', {
      onStopMonitoring: () => {
        stoppedMonitoring += 1;
      },
      onSaveState: async () => {},
      onSaveTimingState: async () => {},
      onQueueWaiting: async (transitionAt) => {
        waitingTransitions.push(transitionAt);
      },
      onOpenStreamer: async () => {
        throw new Error('No acquisition should run while waiting');
      },
    });
    expect(state.appState.isRunning).toBe(true);
    expect(state.appState.queueResumeOnAvailability).toBe(false);
    const deadline = state.appState.queueAcquisitionRound?.nextRoundAt;
    expect(deadline).toBe(now + 600_000);
    expect(state.appState.queue).toHaveLength(3);
    expect(waitingTransitions).toEqual([now]);
    expect(stoppedMonitoring).toBe(0);
    expect(
      games.every(
        (game) => state.appState.queueEntryMetadataByKey[gameKey(game)]?.streamerWaitState === 'availability',
      ),
    ).toBe(true);

    const restarted = fixture('priority-list-only', { twitch, favorite: false, now: () => now });
    restarted.state.appState = normalizeStoredAppState(structuredClone(state.appState));
    directoryFails = true;
    await restarted.automation.request('campaign-refresh');
    expect(restarted.state.appState.isRunning).toBe(true);
    expect(restarted.state.appState.queueAcquisitionRound?.nextRoundAt).toBe(deadline);
    expect(restarted.state.appState.queueEntryMetadataByKey[gameKey(games[1])]?.streamerWaitState).toBe(
      'availability',
    );
    const before = checks;
    await restarted.automation.request('periodic');
    expect(checks).toBeGreaterThan(before);
    expect(restarted.state.appState.isRunning).toBe(true);
    expect(restarted.state.appState.queueAcquisitionRound?.nextRoundAt).toBe(deadline);

    directoryFails = false;
    availableCampaign = 'second';
    const outcome = await restarted.automation.request('campaign-refresh');
    expect(outcome.kind).toBe('unchanged');
    expect(restarted.state.appState.selectedGame?.campaignId).toBe('second');
    expect(restarted.state.appState.queueResumeOnAvailability).toBe(false);
    expect(restarted.state.appState.recoveryBackoffUntil).toBe(now);
    expect(restarted.state.appState.queueAcquisitionRound?.attemptedCampaignKeys).not.toContain(
      gameKey(games[1]),
    );
    expect(
      restarted.state.appState.queueEntryMetadataByKey[gameKey(games[1])]?.streamerWaitState,
    ).toBeUndefined();
  });
});
