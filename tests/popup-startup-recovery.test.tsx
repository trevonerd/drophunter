import { expect, test } from 'bun:test';
import { createInitialState } from '../src/shared/utils';
import { game, renderMainView, startButtonMarkup } from './fixtures/popup-reward';

function pendingState() {
  const selected = game();
  return {
    ...createInitialState(),
    selectedGame: selected,
    queue: [selected],
    availableGames: [selected],
    twitchSessionDetected: true,
    campaignSyncState: {
      ...createInitialState().campaignSyncState,
      status: 'retry-scheduled' as const,
      nextRetryAt: Date.now() + 60_000,
      error: 'private transport text',
      retryAttemptCount: 3,
      lastErrorKind: 'network' as const,
    },
  };
}

test('puts the startup blocker before session and queue without duplicating it', () => {
  // Given cached queued campaigns awaiting validation.
  const state = pendingState();
  // When opening the popup before farming starts.
  const markup = renderMainView(state, state.queue, { campaignSyncStatus: 'pending-validation' });
  // Then the cause and recovery actions precede both operational sections.
  const syncAt = markup.indexOf('aria-label="Campaign sync status"');
  expect(syncAt).toBeGreaterThan(-1);
  expect(syncAt).toBeLessThan(markup.indexOf('aria-label="Current farming session"'));
  expect(syncAt).toBeLessThan(markup.indexOf('aria-label="Farming queue"'));
  expect(markup.match(/aria-label="Campaign sync status"/g)).toHaveLength(1);
});

test('replaces a redundant Start action with Stop when an authorized queue awaits validation', () => {
  // Given a started queue whose continuation is already authorized.
  const state = { ...pendingState(), manualQueueAuthorized: true };
  // When startup is waiting for the existing scheduled retry.
  const markup = renderMainView(state, state.queue, { campaignSyncStatus: 'pending-validation' });
  // Then the user can cancel the pending start without being asked to start again.
  expect(startButtonMarkup(markup)).toBe('');
  expect(markup).toContain('>Stop</button>');
  expect(markup).toContain('data-startup-continuation="automatic"');
});

test('keeps manual Start available when the queue has not been authorized', () => {
  // Given a manually populated queue and no automatic favorites.
  const state = { ...pendingState(), manualQueueAuthorized: false, autoStartFavoriteGames: true };
  // When showing saved campaigns pending validation.
  const markup = renderMainView(state, state.queue, { campaignSyncStatus: 'pending-validation' });
  // Then favorite auto-start alone does not claim authorization for manual campaigns.
  expect(startButtonMarkup(markup)).not.toBe('');
  expect(markup).not.toContain('data-startup-continuation="automatic"');
});

test('shows automatic continuation for an enabled favorite awaiting validation', () => {
  // Given a favorite campaign which will be considered automatically.
  const base = pendingState();
  const state = {
    ...base,
    autoStartFavoriteGames: true,
    favoriteGames: [{ gameId: base.selectedGame.id, lastKnownName: base.selectedGame.name, addedAt: 1 }],
  };
  // When validation prevents acquisition.
  const markup = renderMainView(state, state.queue, { campaignSyncStatus: 'pending-validation' });
  // Then the primary action does not misleadingly request a second manual start.
  expect(startButtonMarkup(markup)).toBe('');
  expect(markup).toContain('data-startup-continuation="automatic"');
});

test('keeps active farming ahead of a nonblocking catalog refresh', () => {
  // Given farming already running while campaign metadata refreshes.
  const state = { ...pendingState(), isRunning: true };
  // When rendering the nonblocking refresh.
  const markup = renderMainView(state, state.queue, {
    campaignSyncStatus: 'pending-validation', runtimeMode: 'running',
  });
  // Then the running session remains first.
  expect(markup.indexOf('aria-label="Current farming session"')).toBeLessThan(
    markup.indexOf('aria-label="Campaign sync status"'),
  );
});

test('preserves manual Start after an explicit stop even when favorites remain enabled', () => {
  // Given a favorite stopped by the user, with possible automation snooze.
  const base = pendingState();
  const state = {
    ...base,
    lastStopReason: 'user-stop',
    autoStartFavoriteGames: true,
    favoriteGames: [{ gameId: base.selectedGame.id, lastKnownName: base.selectedGame.name, addedAt: 1 }],
  };
  // When a later catalog retry still has not validated campaigns.
  const markup = renderMainView(state, state.queue, {
    campaignSyncStatus: 'pending-validation', runtimeMode: 'stopped-terminal',
  });
  // Then the UI preserves the user's explicit restart action.
  expect(startButtonMarkup(markup)).not.toBe('');
  expect(markup).not.toContain('data-startup-continuation="automatic"');
});

test('asks for Twitch only when campaign validation actually needs a session', () => {
  // Given a validation result that requires a Twitch browser session.
  const base = pendingState();
  const state = {
    ...base,
    campaignSyncState: {
      ...base.campaignSyncState,
      status: 'needs-session' as const,
      nextRetryAt: null,
      lastErrorKind: 'session' as const,
    },
  };
  // When showing the startup blocker.
  const markup = renderMainView(state, state.queue, { campaignSyncStatus: 'pending-validation' });
  // Then one dedicated session action replaces recovery controls.
  expect(markup).toContain('data-session-priority="twitch-required"');
  expect(markup).toContain('>Go to Drops</button>');
  expect(markup).not.toContain('aria-label="Campaign sync status"');
  expect(markup).not.toContain('>Retry</button>');
  expect(markup).toContain('data-session-priority="twitch-required"');
});

test('asks for Twitch verification without implying sign-in when silent integrity recovery is exhausted', () => {
  // Given a needs-session result caused by Twitch browser verification.
  const base = pendingState();
  const state = {
    ...base,
    campaignSyncState: {
      ...base.campaignSyncState,
      status: 'needs-session' as const,
      nextRetryAt: null,
      lastErrorKind: 'integrity' as const,
    },
  };
  // When showing the actionable startup blocker.
  const markup = renderMainView(state, state.queue, { campaignSyncStatus: 'pending-validation' });
  // Then the requested intervention concerns verification, not an unproven invalid login.
  expect(markup).toContain('>Go to Drops</button>');
  expect(markup).not.toContain('Sign in');
});
