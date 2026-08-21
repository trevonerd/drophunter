import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CampaignList,
  resolveStoredCatalogFilter,
  shouldShowOtherDrops,
} from '../src/popup/components/CampaignList';
import { GameCampaignGroup } from '../src/popup/components/GameCampaignGroup';
import { groupCampaigns, sortCampaignGroups } from '../src/popup/components/campaign-list-model';
import { campaign, reward } from './fixtures/popup-automation';

test('campaign catalog supports expiring, availability, and alphabetical sorting', () => {
  const alpha = campaign({ id: 'alpha', campaignId: 'alpha', name: 'Alpha', endsAt: '2030-08-05T10:00:00.000Z' });
  const beta = campaign({ id: 'beta', campaignId: 'beta', name: 'Beta', endsAt: '2030-08-04T10:00:00.000Z' });
  const groups = [
    { key: 'beta', name: 'Beta', imageUrl: '', campaigns: [beta] },
    { key: 'alpha', name: 'Alpha', imageUrl: '', campaigns: [alpha] },
  ];
  const progress = {
    'campaign:alpha': { eligibleStreamerCount: 1 },
    'campaign:beta': { eligibleStreamerCount: 8 },
  };

  expect(sortCampaignGroups(groups, 'ending-soonest', progress).map((group) => group.name)).toEqual([
    'Beta',
    'Alpha',
  ]);
  expect(sortCampaignGroups(groups, 'lowest-availability', progress).map((group) => group.name)).toEqual([
    'Alpha',
    'Beta',
  ]);
  expect(sortCampaignGroups(groups, 'alphabetical', progress).map((group) => group.name)).toEqual([
    'Alpha',
    'Beta',
  ]);
});

test('popup does not reopen on an empty persisted Hidden catalog', () => {
  expect(resolveStoredCatalogFilter('hidden-only', [])).toBe('available');
  expect(resolveStoredCatalogFilter('hidden-only', ['game-1'])).toBe('hidden-only');
  expect(resolveStoredCatalogFilter('all', [])).toBe('available');
  expect(resolveStoredCatalogFilter('favorites-only', [])).toBe('favorites-only');
  expect(resolveStoredCatalogFilter('invalid', [])).toBe('available');
});

test('campaign list exposes compact campaign status and favorite control without repeated position copy', () => {
  const game = campaign();
  const markup = renderToStaticMarkup(
    <CampaignList
      campaigns={[game]}
      drops={[reward()]}
      favoriteGameIds={['game-1']}
      queueGames={[]}
      progressByCampaignKey={{
        'campaign:campaign-1': {
          nextRewardName: 'Neon Jacket',
          progress: 42,
          currentMinutes: 21,
          requiredMinutes: 50,
          eligibleStreamerCount: 3,
        },
      }}
      highlightedCampaignKey="campaign:campaign-1"
      now={Date.parse('2030-08-03T10:00:00.000Z')}
      onSetFavorite={() => {}}
      onAddToQueue={() => {}}
      onRemoveFromQueue={() => {}}
    />,
  );

  expect(markup).toContain('Search campaigns');
  expect(markup).toContain('Cyberpunk 2077');
  expect(markup).toContain('Phantom Liberty Rewards');
  expect(markup).toContain('Neon Jacket');
  expect(markup).toContain('42%');
  expect(markup).toContain('3 eligible live channels');
  expect(markup).toContain('Ends in 8h');
  expect(markup).not.toContain('Position #');
  expect(markup).not.toContain('This campaign ends first.');
  expect(markup).not.toContain('Pending');
  expect(markup).toContain('aria-expanded="false"');
  expect(markup).toContain('hidden=""');
  expect(markup).toContain('Remove Cyberpunk 2077 from favorite games');
  expect(markup).toContain('inline-flex h-7 w-7');
  expect(markup).not.toContain('aria-label="Select Cyberpunk 2077 · Phantom Liberty Rewards"');
  expect(markup).toContain('data-highlighted="true"');
  expect(markup).not.toContain('data-campaign-browser-scroll');
  expect(markup).toContain('aria-label="Sort games"');
  expect(markup).toContain('aria-label="Filter games"');
  expect(markup).toContain('>Available</option>');
  expect(markup).toContain('>Favorites</option>');
  expect(markup).toContain('>Hidden</option>');
  expect(markup).toContain('aria-label="Hide Cyberpunk 2077"');
  expect(markup).toContain('dh-game-hide-action');
});

test('campaign browser does not report zero Drops before that campaign is hydrated', () => {
  // Given
  const game = campaign();

  // When
  const markup = renderToStaticMarkup(
    <CampaignList campaigns={[game]} drops={[]} loadedCampaignKeys={[]} queueGames={[]} />,
  );

  // Then
  expect(markup).toContain('Loading Drops');
  expect(markup).not.toContain('Drops (0)');
  expect(markup).not.toContain('0 claimed');
});

