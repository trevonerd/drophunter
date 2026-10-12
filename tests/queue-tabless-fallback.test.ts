import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { gameKey } from '../src/shared/game-selection.ts';
import { createDrop, createGame, createMinimalState } from './fixtures/queue-management.ts';
import { commitPreparedCampaign, createQueueProgressionFixture } from './support/queue-progression.ts';

const NOW = 2_000_000;
afterEach(() => mock.restore());

type Reason = 'open-failed' | 'no-streamers' | 'directory-unavailable';

function setup(options: { preference?: 'tabless' | 'managed-tab'; fallback?: boolean; reason?: Reason }) {
  spyOn(Date, 'now').mockReturnValue(NOW);
  const first = createGame({ id: 'one', campaignId: 'one-campaign', dropCount: 1 });
  const second = createGame({ id: 'two', campaignId: 'two-campaign' });
  const state = createMinimalState();
  Object.assign(state.appState, {
    isRunning: true,
    manualQueueAuthorized: true,
    selectedGame: first,
    queue: [first, second],
    availableGames: [first, second],
    allDrops: [createDrop({ gameId: first.id, campaignId: first.campaignId, claimed: true })],
    watchTransportPreference: options.preference ?? 'managed-tab',
    tablessFallbackEnabled: options.fallback ?? true,
  });
  const attempts: { game: string; preference: string }[] = [];
  let failures = 0;
  const progression = createQueueProgressionFixture(state, {
    transitionCampaign: async (game) => {
      attempts.push({ game: gameKey(game), preference: state.appState.watchTransportPreference });
      if (state.appState.watchTransportPreference === 'tabless') return commitPreparedCampaign(state, game);
      failures += 1;
      return { kind: 'failed', reason: options.reason ?? 'open-failed', error: 'playback unavailable' };
    },
  });
  return { state, first, second, attempts, progression, failures: () => failures };
}

test('a tab-mode pass with no acquired campaign switches to tabless and restarts the queue', async () => {
  const { state, second, attempts, progression } = setup({});
  await progression.advanceIfCompleted();
  expect(state.appState.watchTransportPreference).toBe('tabless');
  expect(attempts.at(-1)?.preference).toBe('tabless');
  expect(state.appState.selectedGame).toEqual(second);
  expect(state.appState.activeStreamer).not.toBeNull();
  expect(state.appState.isRunning).toBe(true);
});

test.each<[string, Parameters<typeof setup>[0], 'tabless' | 'managed-tab']>([
  ['the setting is off', { fallback: false }, 'managed-tab'],
  ['the preference is already tabless', { preference: 'tabless' }, 'tabless'],
  ['the queue is parked for missing streamers', { reason: 'no-streamers' }, 'managed-tab'],
  ['the directory is unavailable', { reason: 'directory-unavailable' }, 'managed-tab'],
])('no fallback when %s', async (_name, options, expected) => {
  const { state, progression } = setup(options);
  await progression.advanceIfCompleted();
  expect(state.appState.watchTransportPreference).toBe(expected);
});
