import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueueChips } from '../src/popup/components/QueueChips';
import { campaign } from './fixtures/popup-automation';

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
