import { describe, expect, test } from 'bun:test';
import {
  deriveSafeRefreshPatch,
  FarmingAutomationRefreshBackoffError,
  type FarmingAutomationTwitchSnapshot,
} from '../src/background/farming-automation-twitch.ts';
import { TwitchDirectoryUnavailableError, TwitchHttpError } from '../src/background/twitch-api/errors.ts';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import type { TwitchDrop, TwitchGame, TwitchStreamer } from '../src/types/index.ts';
import { createDeferred } from './support/farming-automation-fixtures.ts';
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

  test('a late fresh snapshot is discarded after Stop invalidates the queued start', async () => {
    const entered = createDeferred<void>();
    const resume = createDeferred<void>();
    const subject = fixture('ending-soonest', {
      twitch: {
        refresh: async () => {
          entered.resolve(undefined);
          await resume.promise;
          return { kind: 'session-missing' };
        },
        fetchDirectory: async () => ({ kind: 'session-missing' }),
      },
    });

    const starting = subject.automation.startQueuedCampaign?.(gameKey(subject.manual));
    await entered.promise;
    subject.automation.invalidate?.();
    resume.resolve(undefined);

    expect(await starting).toEqual({
      success: false,
      error: 'Campaign start was superseded by another action.',
    });
    expect(subject.state.appState.selectedGame).toBeNull();
    expect(subject.state.appState.queue).toEqual([subject.manual]);
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

  test('queued Play finds a restricted live channel outside both directory result sets', async () => {
    const requested = { ...campaign('manual', '2030-08-04T12:00:00.000Z'), allowedChannels: ['allowed'] };
    const snapshot = snapshotFor([requested]);
    const languages: string[] = [];
    const directoryModes: string[] = [];
    const subject = fixture('ending-soonest', {
      favorite: false,
      queue: [requested],
      twitch: {
        refresh: async () => ({ kind: 'ready', snapshot, refreshPatch: deriveSafeRefreshPatch(snapshot) }),
        fetchDirectory: async (game, language, options) => {
          languages.push(language ?? '');
          directoryModes.push(`${options?.sessionRecoveryMode}:${options?.preserveSessionOnAuthFailure}`);
          return {
            kind: 'ready',
            target: {
              campaignKey: gameKey(game),
              campaignId: game.campaignId ?? null,
              gameId: game.id,
              gameName: game.name,
              categoryId: game.categoryId ?? null,
              categorySlug: game.categorySlug ?? game.name,
            },
            streamers: language
              ? [{ id: 'unrelated', name: 'unrelated', displayName: 'Unrelated', isLive: true }]
              : [],
            languageFilterApplied: Boolean(language),
          };
        },
        probeStreamInfo: async (channel) => ({
          kind: 'live',
          streamer: { id: '42', name: channel, displayName: channel, isLive: true },
          categoryLabel: 'manual',
        }),
      },
    });
    subject.state.appState.preferredStreamerLanguage = 'it';

    const result = await subject.automation.startQueuedCampaign?.(gameKey(requested));

    expect(result).toEqual({ success: true });
    expect(languages).toEqual(['it', '']);
    expect(directoryModes).toEqual(['passive:true', 'passive:true']);
    expect(subject.state.appState.selectedGame?.campaignId).toBe(requested.campaignId);
  });

  test('queued Play leaves retry and availability state unchanged when channel verification is incomplete', async () => {
    const requested = { ...campaign('manual', '2030-08-04T12:00:00.000Z'), allowedChannels: ['allowed'] };
    const snapshot = snapshotFor([requested]);
    const subject = fixture('ending-soonest', {
      favorite: false,
      queue: [requested],
      twitch: {
        refresh: async () => ({ kind: 'ready', snapshot, refreshPatch: deriveSafeRefreshPatch(snapshot) }),
        fetchDirectory: async (game) => ({
          kind: 'ready',
          target: {
            campaignKey: gameKey(game),
            campaignId: game.campaignId ?? null,
            gameId: game.id,
            gameName: game.name,
            categoryId: game.categoryId ?? null,
            categorySlug: game.categorySlug ?? game.name,
          },
          streamers: [],
          languageFilterApplied: false,
        }),
        probeStreamInfo: async () => ({ kind: 'unavailable' }),
      },
    });
    const before = structuredClone(subject.state.appState);

    const result = await subject.automation.startQueuedCampaign?.(gameKey(requested));

    expect(result).toEqual({
      success: false,
      error: 'Unable to check streamers for this campaign right now.',
    });
    expect(subject.state.appState).toEqual(before);
  });

  test('queued Play preserves scheduled retry copy after direct StreamInfo is rate limited', async () => {
    const requested = { ...campaign('manual', '2030-08-04T12:00:00.000Z'), allowedChannels: ['allowed'] };
    const snapshot = snapshotFor([requested]);
    const subject = fixture('ending-soonest', {
      favorite: false,
      queue: [requested],
      twitch: {
        refresh: async () => ({ kind: 'ready', snapshot, refreshPatch: deriveSafeRefreshPatch(snapshot) }),
        fetchDirectory: async (game) => ({
          kind: 'ready',
          target: {
            campaignKey: gameKey(game),
            campaignId: game.campaignId ?? null,
            gameId: game.id,
            gameName: game.name,
            categoryId: game.categoryId ?? null,
            categorySlug: game.categorySlug ?? game.name,
          },
          streamers: [],
          languageFilterApplied: false,
        }),
        probeStreamInfo: async () => {
          subject.state.apiBackoffUntil = Date.now() + 60_000;
          return {
            kind: 'unavailable',
            cause: new TwitchDirectoryUnavailableError(new TwitchHttpError('gql', 429, 60_000)),
          };
        },
      },
    });

    const result = await subject.automation.startQueuedCampaign?.(gameKey(requested));

    expect(result).toEqual({ success: false, error: 'Twitch is waiting for its scheduled retry.' });
    expect(subject.state.appState.isRunning).toBe(false);
  });

  test('queued Play reports session auth failure without replacing the incumbent', async () => {
    const incumbent = campaign('favorite', '2030-08-02T12:00:00.000Z');
    const requested = campaign('manual', '2030-08-04T12:00:00.000Z');
    const snapshot = snapshotFor([requested, incumbent]);
    const subject = fixture('ending-soonest', {
      running: incumbent,
      queue: [incumbent, requested],
      twitch: {
        refresh: async () => ({ kind: 'ready', snapshot, refreshPatch: deriveSafeRefreshPatch(snapshot) }),
        fetchDirectory: async () => {
          throw new TwitchDirectoryUnavailableError(new TwitchHttpError('gql', 401));
        },
      },
    });
    const before = structuredClone(subject.state.appState);

    const result = await subject.automation.startQueuedCampaign?.(gameKey(requested));

    expect(result).toEqual({
      success: false,
      error: 'Unable to refresh your Twitch session. Open Twitch and sign in.',
    });
    expect(subject.state.appState).toEqual(before);
  });

  test('queued Play rejects a fresh campaign with unknown completion classification', async () => {
    const requested = { ...campaign('manual', '2030-08-04T12:00:00.000Z'), rewardSummary: undefined };
    const snapshot = { ...snapshotFor([requested]), drops: [], campaignDropsByKey: {} };
    const subject = fixture('ending-soonest', {
      favorite: false,
      queue: [requested],
      eligibleStreamers: [{ id: 'streamer', name: 'channel', displayName: 'Channel', isLive: true }],
      twitch: {
        refresh: async () => ({ kind: 'ready', snapshot, refreshPatch: deriveSafeRefreshPatch(snapshot) }),
        fetchDirectory: async (game) => ({
          kind: 'ready',
          target: {
            campaignKey: gameKey(game),
            campaignId: game.campaignId ?? null,
            gameId: game.id,
            gameName: game.name,
            categoryId: game.categoryId ?? null,
            categorySlug: game.categorySlug ?? game.name,
          },
          streamers: [{ id: 'streamer', name: 'channel', displayName: 'Channel', isLive: true }],
          languageFilterApplied: false,
        }),
      },
    });

    const result = await subject.automation.startQueuedCampaign?.(gameKey(requested));

    expect(result).toEqual({ success: false, error: 'Campaign is no longer available.' });
    expect(subject.state.appState.isRunning).toBe(false);
    expect(subject.state.appState.selectedGame).toBeNull();
  });

  test('queued Play rejects a zero-result refresh with unknown completion classification', async () => {
    const requested = campaign('manual', '2030-08-04T12:00:00.000Z');
    const initialSnapshot = snapshotFor([requested]);
    const unclassified = { ...requested, rewardSummary: undefined };
    const refreshedSnapshot = { ...snapshotFor([unclassified]), drops: [], campaignDropsByKey: {} };
    let refreshCalls = 0;
    const subject = fixture('ending-soonest', {
      favorite: false,
      queue: [requested],
      twitch: {
        refresh: async () => {
          refreshCalls += 1;
          const snapshot = refreshCalls === 1 ? initialSnapshot : refreshedSnapshot;
          return { kind: 'ready', snapshot, refreshPatch: deriveSafeRefreshPatch(snapshot) };
        },
        fetchDirectory: async (game) => ({
          kind: 'ready',
          target: {
            campaignKey: gameKey(game),
            campaignId: game.campaignId ?? null,
            gameId: game.id,
            gameName: game.name,
            categoryId: game.categoryId ?? null,
            categorySlug: game.categorySlug ?? game.name,
          },
          streamers:
            refreshCalls === 1
              ? []
              : [{ id: 'streamer', name: 'channel', displayName: 'Channel', isLive: true }],
          languageFilterApplied: false,
        }),
      },
    });

    const result = await subject.automation.startQueuedCampaign?.(gameKey(requested));

    expect(result).toEqual({
      success: false,
      error: 'Unable to check streamers for this campaign right now.',
    });
    expect(refreshCalls).toBe(2);
    expect(subject.state.appState.isRunning).toBe(false);
    expect(subject.state.appState.selectedGame).toBeNull();
  });

  test('queued Play cancels after Stop or Pause during direct channel verification', async () => {
    for (const action of ['Stop', 'Pause'] as const) {
      const probeEntered = createDeferred<void>();
      const finishProbe = createDeferred<void>();
      const requested = { ...campaign('manual', '2030-08-04T12:00:00.000Z'), allowedChannels: ['allowed'] };
      const snapshot = snapshotFor([requested]);
      const subject = fixture('ending-soonest', {
        favorite: false,
        queue: [requested],
        twitch: {
          refresh: async () => ({ kind: 'ready', snapshot, refreshPatch: deriveSafeRefreshPatch(snapshot) }),
          fetchDirectory: async (game) => ({
            kind: 'ready',
            target: {
              campaignKey: gameKey(game),
              campaignId: game.campaignId ?? null,
              gameId: game.id,
              gameName: game.name,
              categoryId: game.categoryId ?? null,
              categorySlug: game.categorySlug ?? game.name,
            },
            streamers: [],
            languageFilterApplied: false,
          }),
          probeStreamInfo: async (channel) => {
            probeEntered.resolve(undefined);
            await finishProbe.promise;
            return {
              kind: 'live',
              streamer: { id: 'streamer', name: channel, displayName: channel, isLive: true },
              categoryLabel: 'manual',
            };
          },
        },
      });

      const starting = subject.automation.startQueuedCampaign?.(gameKey(requested));
      await probeEntered.promise;
      if (action === 'Stop') {
        subject.state.appState.isRunning = false;
        subject.state.appState.isPaused = false;
        subject.state.appState.selectedGame = null;
        subject.state.appState.lastStopReason = 'user-stop';
      } else {
        subject.state.appState.isRunning = false;
        subject.state.appState.isPaused = true;
        subject.state.appState.selectedGame = null;
      }
      subject.automation.invalidate?.();
      const afterAction = structuredClone(subject.state.appState);
      finishProbe.resolve(undefined);

      expect(await starting).toEqual({
        success: false,
        error: 'Campaign start was superseded by another action.',
      });
      expect(subject.state.appState).toEqual(afterAction);
    }
  });

  test('queued Play cancels after Stop or Pause during the zero-result refresh', async () => {
    for (const action of ['Stop', 'Pause'] as const) {
      const refreshEntered = createDeferred<void>();
      const finishRefresh = createDeferred<void>();
      const requested = campaign('manual', '2030-08-04T12:00:00.000Z');
      const snapshot = snapshotFor([requested]);
      let refreshCalls = 0;
      const subject = fixture('ending-soonest', {
        favorite: false,
        queue: [requested],
        twitch: {
          refresh: async () => {
            refreshCalls += 1;
            if (refreshCalls === 2) {
              refreshEntered.resolve(undefined);
              await finishRefresh.promise;
            }
            return { kind: 'ready', snapshot, refreshPatch: deriveSafeRefreshPatch(snapshot) };
          },
          fetchDirectory: async (game) => ({
            kind: 'ready',
            target: {
              campaignKey: gameKey(game),
              campaignId: game.campaignId ?? null,
              gameId: game.id,
              gameName: game.name,
              categoryId: game.categoryId ?? null,
              categorySlug: game.categorySlug ?? game.name,
            },
            streamers: [],
            languageFilterApplied: false,
          }),
        },
      });

      const starting = subject.automation.startQueuedCampaign?.(gameKey(requested));
      await refreshEntered.promise;
      if (action === 'Stop') {
        subject.state.appState.isRunning = false;
        subject.state.appState.isPaused = false;
        subject.state.appState.selectedGame = null;
        subject.state.appState.lastStopReason = 'user-stop';
      } else {
        subject.state.appState.isRunning = false;
        subject.state.appState.isPaused = true;
        subject.state.appState.selectedGame = null;
      }
      subject.automation.invalidate?.();
      const afterAction = structuredClone(subject.state.appState);
      finishRefresh.resolve(undefined);

      expect(await starting).toEqual({
        success: false,
        error: 'Campaign start was superseded by another action.',
      });
      expect(subject.state.appState).toEqual(afterAction);
    }
  });

  test('preserves scheduled retry copy and disables a second session recovery after zero candidates', async () => {
    const requested = campaign('manual', '2030-08-04T12:00:00.000Z');
    const snapshot = snapshotFor([requested]);
    let refreshCalls = 0;
    let secondRefreshOptions: unknown;
    const subject = fixture('ending-soonest', {
      favorite: false,
      queue: [requested],
      twitch: {
        refresh: async (_force, options) => {
          refreshCalls += 1;
          if (refreshCalls === 2) {
            secondRefreshOptions = options;
            throw new FarmingAutomationRefreshBackoffError(5_000);
          }
          return { kind: 'ready', snapshot, refreshPatch: deriveSafeRefreshPatch(snapshot) };
        },
        fetchDirectory: async (game) => ({
          kind: 'ready',
          target: {
            campaignKey: gameKey(game),
            campaignId: game.campaignId ?? null,
            gameId: game.id,
            gameName: game.name,
            categoryId: game.categoryId ?? null,
            categorySlug: game.categorySlug ?? game.name,
          },
          streamers: [],
          languageFilterApplied: false,
        }),
      },
    });

    const result = await subject.automation.startQueuedCampaign?.(gameKey(requested));

    expect(result).toEqual({ success: false, error: 'Twitch is waiting for its scheduled retry.' });
    expect(secondRefreshOptions).toEqual({
      requireFreshCompleteSnapshot: true,
      allowSessionRecovery: false,
    });
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
