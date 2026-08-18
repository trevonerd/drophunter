import { expect, test } from 'bun:test';
import { formatFarmingCompleteQueueMessage } from '../src/popup/format';
import type { AppState, TwitchGame } from '../src/types';
import {
  appState,
  game,
  renderMainView,
  startButtonMarkup,
} from './fixtures/popup-reward';

test('farmable queue head keeps Start enabled despite farming-complete selection', () => {
  // Given
  const selectedGame = game({
    campaignId: 'selected-terminal',
    rewardSummary: { completion: 'farming-complete', remainderReasons: ['subscription-required'] },
  });
  const queueHead = game({
    campaignId: 'queue-farmable',
    campaignName: 'Queue Campaign',
    rewardSummary: { completion: 'farmable', remainderReasons: [] },
  });

  // When
  const markup = renderMainView(appState(selectedGame), [queueHead]);
  const startButton = startButtonMarkup(markup);

  // Then
  expect(startButton).toContain('Start Queue (1)');
  expect(startButton).not.toContain(' disabled=');
  expect(markup).not.toContain('↑ first');
});

test('legacy queue head with a missing reward summary keeps Start enabled and does not claim first', () => {
  // Given
  const selectedGame = game({
    campaignId: 'selected-terminal',
    rewardSummary: { completion: 'farming-complete', remainderReasons: ['subscription-required'] },
  });
  const queueHead: TwitchGame = {
    id: 'queue-game-id',
    name: 'Queue Game',
    imageUrl: '',
    campaignId: 'queue-legacy',
    campaignName: 'Legacy Queue Campaign',
    isConnected: true,
    allDropsCompleted: false,
  };

  // When
  const markup = renderMainView(appState(selectedGame), [queueHead]);
  const startButton = startButtonMarkup(markup);

  // Then
  expect(startButton).toContain('Start Queue (1)');
  expect(startButton).not.toContain(' disabled=');
  expect(markup).not.toContain('↑ first');
});

test('all-acquired selection skips a terminal queue head and keeps a later farmable campaign enabled', () => {
  // Given
  const terminalHead = game({
    campaignId: 'terminal-head',
    rewardSummary: { completion: 'all-acquired', remainderReasons: [] },
  });
  const farmableCampaign = game({
    campaignId: 'later-farmable',
    campaignName: 'Later Farmable Campaign',
    rewardSummary: { completion: 'farmable', remainderReasons: [] },
  });

  // When
  const markup = renderMainView(appState(terminalHead), [terminalHead, farmableCampaign]);
  const startButton = startButtonMarkup(markup);

  // Then
  expect(startButton).toContain('Start Queue (2)');
  expect(startButton).not.toContain(' disabled=');
});

test('no selection skips a farming-complete queue head and keeps a later farmable campaign enabled', () => {
  // Given
  const terminalHead = game({
    campaignId: 'terminal-head',
    rewardSummary: { completion: 'farming-complete', remainderReasons: ['unverifiable-twitch'] },
  });
  const farmableCampaign = game({
    campaignId: 'later-farmable',
    campaignName: 'Later Farmable Campaign',
    rewardSummary: { completion: 'farmable', remainderReasons: [] },
  });

  // When
  const markup = renderMainView(appState(null), [terminalHead, farmableCampaign]);
  const startButton = startButtonMarkup(markup);

  // Then
  expect(startButton).toContain('Start Queue (2)');
  expect(startButton).not.toContain(' disabled=');
});

test('farming-complete terminal render ignores false all-claimed message and keeps separate reasons', () => {
  // Given
  const selectedGame = game({
    rewardSummary: {
      completion: 'farming-complete',
      remainderReasons: ['subscription-required', 'unverifiable-twitch'],
    },
  });
  const state = {
    ...appState(selectedGame),
    lastStopReason: 'unverifiable-twitch',
    lastStopMessage: 'All rewards claimed',
  } satisfies AppState;

  // When
  const markup = renderMainView(state, [], { runtimeMode: 'stopped-terminal' });

  // Then
  expect(markup).not.toContain('All rewards claimed');
  expect(markup.match(/data-campaign-status-reason=/g)).toHaveLength(2);
  expect(markup).toContain('All farmable rewards claimed · Subscription required for remaining rewards');
  expect(markup).toContain('Farming finished · Twitch reward acquisition could not be verified');
});

test('typed farming-complete queue feedback reuses the selected-campaign status vocabulary', () => {
  // Given
  const selectedGame = game({
    rewardSummary: {
      completion: 'farming-complete',
      remainderReasons: ['subscription-required', 'unverifiable-twitch'],
    },
  });

  // When
  const markup = renderMainView(appState(selectedGame), [], {
    queueMessage: formatFarmingCompleteQueueMessage(selectedGame),
  });

  // Then
  expect(markup).toContain('All farmable rewards claimed · Subscription required for remaining rewards');
  expect(markup).toContain('Farming finished · Twitch reward acquisition could not be verified');
  expect(markup).not.toContain('already claimed');
});

