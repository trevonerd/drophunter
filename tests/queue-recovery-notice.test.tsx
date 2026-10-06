import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MonitorView } from '../src/monitor/App.tsx';
import { queueRecoveryNotice } from '../src/shared/queue-recovery-notice.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import { createInitialState } from '../src/shared/utils.ts';
import { appState, game, renderMainView } from './fixtures/popup-reward.tsx';

test('popup owns unresolved campaign details and controls while monitor shows current status', () => {
  const games = [game({ campaignName: 'A very long campaign title '.repeat(5) }),
    game({ campaignId: 'second', campaignName: 'Second Campaign' })];
  const now = Date.now();
  const state = { ...appState(games[0]), isRunning: true, activeStreamer: null,
    queue: [...games, games[0]], availableGames: games,
    queueAcquisitionRound: { attemptedCampaignKeys: games.map(gameKey), nextRoundAt: now + 600_000 },
    recoveryReason: 'no-streamers', recoveryBackoffUntil: now + 600_000,
    automationActivity: Array.from({ length: 20 }, (_, index) => ({ id: String(index), at: now,
      kind: 'favorite-added' as const, message: 'Unrelated event' })),
    queueEntryMetadataByKey: {
      [gameKey(games[0])]: { source: 'manual' as const, reason: 'user-added' as const, addedAt: now,
        streamerRetryReason: 'open-failed' as const, streamerRetryAt: now + 60_000 },
      [gameKey(games[1])]: { source: 'manual' as const, reason: 'user-added' as const, addedAt: now,
        streamerRetryReason: 'stalled-progress' as const, streamerRetryAt: now + 60_000 },
    } };
  const entries = queueRecoveryNotice(state, now);
  expect(entries).toHaveLength(2);
  expect(entries.every((entry) => entry.nextRetryAt === now + 600_000)).toBe(true);
  const popup = renderMainView(state, games, { runtimeMode: 'recovering', recoveryNow: now });
  const monitor = renderToStaticMarkup(<MonitorView state={state} lastUpdatedAt={now} recoveryNow={now} contextNow={now} />);
  expect(popup).toContain('Campaigns awaiting recovery (2)');
  expect(popup).toContain(games[0].campaignName ?? 'Missing name');
  expect(popup).toContain('Second Campaign');
  expect(popup).toContain('Eligible stream playback could not start');
  expect(popup).toContain('Twitch progress is not advancing');
  expect(popup).toContain('Pause');
  expect(popup).toContain('Stop');
  expect(popup).not.toContain('>Start</button>');
  expect(popup).toContain('Waiting for next retry');
  expect(monitor).toContain('>WAITING</span>');
  expect(monitor).toContain('No eligible streamer');
  expect(monitor).not.toContain('Second Campaign');
  expect(monitor).not.toContain('<details');
  expect(monitor).not.toContain('Campaigns awaiting recovery');
  expect(monitor).not.toContain('<button');
});

test('recovered, completed, expired and removed campaigns leave the current warning', () => {
  const now = Date.now();
  const games = ['recovered', 'complete', 'expired', 'removed', 'blocked'].map((id) => game({ campaignId: id }));
  const state = createInitialState();
  state.queue = games.filter((campaign) => campaign.campaignId !== 'removed');
  state.availableGames = games.map((campaign) => campaign.campaignId === 'complete'
    ? { ...campaign, allDropsCompleted: true } : campaign.campaignId === 'expired'
      ? { ...campaign, endsAt: new Date(now - 1).toISOString() } : campaign);
  state.queueEntryMetadataByKey = Object.fromEntries(games.filter((campaign) => campaign.campaignId !== 'recovered').map((campaign) => [gameKey(campaign), {
    source: 'manual', reason: 'user-added', addedAt: now, streamerRetryReason: 'stalled-progress',
  }]));
  expect(queueRecoveryNotice(state, now).map((entry) => entry.key)).toEqual(['campaign:blocked']);
});

test('an attempted campaign waits for the round instead of advertising its elapsed local retry', () => {
  const now = Date.now();
  const first = game({ campaignId: 'first' });
  const second = game({ campaignId: 'second' });
  const state = { ...appState(second), isRunning: true, queue: [first, second], availableGames: [first, second],
    queueAcquisitionRound: { attemptedCampaignKeys: [gameKey(first)], nextRoundAt: null },
    queueEntryMetadataByKey: { [gameKey(first)]: { source: 'manual' as const, reason: 'user-added' as const,
      addedAt: now, streamerRetryReason: 'stalled-progress' as const, streamerRetryAt: now - 1 } } };
  expect(queueRecoveryNotice(state, now)[0]).toMatchObject({ nextRetryAt: null, retry: 'After the current queue round' });
});
