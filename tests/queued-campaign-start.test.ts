import { describe, expect, test } from 'bun:test';
import {
  deriveSafeRefreshPatch,
  type FarmingAutomationTwitchSnapshot,
} from '../src/background/farming-automation-twitch.ts';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import type { TwitchDrop, TwitchGame, TwitchStreamer } from '../src/types/index.ts';
import { campaign, fixture } from './support/farming-automation-queue-fixture.ts';

function snapshotFor(games: readonly TwitchGame[]): FarmingAutomationTwitchSnapshot {
  const drops: TwitchDrop[] = games.map((game) => ({
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
  }));
  return {
    games,
    drops,
    campaignDropsByKey: Object.fromEntries(
      games.map((game, index) => [gameKey(game), [drops[index] as TwitchDrop]]),
    ),
    campaignChannelsMap: {},
    updatedAt: 1_000,
  };
}

describe('start a specific queued campaign', () => {
  test('treats an already-running queued campaign as a successful idempotent start', async () => {
    const requested = campaign('manual', '2030-08-04T12:00:00.000Z');
    let refreshCalls = 0;
    const subject = fixture('ending-soonest', {
      running: requested,
      queue: [requested],
      twitch: {
        refresh: async () => {
          refreshCalls += 1;
          throw new Error('Twitch refresh should not gate an already-satisfied start');
        },
        fetchDirectory: async () => ({ kind: 'session-missing' }),
      },
    });

    const result = await subject.automation.startQueuedCampaign?.(gameKey(subject.manual));

    expect(result).toEqual({ success: true });
    expect(refreshCalls).toBe(0);
    expect(subject.state.appState.isRunning).toBe(true);
    expect(subject.state.appState.selectedGame?.campaignId).toBe(subject.manual.campaignId);
  });

  test('does not report a superseded error when the requested campaign starts concurrently', async () => {
    let subject: ReturnType<typeof fixture> | null = null;
    subject = fixture('ending-soonest', {
      twitch: {
        refresh: async () => {
          const current = subject;
          if (!current) throw new Error('Fixture is not initialized');
          current.state.appState.isRunning = true;
          current.state.appState.selectedGame = current.manual;
          return { kind: 'session-missing' };
        },
        fetchDirectory: async () => ({ kind: 'session-missing' }),
      },
    });
    if (!subject) throw new Error('Fixture is not initialized');
    const current = subject;

    const result = await current.automation.startQueuedCampaign?.(gameKey(current.manual));

    expect(result).toEqual({ success: true });
    expect(current.state.appState.isRunning).toBe(true);
    expect(current.state.appState.selectedGame?.campaignId).toBe(current.manual.campaignId);
  });

  test('still reports a real Twitch refresh failure before any campaign starts', async () => {
    const subject = fixture('ending-soonest', {
      twitch: {
        refresh: async () => {
          throw new Error('Twitch unavailable');
        },
        fetchDirectory: async () => ({ kind: 'session-missing' }),
      },
    });

    const result = await subject.automation.startQueuedCampaign?.(gameKey(subject.manual));

    expect(result).toEqual({
      success: false,
      error: 'Unable to refresh Twitch campaigns right now.',
    });
    expect(subject.state.appState.isRunning).toBe(false);
  });

  test('does not let an unrelated campaign directory failure block the requested campaign', async () => {
    const requested = campaign('manual', '2030-08-04T12:00:00.000Z');
    const unrelated = campaign('unrelated', '2030-08-03T12:00:00.000Z');
    const snapshot = snapshotFor([requested, unrelated]);
    const streamer: TwitchStreamer = {
      id: 'streamer',
      name: 'channel',
      displayName: 'Channel',
      isLive: true,
      viewerCount: 1,
    };
    const subject = fixture('ending-soonest', {
      favorite: false,
      queue: [requested],
      twitch: {
        refresh: async () => ({ kind: 'ready', snapshot, refreshPatch: deriveSafeRefreshPatch(snapshot) }),
        fetchDirectory: async (game) =>
          gameKey(game) === gameKey(requested)
            ? {
                kind: 'ready',
                target: {
                  campaignKey: gameKey(game),
                  campaignId: game.campaignId ?? null,
                  gameId: game.id,
                  gameName: game.name,
                  categoryId: game.categoryId ?? null,
                  categorySlug: game.categorySlug ?? game.name,
                },
                streamers: [streamer],
                languageFilterApplied: false,
              }
            : { kind: 'session-missing' },
      },
    });

    const result = await subject.automation.startQueuedCampaign?.(gameKey(requested));

    expect(result).toEqual({ success: true });
    expect(subject.state.appState.selectedGame?.campaignId).toBe(requested.campaignId);
  });

  test('a successful start moves the chosen campaign to the head and protects it from favorite preemption', async () => {
    const subject = fixture('priority-list-only', {
      favoriteEndsAt: '2030-08-02T12:00:00.000Z',
      queue: [campaign('manual', '2030-08-04T12:00:00.000Z')],
    });
    const started = await subject.automation.startQueuedCampaign?.(gameKey(subject.manual));
    const automatic = await subject.automation.request('campaign-refresh');
    expect(started).toEqual({ success: true });
    expect(subject.state.appState.selectedGame?.campaignId).toBe(subject.manual.campaignId);
    expect(subject.state.appState.queue[0]?.campaignId).toBe(subject.manual.campaignId);
    expect(subject.state.appState.forcedCampaignKey).toBe(gameKey(subject.manual));
    expect(subject.state.appState.farmingSessionOrigin).toBe('manual');
    expect(automatic).toEqual({ kind: 'unchanged', reason: 'already-farming-best-campaign' });
    expect(normalizeStoredAppState(structuredClone(subject.state.appState)).forcedCampaignKey).toBe(
      gameKey(subject.manual),
    );
  });

  test('rejects a campaign that is not in the queue, including a different campaign of the same game', async () => {
    const subject = fixture('ending-soonest', { favorite: false });
    const other = { ...subject.manual, campaignId: 'campaign-other' };
    expect(await subject.automation.startQueuedCampaign?.(gameKey(other))).toEqual({
      success: false,
      error: 'Campaign is no longer in the queue.',
    });
    expect(subject.state.appState.selectedGame).toBeNull();
  });

  test('keeps the incumbent when the requested campaign has no eligible streamer', async () => {
    const incumbent = campaign('favorite', '2030-08-02T12:00:00.000Z');
    const subject = fixture('ending-soonest', {
      running: incumbent,
      queue: [incumbent, campaign('manual', '2030-08-04T12:00:00.000Z')],
      eligibleStreamers: [],
    });
    const before = structuredClone(subject.state.appState);
    const result = await subject.automation.startQueuedCampaign?.(gameKey(subject.manual));
    expect(result).toEqual({
      success: false,
      error: 'No eligible streamer is available for this campaign.',
    });
    expect(subject.state.appState).toEqual(before);
  });

  test('a failed preparation leaves the previous selection and queue untouched', async () => {
    const incumbent = campaign('favorite', '2030-08-02T12:00:00.000Z');
    const subject = fixture('ending-soonest', {
      running: incumbent,
      queue: [incumbent, campaign('manual', '2030-08-04T12:00:00.000Z')],
      onPrepare: () => {
        throw new Error('Playback unavailable');
      },
    });
    const before = structuredClone(subject.state.appState);
    const result = await subject.automation.startQueuedCampaign?.(gameKey(subject.manual));
    expect(result?.success).toBe(false);
    expect(subject.state.appState).toEqual(before);
  });

  test('concurrent duplicate commands both report success while only one start commits', async () => {
    let prepares = 0;
    const subject = fixture('ending-soonest', {
      onPrepare: () => {
        prepares += 1;
      },
    });
    const key = gameKey(subject.manual);
    const results = await Promise.all([
      subject.automation.startQueuedCampaign?.(key),
      subject.automation.startQueuedCampaign?.(key),
    ]);
    expect(results).toEqual([{ success: true }, { success: true }]);
    expect(prepares).toBe(1);
    expect(subject.state.appState.selectedGame?.campaignId).toBe(subject.manual.campaignId);
  });
});
