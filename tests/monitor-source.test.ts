import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MonitorView } from '../src/monitor/App.tsx';
import { createInitialState } from '../src/shared/utils.ts';
import type { AppState, TwitchDrop, TwitchGame } from '../src/types/index.ts';

function createGame(rewardSummary: TwitchGame['rewardSummary'], name = 'Test Game'): TwitchGame {
  return {
    id: 'game-1',
    name,
    imageUrl: '',
    campaignId: 'campaign-1',
    rewardSummary,
  };
}

function createDrop(overrides: Partial<TwitchDrop> = {}): TwitchDrop {
  return {
    id: 'reward-1',
    name: 'Reward',
    gameId: 'game-1',
    gameName: 'Test Game',
    imageUrl: '',
    progress: 0,
    currentMinutes: 0,
    claimed: false,
    requiredMinutes: 60,
    remainingMinutes: 60,
    status: 'active',
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
    ...overrides,
  };
}

function renderMonitor(overrides: Partial<AppState>): string {
  const state: AppState = { ...createInitialState(), ...overrides };
  return renderToStaticMarkup(
    createElement(MonitorView, {
      state,
      lastUpdatedAt: 1_700_000_000_000,
      recoveryNow: 1_700_000_000_000,
    }),
  );
}

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

test('monitor CSS keeps the approved single-layer layout contract', () => {
  const css = readFileSync(resolve(import.meta.dir, '../src/monitor/monitor.css'), 'utf8');

  expect(css).not.toContain('overflow-y: auto');
  expect(css).not.toContain('z-index:');
  expect(css).not.toContain('isolation: isolate');
  expect(css).not.toContain("-webkit-locale: 'ja'");
  expect(css).not.toContain('word-break: auto-phrase');
});
