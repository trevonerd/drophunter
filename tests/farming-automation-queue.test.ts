import { describe, expect, test } from 'bun:test';
import { gameKey } from '../src/shared/game-selection.ts';
import type { TwitchStreamer } from '../src/types/index.ts';
import { campaign, fixture } from './support/farming-automation-queue-fixture.ts';

describe('Farming automation queue policy', () => {
  test.each([
    {
      favoriteEndsAt: '2030-08-03T12:00:00.000Z',
      selected: 'campaign:campaign-favorite',
      queue: ['campaign:campaign-favorite', 'campaign:campaign-manual'],
    },
    {
      favoriteEndsAt: '2030-08-05T12:00:00.000Z',
      selected: 'campaign:campaign-favorite',
      queue: ['campaign:campaign-manual', 'campaign:campaign-favorite'],
    },
  ])('starts only the favorite campaign automatically while idle', async (scenario) => {
    // Given: an idle extension with one manual campaign and one discovered favorite.
    const subject = fixture('priority-list-only', { favoriteEndsAt: scenario.favoriteEndsAt });

    // When: the public automation request reconciles the queue.
    const outcome = await subject.automation.request('campaign-refresh');

    // Then: farming starts from the favorite and leaves the manual campaign queued for explicit start.
    expect({
      outcome,
      selected: subject.state.appState.selectedGame ? gameKey(subject.state.appState.selectedGame) : null,
      queue: subject.state.appState.queue.map(gameKey),
    }).toEqual({
      outcome: { kind: 'started', campaignKey: scenario.selected, transition: 'start' },
      selected: scenario.selected,
      queue: [scenario.selected, 'campaign:campaign-manual'],
    });
  });

  test('keeps manual campaigns idle until explicit start authorizes their queue', async () => {
    // Given: an idle extension with only a manually added campaign.
    const subject = fixture('priority-list-only', { favorite: false });

    // When: automation evaluates before and after the explicit-start authorization.
    const beforeStart = await subject.automation.request('campaign-refresh');
    subject.state.appState.manualQueueAuthorized = true;
    const afterStart = await subject.automation.request('user-request');

    // Then: the manual campaign cannot be selected before authorization and resumes afterward.
    expect({ beforeStart, afterStart }).toEqual({
      beforeStart: { kind: 'unchanged', reason: 'no-eligible-campaign' },
      afterStart: { kind: 'started', campaignKey: gameKey(subject.manual), transition: 'start' },
    });
  });

  test('starts a manually added campaign after it becomes a favorite', async () => {
    // Given: a campaign added manually before the user marks that same game as a favorite.
    const subject = fixture('priority-list-only', { favoriteGame: 'manual' });

    // When: automatic farming evaluates the favorite.
    const outcome = await subject.automation.request('campaign-refresh');

    // Then: favorite status authorizes automatic selection independently of the original queue provenance.
    expect(outcome).toEqual({
      kind: 'started',
      campaignKey: gameKey(subject.manual),
      transition: 'start',
    });
  });

  test('starts a favorite while the initial Twitch Drops page remains open', async () => {
    const subject = fixture('priority-list-only', { dropsPageOpen: true });

    const outcome = await subject.automation.request('periodic');

    expect(outcome).toEqual({
      kind: 'started',
      campaignKey: gameKey(subject.favorite),
      transition: 'start',
    });
    expect(subject.state.appState.farmingSessionOrigin).toBe('automatic');
  });

  test('adds favorite-auto queue entries during manual watch without starting', async () => {
    // Given: priority-list-only mode, a manual queue entry, and eligible manual Twitch viewing.
    const subject = fixture('priority-list-only', { manual: true });

    // When: automation discovers the favorite campaign.
    const outcome = await subject.automation.request('periodic');

    // Then: queue discovery persists independently while manual watch blocks selection.
    expect({
      outcome,
      queue: subject.state.appState.queue.map(gameKey),
      metadata: subject.state.appState.queueEntryMetadataByKey,
      activity: subject.state.appState.automationActivity.map(({ kind }) => kind),
      deadline: subject.state.appState.nextAutomationCheckAt,
    }).toEqual({
      outcome: { kind: 'unchanged', reason: 'manual-watch-active' },
      queue: [gameKey(subject.favorite), gameKey(subject.manual)],
      metadata: {
        [gameKey(subject.manual)]: { source: 'manual', addedAt: 1, reason: 'user-added' },
        [gameKey(subject.favorite)]: {
          source: 'favorite-auto',
          addedAt: 2_000,
          reason: 'favorite-discovered',
        },
      },
      activity: ['favorite-added'],
      deadline: 32_000,
    });
  });

  test('parks a favorite with no eligible streamer and schedules a bounded retry', async () => {
    // Given: an authoritative farmable favorite whose directory currently has no live streamer.
    const subject = fixture('priority-list-only', { eligibleStreamers: [] });

    // When: automatic evaluation discovers the favorite.
    const outcome = await subject.automation.request('campaign-refresh');

    // Then: it remains queued for automation and wakes again shortly instead of failing permanently.
    expect({
      outcome,
      queue: subject.state.appState.queue.map(gameKey),
      retryAt: subject.state.appState.queueEntryMetadataByKey[gameKey(subject.favorite)]?.streamerRetryAt,
      nextCheck: subject.state.appState.nextAutomationCheckAt,
    }).toEqual({
      outcome: { kind: 'unchanged', reason: 'no-eligible-campaign' },
      queue: [gameKey(subject.favorite), gameKey(subject.manual)],
      retryAt: 62_000,
      nextCheck: 62_000,
    });
  });

  test('starts the queued favorite on the scheduled retry when a streamer becomes eligible', async () => {
    let now = 2_000;
    const eligibleStreamers: TwitchStreamer[] = [];
    const subject = fixture('priority-list-only', { eligibleStreamers, now: () => now });

    const waiting = await subject.automation.request('campaign-refresh');
    now = subject.state.appState.nextAutomationCheckAt ?? 62_000;
    eligibleStreamers.push({
      id: 'streamer',
      name: 'channel',
      displayName: 'Channel',
      isLive: true,
      viewerCount: 1,
    });
    const started = await subject.automation.request('periodic');

    expect({
      waiting,
      started,
      selected: subject.state.appState.selectedGame ? gameKey(subject.state.appState.selectedGame) : null,
    }).toEqual({
      waiting: { kind: 'unchanged', reason: 'no-eligible-campaign' },
      started: { kind: 'started', campaignKey: gameKey(subject.favorite), transition: 'start' },
      selected: gameKey(subject.favorite),
    });
  });

  test('waits for an incomplete favorite catalog with a bounded retry', async () => {
    // Given: the authoritative campaign snapshot has not classified the favorite rewards yet.
    const subject = fixture('priority-list-only', { incompleteFavorite: true });

    // When: automatic evaluation sees the incomplete catalog.
    const outcome = await subject.automation.request('campaign-refresh');

    // Then: no campaign starts, but the evaluator schedules a short follow-up check.
    expect({ outcome, nextCheck: subject.state.appState.nextAutomationCheckAt }).toEqual({
      outcome: { kind: 'unchanged', reason: 'no-eligible-campaign' },
      nextCheck: 62_000,
    });
  });

  test.each([
    ['between', '2030-08-02T12:00:00.000Z', false],
    ['at equal expiry', '2030-08-03T12:00:00.000Z', true],
  ] as const)(
    'inserts a favorite %s without duplicates while farming',
    async (_label, firstEndsAt, favoriteFirst) => {
      const running = campaign('running', '2030-08-01T12:00:00.000Z');
      const first = campaign('first', firstEndsAt);
      const last = campaign('last', '2030-08-04T12:00:00.000Z');
      const subject = fixture('priority-list-only', { queue: [first, last], running });

      const outcomes = [
        await subject.automation.request('campaign-refresh'),
        await subject.automation.request('periodic'),
      ];

      expect({
        outcomes,
        queue: subject.state.appState.queue.map(gameKey),
        selected: subject.state.appState.selectedGame,
      }).toEqual({
        outcomes: [
          { kind: 'unchanged', reason: 'already-farming-best-campaign' },
          { kind: 'unchanged', reason: 'already-farming-best-campaign' },
        ],
        queue: [
          gameKey(running),
          ...(favoriteFirst
            ? [gameKey(subject.favorite), gameKey(first)]
            : [gameKey(first), gameKey(subject.favorite)]),
          gameKey(last),
        ],
        selected: running,
      });
    },
  );
});
