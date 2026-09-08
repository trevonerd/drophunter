import { expect, test } from 'bun:test';
import { candidateWorkingState } from '../src/background/session-lifecycle-transition-state.ts';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import type { TwitchGame } from '../src/types/index.ts';
import { campaign, fixture } from './support/farming-automation-queue-fixture.ts';

test('preempting an acquired incumbent cannot put it back into the persisted queue', async () => {
  const completed: TwitchGame = {
    ...campaign('manual', '2030-08-04T12:00:00.000Z'),
    allDropsCompleted: true,
    rewardSummary: { completion: 'all-acquired', remainderReasons: [] },
  };
  const f = fixture('priority-list-only', { running: completed, queue: [completed] });
  f.state.appState.availableGames = [completed];
  expect((await f.automation.request('campaign-refresh')).kind).toBe('started');
  expect(f.state.appState.queue.map(gameKey)).toEqual([gameKey(f.favorite)]);
  expect(normalizeStoredAppState(f.storage.getLocal('appState')).queue.map(gameKey)).toEqual([
    gameKey(f.favorite),
  ]);
});

test('preempting an expired incumbent respects the injected clock when retaining the queue', () => {
  const expired = campaign('manual', '2030-08-04T12:00:00.000Z');
  const f = fixture('priority-list-only', {
    running: expired,
    queue: [expired],
    now: () => Date.parse('2030-08-05T12:00:00.000Z'),
    favoriteEndsAt: '2030-08-06T12:00:00.000Z',
  });
  const drop = {
    id: 'favorite-drop',
    name: 'Reward',
    gameId: f.favorite.id,
    gameName: f.favorite.name,
    imageUrl: '',
    campaignId: f.favorite.campaignId,
    progress: 0,
    currentMinutes: 0,
    claimed: false,
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
  } satisfies import('../src/types/index.ts').TwitchDrop;
  const working = candidateWorkingState(
    f.state,
    {
      attemptId: 'attempt',
      transition: 'preemption',
      fromCampaignKey: gameKey(expired),
      candidate: f.favorite,
      expectedFingerprint: '',
      watchMode: 'managed-tab',
      snapshot: {
        games: [expired, f.favorite],
        drops: [drop],
        campaignChannelsMap: {},
        campaignDropsByKey: { [gameKey(f.favorite)]: [drop] },
        updatedAt: 1,
      },
    },
    Date.parse('2030-08-05T12:00:00.000Z'),
  );
  expect(working?.state.appState.queue.map(gameKey)).toEqual([gameKey(f.favorite)]);
});
