import { describe, expect, test } from 'bun:test';
import { gameKey } from '../src/shared/game-selection.ts';
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

  test.each([
    ['between', '2030-08-02T12:00:00.000Z'],
    ['after equal expiry', '2030-08-03T12:00:00.000Z'],
  ] as const)('inserts a favorite %s without duplicates while farming', async (_label, firstEndsAt) => {
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
      queue: [gameKey(running), gameKey(subject.favorite), gameKey(first), gameKey(last)],
      selected: running,
    });
  });
});
