import { expect, test } from 'bun:test';
import { appState, game, renderMainView } from './fixtures/popup-reward.tsx';

test('managed switching keeps Pause and Stop available after the queued Play response settles', () => {
  const incumbent = game();
  const replacement = game({ campaignId: 'replacement', name: 'Replacement Game' });
  const state = appState(incumbent);
  state.autoStartFavoriteGames = false;
  state.isRunning = true;
  state.manualQueueAuthorized = true;
  state.pendingWatchTarget = { game: replacement, channelName: 'replacement_channel' };
  state.activeStreamer = null;
  state.watchHealth = null;
  const markup = renderMainView(state, [incumbent, replacement], {
    runtimeMode: 'running',
    actionLoading: false,
    farmingStartPending: false,
  });

  expect(markup).toContain('Switching to');
  expect(markup).toContain('Preparing replacement_channel.');
  expect(markup).toMatch(/<button[^>]*>Pause<\/button>/);
  expect(markup).toMatch(/<button[^>]*>Stop<\/button>/);
  expect(markup).not.toMatch(/<button[^>]*>Start (?:Farming|Queue)/);

  state.isRunning = false;
  state.manualQueueAuthorized = false;
  state.pendingWatchTarget = null;
  expect(renderMainView(state, [], { runtimeMode: 'idle' })).not.toMatch(/<button[^>]*>Stop<\/button>/);
});
