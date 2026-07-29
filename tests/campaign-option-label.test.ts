import { expect, test } from 'bun:test';
import { formatCampaignOptionLabel } from '../src/popup/format';
import type { TwitchGame } from '../src/types';

function campaign(overrides: Partial<TwitchGame> = {}): TwitchGame {
  return {
    id: 'game-id',
    name: 'Example Game',
    imageUrl: '',
    campaignId: 'campaign-id',
    campaignName: 'Example Campaign',
    isConnected: true,
    ...overrides,
  };
}

test('campaign option shows the queue symbol only for the matching campaign identity', () => {
  // Given
  const queuedCampaign = campaign({
    campaignId: 'campaign-a',
    campaignName: 'Campaign A',
    rewardSummary: { completion: 'farming-complete', remainderReasons: ['subscription-required'] },
  });
  const siblingCampaign = campaign({ campaignId: 'campaign-b', campaignName: 'Campaign B' });

  // When
  const queuedLabel = formatCampaignOptionLabel(queuedCampaign, [queuedCampaign]);
  const siblingLabel = formatCampaignOptionLabel(siblingCampaign, [queuedCampaign]);

  // Then
  expect(queuedLabel).toStartWith('☷ 💳 ');
  expect(siblingLabel).not.toContain('☷');
});

test('campaign option waits for a saved inspection summary before showing the payment-card symbol', () => {
  // Given
  const uninspectedCampaign = campaign();
  const inspectedCampaign = campaign({
    rewardSummary: { completion: 'farming-complete', remainderReasons: ['subscription-required'] },
  });

  // When
  const uninspectedLabel = formatCampaignOptionLabel(uninspectedCampaign);
  const inspectedLabel = formatCampaignOptionLabel(inspectedCampaign);

  // Then
  expect(uninspectedLabel).not.toContain('💳');
  expect(inspectedLabel).toStartWith('💳 ');
});

test('campaign option does not derive a terminal symbol from an unsaved partial inspection', () => {
  // Given
  const inspectedCampaign = campaign();

  // When
  const label = formatCampaignOptionLabel(inspectedCampaign);

  // Then
  expect(label).not.toContain('💳');
});
