import { expect, test } from 'bun:test';
import { remainingSessionDrops } from '../src/popup/components/session-drops';
import type { AppState } from '../src/types';
import { appState, drop, game, renderMainView } from './fixtures/popup-reward';

const first = drop({ id: 'first', campaignId: 'campaign-id', name: 'First reward', progress: 50 });
const second = drop({ id: 'second', campaignId: 'campaign-id', name: 'Second reward', progress: 25 });

function session(state: AppState, mode: 'running' | 'paused' | 'recovering' = 'running'): string {
  const markup = renderMainView(state, [], { runtimeMode: mode });
  return markup.match(/<section[^>]*aria-label="Current farming session"[\s\S]*?<\/section>/)?.[0] ?? '';
}

test.each(['running', 'paused', 'recovering'] as const)('shows remaining campaign drops when %s', (mode) => {
  // Given
  const state = { ...appState(game()), isRunning: true, currentDrop: first, pendingDrops: [first, second] };
  // When
  const markup = session(state, mode);
  // Then
  expect(markup).toContain('2 drops remaining');
  expect(markup).toContain('aria-label="First reward progress"');
  expect(markup).toContain('aria-label="Second reward progress"');
  expect(markup.match(/role="progressbar"/g)).toHaveLength(2);
});

test('shows drops and progress while waiting for the first player click', () => {
  // Given
  const state: AppState = {
    ...appState(game()), isRunning: true, tabId: 7, pendingDrops: [first, second],
    watchHealth: {
      mode: 'managed-tab', isHealthy: false, status: 'degraded', reason: 'user-interaction-required',
      consecutiveFailures: 0, consecutiveStalls: 0, progress: null, shouldFallback: false, checkedAt: 1,
    },
  };
  // When
  const markup = session(state);
  // Then
  expect(markup).toContain('Start the video');
  expect(markup).toContain('2 drops remaining');
  expect(markup.match(/role="progressbar"/g)).toHaveLength(2);
  expect(markup).not.toContain('Click the video in the Twitch tab once and leave the tab open.');
});

test('keeps the click instruction in the card after its message is dismissed', () => {
  // Given
  const base = appState(game());
  const state: AppState = {
    ...base, isRunning: true, tabId: 7, pendingDrops: [first],
    watchHealth: {
      mode: 'managed-tab', isHealthy: false, status: 'degraded', reason: 'user-interaction-required',
      consecutiveFailures: 0, consecutiveStalls: 0, progress: null, shouldFallback: false, checkedAt: 1,
    },
    dismissedFarmingMessageIds: ['playback-gesture:campaign:campaign-id:7'],
  };
  // When
  const markup = session(state);
  // Then
  expect(markup).toContain('Click the video in the Twitch tab once and leave the tab open.');
  expect(markup).toContain('1 drop remaining');
});

test('hides drops while switching to another campaign', () => {
  // Given
  const other = game({ id: 'other-game', campaignId: 'other-campaign', campaignName: 'Other' });
  const state: AppState = {
    ...appState(game()), isRunning: true, pendingDrops: [first],
    pendingWatchTarget: { game: other, channelName: 'candidate' },
  };
  // When
  const markup = session(state);
  // Then
  expect(markup).toContain('Switching to');
  expect(markup).not.toContain('Remaining campaign drops');
});

test('removes acquired drops even when catalog and current drop are stale', () => {
  // Given
  const state = {
    ...appState(game()), isRunning: true, currentDrop: first,
    campaignDropsByKey: { 'campaign:campaign-id': [first, second] },
    completedDrops: [{ ...first, claimed: true, progress: 100 }],
  };
  // When
  const markup = session(state);
  // Then
  expect(markup).toContain('1 drop remaining');
  expect(markup).not.toContain('aria-label="First reward progress"');
  expect(markup).toContain('aria-label="Second reward progress"');
});

test('excludes other campaigns and event rewards while deduplicating progress sources', () => {
  // Given
  const state = {
    ...appState(game()), isRunning: true, currentDrop: first,
    allDrops: [first, second, { ...second, campaignId: 'other', name: 'Other campaign' },
      drop({ id: 'sub', campaignId: 'campaign-id', acquisitionMethod: 'subscription', name: 'Subscription' })],
    pendingDrops: [{ ...second, progress: 60 }],
  };
  // When
  const markup = session(state);
  // Then
  expect(markup).toContain('2 drops remaining');
  expect(markup).toContain('aria-valuenow="60"');
  expect(markup.match(/role="progressbar"/g)).toHaveLength(2);
  expect(markup).not.toContain('Other campaign');
  expect(markup).not.toContain('Subscription');
});

test('keeps claimable rewards visible until acquired', () => {
  // Given
  const state = { ...appState(game()), isRunning: true,
    pendingDrops: [{ ...first, progress: 100, claimable: true }] };
  // When
  const markup = session(state);
  // Then
  expect(markup).toContain('1 drop remaining');
  expect(markup).toContain('Claimable');
});

test('does not invent a remaining count when no drops are known', () => {
  // Given
  const state = { ...appState(game()), isRunning: true };
  // When
  const markup = session(state);
  // Then
  expect(markup).not.toContain('drops remaining');
  expect(markup).not.toContain('role="progressbar"');
});

test('orders remaining drops by completion, then shortest ETA', () => {
  // Given
  const lowerProgress = drop({
    id: 'lower-progress',
    campaignId: 'campaign-id',
    name: 'Burger Shot Tracksuit',
    progress: 57,
    remainingMinutes: 153,
  });
  const higherProgress = drop({
    id: 'higher-progress',
    campaignId: 'campaign-id',
    name: 'GTA$1M',
    progress: 86,
    remainingMinutes: 33,
  });
  const tiedButFaster = drop({
    id: 'tied-but-faster',
    campaignId: 'campaign-id',
    name: 'Fast reward',
    progress: 86,
    remainingMinutes: 12,
  });
  const state = {
    ...appState(game()),
    allDrops: [lowerProgress, higherProgress, tiedButFaster],
  };

  // When
  const orderedNames = remainingSessionDrops(state).map((reward) => reward.name);

  // Then
  expect(orderedNames).toEqual(['Fast reward', 'GTA$1M', 'Burger Shot Tracksuit']);
});