test('campaign browser replaces an endless Drop spinner with a delayed retry status', () => {
  const markup = renderToStaticMarkup(
    <CampaignList
      campaigns={[campaign()]}
      drops={[]}
      loadedCampaignKeys={[]}
      queueGames={[]}
      refreshInProgress
      refreshStartedAt={Date.now() - 15_001}
    />,
  );

  expect(markup).toContain('Still loading Drops — retrying…');
  expect(markup).not.toContain('Loading Drops…');
});

test('farming-complete campaign stays a closed one-line result', () => {
  // Given
  const completedCampaign = campaign({
    rewardSummary: { completion: 'all-acquired', remainderReasons: [] },
    allDropsCompleted: true,
  });

  // When
  const markup = renderToStaticMarkup(
    <CampaignList
      campaigns={[completedCampaign]}
      drops={[reward({ claimed: true, progress: 100, status: 'completed' })]}
      loadedCampaignKeys={['campaign:campaign-1']}
      queueGames={[]}
    />,
  );

  // Then
  expect(markup).toContain('Completed · 100%');
  expect(markup).not.toContain('Neon Jacket');
  expect(markup).not.toContain('Show Drops');
  expect(markup).not.toContain('Position #');
});

test('campaign browser renders one favorite game row with nested campaigns, every reward, and link actions', () => {
  const first = campaign({
    id: 'campaign-game-a',
    categoryId: '509658',
    categorySlug: 'cyberpunk-2077',
    accountLinkUrl: 'https://accounts.cdprojektred.com/twitch/link',
    isConnected: false,
  });
  const second = campaign({
    id: 'campaign-game-b',
    campaignId: 'campaign-2',
    campaignName: 'Night City Anniversary',
    categoryId: '509658',
    categorySlug: 'cyberpunk-2077',
  });
  const markup = renderToStaticMarkup(
    <CampaignList
      campaigns={[first, second]}
      drops={[
        reward(),
        reward({
          id: 'reward-subscription',
          name: 'Subscriber Katana',
          acquisitionMethod: 'subscription',
          progress: 0,
          currentMinutes: 0,
        }),
        reward({
          id: 'reward-claimed',
          name: 'Claimed Porsche',
          campaignId: 'campaign-2',
          claimed: true,
          progress: 100,
          status: 'completed',
        }),
      ]}
      favoriteGameIds={['509658']}
      queueGames={[]}
      onSetFavorite={() => {}}
      onAddToQueue={() => {}}
      onRemoveFromQueue={() => {}}
    />,
  );

  expect(markup.match(/data-game-key=/g)).toHaveLength(1);
  expect(markup.match(/data-campaign-key=/g)).toHaveLength(2);
  expect(markup.match(/aria-label="[^"]+ favorite games"/g)).toHaveLength(1);
  expect(markup).toContain('Neon Jacket');
  expect(markup).toContain('Subscriber Katana');
  expect(markup).toContain('Subscription required');
  expect(markup).toContain('Claimed Porsche');
  expect(markup).toContain('Claimed');
  expect(markup).toContain('Not linked');
  expect(markup).toContain('href="https://accounts.cdprojektred.com/twitch/link"');
  expect(markup).toContain('>Link account<');
  expect(markup).toContain('aria-label="Add Cyberpunk 2077 · Phantom Liberty Rewards to queue"');
  expect(markup).not.toMatch(/aria-label="Add Cyberpunk 2077 · Phantom Liberty Rewards to queue"[^>]*disabled/);
});

test('other Twitch Drops stay out of favorite and search-filtered results', () => {
  expect(shouldShowOtherDrops('available', '', 1)).toBe(true);
  expect(shouldShowOtherDrops('all', '', 1)).toBe(true);
  expect(shouldShowOtherDrops('favorites-only', '', 1)).toBe(false);
  expect(shouldShowOtherDrops('all', 'jacket', 1)).toBe(false);
  expect(shouldShowOtherDrops('all', '', 0)).toBe(false);
});

test('hidden filter exposes restore and suppresses queue actions', () => {
  const game = campaign();
  const group = groupCampaigns([game], [reward()], '')[0];
  expect(group).toBeDefined();
  if (!group) return;
  const markup = renderToStaticMarkup(
    <GameCampaignGroup
      group={group}
      allDrops={[reward()]}
      favorite={false}
      hidden
      queueGames={[]}
      loadedCampaignKeys={new Set(['campaign:campaign-1'])}
      expanded
      highlightedCampaignKey={null}
      actionLoading={false}
      now={Date.now()}
      onToggleGame={() => {}}
      onSetGamePreference={() => {}}
      onAddToQueue={() => {}}
      onRemoveFromQueue={() => {}}
    />,
  );

  expect(markup).toContain('Restore Cyberpunk 2077 to available games');
  expect(markup).toContain('>Restore<');
  expect(markup).not.toContain('aria-label="Add Cyberpunk 2077 · Phantom Liberty Rewards to queue"');
});
