import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CampaignStatusIndicators } from '../src/popup/components/CampaignStatusIndicators';
import { appState, game, renderMainView } from './fixtures/popup-reward';

test('all-acquired stays exclusive while disconnected account status remains independent', () => {
  // Given
  const selectedGame = game({
    isConnected: false,
    rewardSummary: { completion: 'all-acquired', remainderReasons: [] },
    allDropsCompleted: true,
  });

  // When
  const markup = renderMainView(appState(selectedGame));

  // Then
  expect(markup).toContain('data-campaign-indicator="all-acquired"');
  expect(markup).toContain('data-campaign-indicator="disconnected"');
  expect(markup).not.toContain('data-campaign-indicator="subscription-required"');
  expect(markup).not.toContain('data-campaign-indicator="unverifiable-twitch"');
});

test('selected disconnected campaign explains why it is locked', () => {
  // Given
  const selectedGame = game({ isConnected: false });

  // When
  const markup = renderMainView(appState(selectedGame));

  // Then
  expect(markup).toContain('data-campaign-indicator="disconnected"');
  expect(markup).toContain('data-campaign-status-reason="disconnected"');
  expect(markup).toContain('Connect your game account on Twitch to unlock this campaign.');
});

test('subscription-required renders the payment-card indicator independently', () => {
  // Given
  const campaign = game({
    rewardSummary: { completion: 'farming-complete', remainderReasons: ['subscription-required'] },
  });

  // When
  const markup = renderToStaticMarkup(<CampaignStatusIndicators game={campaign} />);

  // Then
  expect(markup).toContain('data-campaign-indicator="subscription-required"');
  expect(markup).toContain('data-subscription-icon="payment-card"');
  expect(markup).toContain('<rect x="3" y="5" width="18" height="14" rx="2"');
  expect(markup).not.toContain('data-campaign-indicator="unverifiable-twitch"');
  expect(markup).not.toContain('data-campaign-indicator="all-acquired"');
});

test('unverifiable-twitch renders the circled-question indicator independently', () => {
  // Given
  const campaign = game({
    rewardSummary: { completion: 'farming-complete', remainderReasons: ['unverifiable-twitch'] },
  });

  // When
  const markup = renderToStaticMarkup(<CampaignStatusIndicators game={campaign} />);

  // Then
  expect(markup).toContain('data-campaign-indicator="unverifiable-twitch"');
  expect(markup).not.toContain('data-campaign-indicator="subscription-required"');
  expect(markup).not.toContain('data-campaign-indicator="all-acquired"');
});

test('combined farming-complete indicators stay payment then question with no green check', () => {
  // Given
  const campaign = game({
    rewardSummary: {
      completion: 'farming-complete',
      remainderReasons: ['unverifiable-twitch', 'subscription-required'],
    },
  });

  // When
  const markup = renderToStaticMarkup(<CampaignStatusIndicators game={campaign} />);
  const subscriptionIndex = markup.indexOf('data-campaign-indicator="subscription-required"');
  const questionIndex = markup.indexOf('data-campaign-indicator="unverifiable-twitch"');

  // Then
  expect(subscriptionIndex).toBeGreaterThan(-1);
  expect(questionIndex).toBeGreaterThan(subscriptionIndex);
  expect(markup.match(/data-campaign-indicator=/g)).toHaveLength(2);
  expect(markup).not.toContain('data-campaign-indicator="all-acquired"');
});

test('campaign list keeps campaign identity while selected status indicators remain ordered', () => {
  // Given
  const selectedGame = game({
    isConnected: false,
    rewardSummary: {
      completion: 'farming-complete',
      remainderReasons: ['unverifiable-twitch', 'subscription-required'],
    },
  });

  // When
  const markup = renderMainView(appState(selectedGame));

  // Then
  expect(markup).not.toContain('aria-label="Select Example Game · Example Campaign"');
  const subscriptionIndex = markup.indexOf('data-campaign-indicator="subscription-required"');
  const questionIndex = markup.indexOf('data-campaign-indicator="unverifiable-twitch"');
  const disconnectedIndex = markup.indexOf('data-campaign-indicator="disconnected"');
  expect(subscriptionIndex).toBeGreaterThan(-1);
  expect(questionIndex).toBeGreaterThan(subscriptionIndex);
  expect(disconnectedIndex).toBeGreaterThan(questionIndex);
  expect(markup).not.toContain('data-campaign-indicator="all-acquired"');
});

