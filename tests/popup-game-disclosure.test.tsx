import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CampaignList } from '../src/popup/components/CampaignList';
import type { TwitchDrop, TwitchGame } from '../src/types';

function campaign(overrides: Partial<TwitchGame> = {}): TwitchGame {
  return {
    id: 'game-1',
    name: 'Cyberpunk 2077',
    imageUrl: '',
    campaignId: 'campaign-1',
    campaignName: 'Phantom Liberty Rewards',
    endsAt: '2030-08-03T18:00:00.000Z',
    isConnected: true,
    ...overrides,
  };
}

function reward(overrides: Partial<TwitchDrop> = {}): TwitchDrop {
  return {
    id: 'reward-1',
    name: 'Neon Jacket',
    gameId: 'game-1',
    gameName: 'Cyberpunk 2077',
    campaignId: 'campaign-1',
    imageUrl: '',
    progress: 42,
    currentMinutes: 21,
    claimed: false,
    claimable: false,
    status: 'active',
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
    ...overrides,
  };
}

test('campaign browser starts with one compact game summary and independent actions', () => {
  // Given
  const linked = campaign({ campaignId: 'campaign-linked' });
  const unlinked = campaign({
    campaignId: 'campaign-unlinked',
    campaignName: 'Night City Anniversary',
    isConnected: false,
    accountLinkUrl: 'https://accounts.cdprojektred.com/twitch/link',
  });
  const next = campaign({ campaignId: 'campaign-next', campaignName: 'Edgerunners Encore' });

  // When
  const markup = renderToStaticMarkup(
    <CampaignList
      campaigns={[linked, unlinked, next]}
      drops={[
        reward({ campaignId: 'campaign-linked' }),
        reward({ id: 'reward-2', campaignId: 'campaign-unlinked' }),
        reward({ id: 'reward-3', campaignId: 'campaign-next' }),
      ]}
      queueGames={[linked]}
      onSetFavorite={() => {}}
      onAddToQueue={() => {}}
      onRemoveFromQueue={() => {}}
    />,
  );

  // Then
  expect(markup.match(/data-game-summary=/g)).toHaveLength(1);
  expect(markup).toContain('data-game-summary="true"');
  expect(markup).toContain('aria-expanded="false"');
  expect(markup).toContain('data-game-detail="true"');
  expect(markup).toContain('hidden=""');
  expect(markup).toContain('3 campaigns');
  expect(markup).toContain('Not linked');
  expect(markup).toContain('Queue #1');
  expect(markup).toContain('aria-label="Add all available Cyberpunk 2077 campaigns to queue"');
  expect(markup).toContain('aria-label="Add Cyberpunk 2077 to favorite games"');
});

test('running campaign is distinct from queued campaigns and Not linked is not duplicated', () => {
  const running = campaign({
    campaignId: 'campaign-running',
    isConnected: false,
    accountLinkUrl: 'https://accounts.cdprojektred.com/twitch/link',
  });
  const markup = renderToStaticMarkup(
    <CampaignList
      campaigns={[running]}
      drops={[reward({ campaignId: 'campaign-running' })]}
      queueGames={[running]}
      runningGame={running}
      onSetFavorite={() => {}}
      onAddToQueue={() => {}}
      onAddAllToQueue={() => {}}
      onRemoveFromQueue={() => {}}
    />,
  );

  expect(markup.match(/Not linked/g)).toHaveLength(1);
  expect(markup).toContain('data-running="true"');
  expect(markup).toContain('Running');
  expect(markup).not.toContain('Queued 1');
  expect(markup).toContain('dh-progress-fill--running');
});

test('game summary reports absolute queue positions for multiple campaigns', () => {
  const first = campaign({ campaignId: 'campaign-first', campaignName: 'First Campaign' });
  const second = campaign({ campaignId: 'campaign-second', campaignName: 'Second Campaign' });
  const unrelated = campaign({
    id: 'other-game',
    name: 'Other Game',
    campaignId: 'campaign-other',
    campaignName: 'Other Campaign',
  });

  const markup = renderToStaticMarkup(
    <CampaignList
      campaigns={[first, second, unrelated]}
      queueGames={[first, unrelated, second]}
      onAddToQueue={() => {}}
      onRemoveFromQueue={() => {}}
    />,
  );

  expect(markup).toContain('Queue #1, #3');
  expect(markup).not.toContain('Queued 2');
});

test('subscription-only campaign disables Add with an accessible explanation', () => {
  const subscriptionOnly = campaign({
    rewardSummary: { completion: 'farming-complete', remainderReasons: ['subscription-required'] },
  });
  const subscriptionReward = reward({ acquisitionMethod: 'subscription', progress: 0, currentMinutes: 0 });
  const markup = renderToStaticMarkup(
    <CampaignList
      campaigns={[subscriptionOnly]}
      drops={[subscriptionReward]}
      loadedCampaignKeys={['campaign:campaign-1']}
      onAddToQueue={() => {}}
      onAddAllToQueue={() => {}}
    />,
  );

  expect(markup).toContain('data-subscription-only="true"');
  expect(markup).toContain('This campaign only contains subscription rewards');
  expect(markup).toContain('aria-label="Add Cyberpunk 2077 · Phantom Liberty Rewards to queue"');
  expect(markup).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Add Cyberpunk 2077 · Phantom Liberty Rewards to queue"/);
});

test('game detail presents campaigns and Drops without another disclosure layer', () => {
  // Given
  const first = campaign({
    campaignId: 'campaign-first',
    isConnected: false,
    accountLinkUrl: 'https://accounts.cdprojektred.com/twitch/link',
  });
  const second = campaign({
    campaignId: 'campaign-second',
    campaignName: 'Night City Anniversary',
  });

  // When
  const markup = renderToStaticMarkup(
    <CampaignList
      campaigns={[first, second]}
      drops={[
        reward({ campaignId: 'campaign-first' }),
        reward({ id: 'reward-2', name: 'Anniversary Jacket', campaignId: 'campaign-second' }),
      ]}
      onSetFavorite={() => {}}
      onAddToQueue={() => {}}
      onRemoveFromQueue={() => {}}
    />,
  );

  // Then
  expect(markup.match(/data-campaign-key=/g)).toHaveLength(2);
  expect(markup).toContain('Phantom Liberty Rewards');
  expect(markup).toContain('Night City Anniversary');
  expect(markup).toContain('Neon Jacket');
  expect(markup).toContain('Anniversary Jacket');
  expect(markup).toContain('href="https://accounts.cdprojektred.com/twitch/link"');
  expect(markup).not.toContain('Show Drops');
  expect(markup).not.toContain('Hide Drops');
  expect(markup).not.toContain('campaign-drops-');
});

test('unlinked campaign always offers a safe account-link fallback', () => {
  const unlinked = campaign({ accountLinkUrl: undefined, isConnected: false });
  const markup = renderToStaticMarkup(
    <CampaignList
      campaigns={[unlinked]}
      drops={[reward()]}
      loadedCampaignKeys={['campaign:campaign-1']}
      onAddToQueue={() => {}}
      onAddAllToQueue={() => {}}
    />,
  );

  expect(markup).toContain('href="https://www.twitch.tv/settings/connections"');
  expect(markup).toContain('>Link account<');
});
