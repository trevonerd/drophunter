import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AppState } from '../src/types';
import {
  appState,
  drop,
  game,
  renderMainView,
  startButtonMarkup,
} from './fixtures/popup-reward';

test('running status does not present a non-automatable reward as the nearest active reward', () => {
  // Given
  const selectedGame = game();
  const state = {
    ...appState(selectedGame),
    isRunning: true,
    currentDrop: drop({
      name: 'Nearest Unverifiable Reward',
      progress: 99,
      rewardKind: 'twitch-emote',
      verificationState: 'unverifiable',
    }),
  } satisfies AppState;

  // When
  const markup = renderMainView(state);

  // Then
  expect(markup).not.toContain('Nearest Unverifiable Reward 99%');
});

test('fresh zero-percent Twitch-native campaign keeps Start enabled', () => {
  // Given
  const selectedGame = game({
    rewardSummary: { completion: 'farmable', remainderReasons: [] },
  });
  const state = {
    ...appState(selectedGame),
    pendingDrops: [
      drop({
        name: 'Fresh Twitch Badge',
        progress: 0,
        rewardKind: 'twitch-badge',
        verificationState: 'unassessed',
      }),
    ],
  } satisfies AppState;

  // When
  const markup = renderMainView(state);
  const startButton = startButtonMarkup(markup);

  // Then
  expect(startButton).toContain('Start Farming');
  expect(startButton).not.toContain(' disabled=');
});

test('farming-complete selection disables Start when no farmable queue head exists', () => {
  // Given
  const selectedGame = game({
    rewardSummary: {
      completion: 'farming-complete',
      remainderReasons: ['subscription-required', 'unverifiable-twitch'],
    },
  });

  // When
  const markup = renderMainView(appState(selectedGame));
  const startButton = startButtonMarkup(markup);

  // Then
  expect(startButton).toContain(' disabled=');
  expect(markup).toContain('role="status" aria-live="polite"');
  expect(markup).toContain('data-campaign-status-reason="subscription-required"');
  expect(markup).toContain('All farmable rewards claimed · Subscription required for remaining rewards');
  expect(markup).toContain('data-campaign-status-reason="unverifiable-twitch"');
  expect(markup).toContain('Farming finished · Twitch reward acquisition could not be verified');
});
