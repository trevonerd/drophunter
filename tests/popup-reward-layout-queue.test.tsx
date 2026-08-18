import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueueChips } from '../src/popup/components/QueueChips';
import { appState, game, renderMainView } from './fixtures/popup-reward';

test('start stays before the single-scroll campaign browser and queue actions remain enabled while farming', () => {
  const activeCampaign = game({ campaignId: 'active', campaignName: 'Active Campaign' });
  const availableCampaign = game({
    id: 'other-game',
    name: 'Other Game',
    campaignId: 'available',
    campaignName: 'Available Campaign',
  });
  const idleMarkup = renderMainView(
    { ...appState(activeCampaign), availableGames: [activeCampaign, availableCampaign] },
    [activeCampaign],
  );
  const runningMarkup = renderMainView(
    {
      ...appState(activeCampaign),
      availableGames: [activeCampaign, availableCampaign],
      queue: [activeCampaign],
      isRunning: true,
    },
    [activeCampaign],
  );

  const sessionSummary = idleMarkup.match(/<section[^>]*data-session-mode="ready"[\s\S]*?<\/section>/)?.[0];
  const queueIndex = idleMarkup.indexOf('aria-label="Farming queue"');
  const campaignsIndex = idleMarkup.indexOf('aria-label="Campaigns"');
  expect(sessionSummary).toContain('Start Queue');
  expect(idleMarkup.indexOf('data-session-mode="ready"')).toBeLessThan(queueIndex);
  expect(queueIndex).toBeLessThan(campaignsIndex);
  expect(idleMarkup.slice(queueIndex, campaignsIndex)).toContain('Queued');
  expect(idleMarkup.slice(campaignsIndex)).toContain('aria-label="Search campaigns"');
  expect(idleMarkup).not.toContain('data-campaign-browser-scroll');
  expect(runningMarkup).toContain('aria-label="Add Other Game · Available Campaign to queue"');
  expect(runningMarkup).not.toMatch(
    /aria-label="Add Other Game · Available Campaign to queue"[^>]*disabled/,
  );
});

test('ending-soonest explains order once and preserves relative expiry', () => {
  const relativeExpiryCampaign = game({ endsAt: null, expiresInMs: 3_600_000 });
  const state = {
    ...appState(relativeExpiryCampaign),
    campaignPriorityMode: 'ending-soonest' as const,
  };

  const markup = renderMainView(state);

  expect(markup).toContain('Sorted: Expiring first');
  expect(markup).toContain('Ends in 1h');
  expect(markup).not.toContain('Position #');
});

test('selected subscription status aligns its cost icon beside wrapped copy', () => {
  // Given
  const selectedGame = game({
    rewardSummary: { completion: 'farming-complete', remainderReasons: ['subscription-required'] },
  });

  // When
  const markup = renderMainView(appState(selectedGame));

  // Then
  expect(markup).toContain('class="flex min-w-0 items-start gap-1.5 text-[11px]"');
  expect(markup).toContain('class="inline-flex min-h-[1lh] shrink-0 items-center gap-1"');
  expect(markup).toContain('class="min-w-0 flex-1 space-y-1"');
  expect(markup.indexOf('data-campaign-indicator="subscription-required"')).toBeLessThan(
    markup.indexOf('data-campaign-status-reason="subscription-required"'),
  );
});

test('campaign list keeps disconnected and all-acquired indicators independent', () => {
  // Given
  const selectedGame = game({
    isConnected: false,
    allDropsCompleted: true,
    rewardSummary: { completion: 'all-acquired', remainderReasons: [] },
  });

  // When
  const markup = renderMainView(appState(selectedGame));

  // Then
  expect(markup).toContain('Completed · 100%');
  expect(markup).not.toContain('Show Drops');
  expect(markup).toContain('data-campaign-indicator="all-acquired"');
  expect(markup).toContain('data-campaign-indicator="disconnected"');
});

test('queue chips reuse campaign indicators', () => {
  // Given
  const queuedGame = game({
    rewardSummary: {
      completion: 'farming-complete',
      remainderReasons: ['subscription-required', 'unverifiable-twitch'],
    },
  });

  // When
  const markup = renderToStaticMarkup(
    <QueueChips
      selectedGame={null}
      queueGames={[queuedGame]}
      isRunning={false}
      onRemove={() => {}}
      onClear={() => {}}
      onReorder={() => {}}
    />,
  );

  // Then
  expect(markup).toContain('data-campaign-indicator="subscription-required"');
  expect(markup).toContain('data-campaign-indicator="unverifiable-twitch"');
});

test('running queue shows only campaigns that come after the current campaign', () => {
  const currentCampaign = game({ campaignId: 'current', campaignName: 'Current Campaign' });
  const nextCampaign = game({
    id: 'next-game',
    name: 'Next Game',
    campaignId: 'next',
    campaignName: 'Next Campaign',
  });
  const callbacks = { onRemove: () => {}, onClear: () => {}, onReorder: () => {} };

  const currentOnly = renderToStaticMarkup(
    <QueueChips
      selectedGame={currentCampaign}
      queueGames={[currentCampaign]}
      isRunning={true}
      {...callbacks}
    />,
  );
  const withNext = renderToStaticMarkup(
    <QueueChips
      selectedGame={currentCampaign}
      queueGames={[currentCampaign, nextCampaign]}
      isRunning={true}
      {...callbacks}
    />,
  );

  expect(currentOnly).toBe('');
  expect(withNext).toContain('Queued');
  expect(withNext).toContain('Next Game · Next Campaign');
  expect(withNext).not.toContain('Example Game · Current Campaign');
});

test('running future queue rows retain drag handles and remove actions', () => {
  const currentCampaign = game({ campaignId: 'current', campaignName: 'Current Campaign' });
  const firstFuture = game({
    id: 'next-game',
    name: 'Next Game',
    campaignId: 'next',
    campaignName: 'Next Campaign',
  });
  const secondFuture = game({
    id: 'later-game',
    name: 'Later Game',
    campaignId: 'later',
    campaignName: 'Later Campaign',
  });

  const markup = renderToStaticMarkup(
    <QueueChips
      selectedGame={currentCampaign}
      queueGames={[currentCampaign, firstFuture, secondFuture]}
      isRunning={true}
      onRemove={() => {}}
      onClear={() => {}}
      onReorder={() => {}}
    />,
  );

  expect(markup.match(/draggable="true"/g)).toHaveLength(2);
  expect(markup).toContain('Remove Next Game · Next Campaign from queue');
  expect(markup).toContain('Remove Later Game · Later Campaign from queue');
  expect(markup).not.toContain('Remove Current Game · Current Campaign from queue');
});

