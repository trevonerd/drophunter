import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AutomationSummary } from '../src/popup/components/AutomationSummary';
import { CampaignList, shouldShowOtherDrops } from '../src/popup/components/CampaignList';
import { QueueChips } from '../src/popup/components/QueueChips';
import { SettingsView } from '../src/popup/components/SettingsView';
import { sortCampaignGroups } from '../src/popup/components/campaign-list-model';
import { createInitialState } from '../src/shared/utils';
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

test('queue chips show provenance and allow direct reorder from automatic modes', () => {
  const first = campaign({ campaignId: 'campaign-first', name: 'Cyberpunk 2077' });
  const second = campaign({ campaignId: 'campaign-second', name: 'Fortnite', id: 'game-2' });
  const markup = renderToStaticMarkup(
    <QueueChips
      selectedGame={null}
      queueGames={[first, second]}
      isRunning={false}
      campaignPriorityMode="ending-soonest"
      queueEntryMetadataByKey={{
        'campaign:campaign-first': {
          source: 'favorite-auto',
          addedAt: 1,
          reason: 'favorite-discovered',
        },
        'campaign:campaign-second': { source: 'manual', addedAt: 2, reason: 'user-added' },
      }}
      favoriteGameIds={['game-1']}
      now={Date.parse('2030-08-03T10:00:00.000Z')}
      onRemove={() => {}}
      onClear={() => {}}
      onReorder={() => {}}
    />,
  );

  expect(markup).toContain('1');
  expect(markup).toContain('Favorite · Added automatically');
  expect(markup).toContain('Added manually');
  expect(markup.match(/data-queue-item="campaign"/g)).toHaveLength(2);
  expect(markup.match(/draggable="true"/g)).toHaveLength(2);
  expect(markup).not.toContain('Choose Manual queue in Settings to reorder.');
});

test('queue never renders a selected campaign that was not explicitly queued', () => {
  // Given
  const staleSelection = campaign({ campaignId: 'old-selection', campaignName: 'Old selection' });
  const queuedCampaign = campaign({ campaignId: 'new-queue', campaignName: 'New queue entry' });

  // When
  const markup = renderToStaticMarkup(
    <QueueChips
      selectedGame={staleSelection}
      queueGames={[queuedCampaign]}
      isRunning={false}
      onRemove={() => {}}
      onClear={() => {}}
      onReorder={() => {}}
    />,
  );

  // Then
  expect(markup).toContain('New queue entry');
  expect(markup).not.toContain('Old selection');
  expect(markup).not.toContain('first');
});

test('priority list mode keeps keyboard and drag reorder affordances', () => {
  const markup = renderToStaticMarkup(
    <QueueChips
      selectedGame={null}
      queueGames={[campaign({ campaignId: 'a' }), campaign({ campaignId: 'b', id: 'game-2' })]}
      isRunning={false}
      campaignPriorityMode="priority-list-only"
      onRemove={() => {}}
      onClear={() => {}}
      onReorder={() => {}}
    />,
  );

  expect(markup).toContain('draggable="true"');
  expect(markup).toContain('Use arrow keys to move.');
});

test('other Twitch Drops stay out of favorite and search-filtered results', () => {
  expect(shouldShowOtherDrops('all', '', 1)).toBe(true);
  expect(shouldShowOtherDrops('favorites-only', '', 1)).toBe(false);
  expect(shouldShowOtherDrops('all', 'jacket', 1)).toBe(false);
  expect(shouldShowOtherDrops('all', '', 0)).toBe(false);
});

test('automation shows one recent event only while enabled and never renders an activity feed', () => {
  const recentActivity = {
    id: 'auto-started:campaign-1',
    kind: 'auto-started' as const,
    at: Date.now(),
    campaignId: 'campaign-1',
    message: 'Cyberpunk 2077 started automatically.',
  };
  const enabledState = {
    ...createInitialState(),
    twitchSessionDetected: true,
    autoStartFavoriteGames: true,
    automationActivity: [recentActivity],
  };
  const enabledMarkup = renderToStaticMarkup(<AutomationSummary state={enabledState} />);
  const disabledMarkup = renderToStaticMarkup(
    <AutomationSummary state={{ ...enabledState, autoStartFavoriteGames: false }} />,
  );

  expect(enabledMarkup).toContain('Cyberpunk 2077 started automatically.');
  expect(enabledMarkup).not.toContain('>Activity<');
  expect(enabledMarkup).not.toContain('>Now<');
  expect(enabledMarkup).not.toContain('>Next<');
  expect(disabledMarkup).not.toContain('Cyberpunk 2077 started automatically.');
  expect(disabledMarkup).toContain('Automatic farming for favorite games is off.');
});

test('settings exposes farming automation controls and the resumed-session wording', () => {
  const state = {
    ...createInitialState(),
    favoriteGames: [{ gameId: 'game-1', lastKnownName: 'Cyberpunk 2077', addedAt: 1 }],
    campaignPriorityMode: 'ending-soonest' as const,
    farmCategoryScope: 'favorites-only' as const,
  };
  const markup = renderToStaticMarkup(
    <SettingsView
      state={state}
      onBack={() => {}}
      onOpenClaimLog={() => {}}
      onMonitorAutoOpenToggle={() => {}}
      onMuteFarmingTabToggle={() => {}}
      onNotificationsEnabledToggle={() => {}}
      onTelegramAlertsToggle={async () => undefined}
      onSaveTelegramCredentials={async () => undefined}
      onTestTelegramAlerts={async () => undefined}
      onLoadTelegramSettings={async () => undefined}
      onAutoResumeOnStartupToggle={() => {}}
      onAutoClaimChannelPointsBonusToggle={() => {}}
      onAutoClaimDropsToggle={() => {}}
      onStreamerSelectionModeChange={() => {}}
      onPreferredStreamerLanguageChange={() => {}}
      onAutoStartFavoriteGamesToggle={() => {}}
      onFarmCategoryScopeChange={() => {}}
      onWatchTransportModeChange={() => {}}
    />,
  );

  expect(markup).toContain('Farming automation');
  expect(markup).toContain('Auto-start favorite games');
  expect(markup).not.toContain('Campaign priority');
  expect(markup).toContain('Favorite games (1)');
  expect(markup).toContain('Watch mode');
  expect(markup).toContain('Tabless heartbeat');
  expect(markup).toContain('Uses a muted inactive tab, retries playback automatically, and never takes focus.');
  expect(markup).toContain('Resume interrupted session');
  expect(markup).toContain('Resume a farming session that was already running before the browser stopped.');
});
