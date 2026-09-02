import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { automationActivity, createDrop, createGame, renderMonitor } from './fixtures/monitor-source.ts';

test('monitor keeps a fresh zero-percent Twitch-native reward as ordinary progress', () => {
  // Given: a newly discovered badge at 0% with no unverifiable marker.
  const html = renderMonitor({
    isRunning: true,
    selectedGame: createGame({ completion: 'farmable', remainderReasons: [] }),
    pendingDrops: [
      createDrop({
        name: 'Fresh Twitch Badge',
        rewardKind: 'twitch-badge',
        verificationState: 'unassessed',
        acquisitionMethod: 'watch-time',
      }),
    ],
  });

  // Then: the monitor shows the current reward and ordinary progress vocabulary.
  expect(html).toContain('Fresh Twitch Badge');
  expect(html).toContain('0%');
  expect(html).not.toContain('Farming finished');
  expect(html).not.toContain('All farmable rewards claimed');
});

test('monitor explains a subscription-only farming-complete campaign', () => {
  // Given: no automatable reward remains and Twitch reports a subscription remainder.
  const html = renderMonitor({
    selectedGame: createGame({
      completion: 'farming-complete',
      remainderReasons: ['subscription-required'],
    }),
    pendingDrops: [
      createDrop({
        name: 'Subscriber Reward',
        acquisitionMethod: 'subscription',
        rewardKind: 'in-game',
      }),
    ],
    lastStopReason: 'farming-complete',
    lastStopMessage: 'All farmable rewards claimed · Subscription required for remaining rewards',
  });

  // Then: subscription copy is explicit and does not claim every reward was acquired.
  expect(html).toContain('All farmable rewards claimed · Subscription required for remaining rewards');
  expect(html).not.toContain('Farming finished · Twitch reward acquisition could not be verified');
  expect(html.match(/<p class="monitor-reward-/g)).toHaveLength(1);
  expect(html).not.toContain('All rewards already claimed');
  expect(html).toContain('No automatable campaign rewards remain.');
  expect(html).toContain('Stopped: Farming finished');
});

test('monitor explains an unverifiable Twitch remainder and uses shared terminal status', () => {
  // Given: an exhausted Twitch-native reward and a custom stop message.
  const html = renderMonitor({
    selectedGame: createGame({
      completion: 'farming-complete',
      remainderReasons: ['unverifiable-twitch'],
    }),
    pendingDrops: [
      createDrop({
        name: 'Unverifiable Emote',
        rewardKind: 'twitch-emote',
        verificationState: 'unverifiable',
      }),
    ],
    lastStopReason: 'unverifiable-twitch',
    lastStopMessage: 'Custom stop text should not replace the shared status.',
  });

  // Then: the shared runtime label and truthful qualifier are both visible.
  expect(html).toContain('Farming finished · Twitch reward acquisition could not be verified');
  expect(html.split('Farming finished · Twitch reward acquisition could not be verified').length - 1).toBe(1);
  expect(html).not.toContain('All farmable rewards claimed');
  expect(html.match(/<p class="monitor-reward-/g)).toHaveLength(1);
  expect(html).toContain('Stopped: Farming finished');
  expect(html).not.toContain('Custom stop text should not replace the shared status.');
  expect(html).toContain('monitor-pill--stopped');
});

test('monitor preserves subscription-then-unverifiable explanation order', () => {
  // Given: a campaign with both non-automatable remainder reasons.
  const html = renderMonitor({
    selectedGame: createGame({
      completion: 'farming-complete',
      remainderReasons: ['subscription-required', 'unverifiable-twitch'],
    }),
    pendingDrops: [
      createDrop({ acquisitionMethod: 'subscription', name: 'Subscriber Reward' }),
      createDrop({
        id: 'reward-2',
        rewardKind: 'twitch-badge',
        verificationState: 'unverifiable',
        name: 'Unverifiable Badge',
      }),
    ],
  });

  // Then: each reason is separately announced in the contract order.
  const subscriptionIndex = html.indexOf(
    'All farmable rewards claimed · Subscription required for remaining rewards',
  );
  const unverifiableIndex = html.indexOf(
    'Farming finished · Twitch reward acquisition could not be verified',
  );
  expect(subscriptionIndex).toBeGreaterThan(-1);
  expect(unverifiableIndex).toBeGreaterThan(subscriptionIndex);
  expect(html.match(/<p class="monitor-reward-/g)).toHaveLength(2);
  expect(html.match(/class="monitor-reward-status-label"/g)).toHaveLength(2);
  expect(html).not.toContain('class="monitor-reward-reason"');
  expect(html).toContain('role="status"');
  expect(html).toContain('aria-live="polite"');
  expect(html).toContain('aria-atomic="true"');
});

test('monitor uses shared terminal vocabulary for queue completion', () => {
  // Given: a terminal queue-complete state with a stale custom message.
  const html = renderMonitor({
    lastStopReason: 'queue-complete',
    lastStopMessage: 'Queue completed. No pending rewards left.',
  });

  // Then: the shared runtime label remains the monitor's terminal vocabulary.
  expect(html).toContain('Stopped: Queue complete');
  expect(html).not.toContain('Queue completed. No pending rewards left.');
});

test('monitor does not add a nested keyboard scroll owner', () => {
  const html = renderMonitor({
    isRunning: true,
    selectedGame: createGame({ completion: 'farmable', remainderReasons: [] }),
    pendingDrops: [createDrop({ name: 'Long reward label' })],
  });

  expect(html).toContain('class="monitor-body"');
  expect(html).not.toContain('tabindex="0"');
  expect(html).not.toContain('aria-label="Monitor details"');
});

test('monitor shows only fresh automation transitions and preserves manual viewing notices', () => {
  const automation = renderMonitor({
    autoStartFavoriteGames: true,
    twitchSessionDetected: true,
    automationActivity: [
      automationActivity(
        'fresh-transition',
        1_699_999_999_000,
        'Switching to Valorant — its campaign ends 3h earlier.',
      ),
    ],
    lastAutomationMessage: 'Old transition must not persist.',
  });
  const staleAutomation = renderMonitor({
    autoStartFavoriteGames: true,
    twitchSessionDetected: true,
    automationActivity: [
      automationActivity('stale-transition', 1_699_999_993_000, 'Old transition must not persist.'),
    ],
    lastAutomationMessage: 'Old transition must not persist.',
  });
  const manual = renderMonitor({
    manualWatchState: 'eligible-manual',
  });
  const unsortedAutomation = renderMonitor({
    autoStartFavoriteGames: true,
    twitchSessionDetected: true,
    automationActivity: [
      automationActivity('stale-first-transition', 1_699_999_993_000, 'Old transition must not persist.'),
      automationActivity('fresh-second-transition', 1_699_999_999_000, 'Fresh transition must still expire.'),
    ],
  });
  const expiredAtBoundary = renderMonitor({
    autoStartFavoriteGames: true,
    twitchSessionDetected: true,
    automationActivity: [
      automationActivity('boundary-transition', 1_699_999_994_000, 'Six seconds old must not persist.'),
    ],
  });
  const newestFreshAutomation = renderMonitor({
    autoStartFavoriteGames: true,
    twitchSessionDetected: true,
    automationActivity: [
      automationActivity('older-fresh-transition', 1_699_999_995_000, 'Older fresh transition.'),
      automationActivity('newest-fresh-transition', 1_699_999_999_000, 'Newest fresh transition.'),
    ],
  });

  expect(automation).toContain('Switching to Valorant — its campaign ends 3h earlier.');
  expect(automation).toContain('role="status"');
  expect(staleAutomation).not.toContain('Old transition must not persist.');
  expect(unsortedAutomation).toContain('Fresh transition must still expire.');
  expect(expiredAtBoundary).not.toContain('Six seconds old must not persist.');
  expect(newestFreshAutomation).toContain('Newest fresh transition.');
  expect(newestFreshAutomation).not.toContain('Older fresh transition.');
  expect(manual).toContain('Manual viewing is earning progress. DropHunter will not control this tab.');
});

test('monitor keeps recovery notices visible without re-announcing their retry countdown', () => {
  const html = renderMonitor({
    isRunning: true,
    recoveryReason: 'offline',
    recoveryAttempts: 1,
    recoveryBackoffUntil: 1_700_000_030_000,
  });

  expect(html).toContain('Recovering: Recovering offline stream');
  expect(html).toContain('class="monitor-context-notice monitor-context-notice--warning"');
  expect(html).not.toContain('aria-live="polite"');
});

test('monitor keeps running semantics during a non-blocking Twitch retry', () => {
  const html = renderMonitor({
    isRunning: true,
    selectedGame: createGame({ completion: 'farmable', remainderReasons: [] }, 'FragPunk'),
    watchTransportMode: 'tabless',
    twitchSessionSyncState: { status: 'retrying', attempts: 2, nextRetryAt: 1_700_000_030_000 },
    pendingDrops: [createDrop({ progress: 42 })],
  });

  expect(html).toContain('RUNNING');
  expect(html).toContain('FragPunk');
  expect(html).not.toContain('Recovering:');
  expect(html).not.toContain('retry in');
  expect(html).not.toContain('Twitch sign-in required');
});

test('monitor reward progress exposes native progressbar semantics', () => {
  const html = renderMonitor({
    isRunning: true,
    selectedGame: createGame({ completion: 'farmable', remainderReasons: [] }),
    pendingDrops: [createDrop({ progress: 42 })],
  });

  expect(html).toContain('role="progressbar"');
  expect(html).toContain('aria-valuenow="42"');
  expect(html).toContain('aria-valuemin="0"');
  expect(html).toContain('aria-valuemax="100"');
});

test('monitor CSS keeps the approved single-layer layout contract', () => {
  const css = readFileSync(resolve(import.meta.dir, '../src/monitor/monitor.css'), 'utf8');

  expect(css).not.toContain('overflow-y: auto');
  expect(css).not.toContain('z-index:');
  expect(css).not.toContain('isolation: isolate');
  expect(css).not.toContain("-webkit-locale: 'ja'");
  expect(css).not.toContain('word-break: auto-phrase');
});
