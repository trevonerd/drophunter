import { expect, test } from 'bun:test';
import { campaignValidationFeedback } from '../src/popup/components/campaign-sync-feedback';
import { deriveCampaignSyncStatus } from '../src/popup/constants';
import type { AppState } from '../src/types';
import { appState, game, renderMainView } from './fixtures/popup-reward';

test.each([
  ['network', 'Twitch could not be reached.'],
  ['integrity', 'Twitch verification is temporarily unavailable.'],
  ['rate-limit', 'Twitch requested a cooldown.'],
  ['invalid-response', 'Twitch returned incomplete campaign data.'],
  ['auth', 'Twitch rejected the saved session.'],
  ['session', 'The Twitch session needs refreshing.'],
  [null, 'The last campaign check did not finish.'],
] as const)('campaign feedback explains %s without exposing raw request errors', (lastErrorKind, message) => {
  const sync = {
    status: 'retry-scheduled', lastAttemptAt: 1, lastSuccessAt: null, campaignCount: 1,
    retryAttemptCount: 4, lastErrorKind, nextRetryAt: 120_000, attemptDeadlineAt: null,
    error: 'Raw transport failure',
  } as const;
  expect(campaignValidationFeedback(sync, 0)).toBe(`${message} Automatic retry in 2m.`);
  expect(campaignValidationFeedback(sync, 120_000)).toBe(`${message} Automatic retry due now.`);
});

test('saved campaigns stay pending validation until the background has a confirmed session', () => {
  const base = {
    activeSyncError: null,
    gamesLoading: false,
    availableCampaignCount: 0,
    twitchSessionDetected: false,
    isStale: false,
  };

  expect(deriveCampaignSyncStatus({ ...base, dropsRefreshLoading: false })).toBe('waiting');
  expect(
    deriveCampaignSyncStatus({
      ...base,
      availableCampaignCount: 1,
      dropsRefreshLoading: false,
      twitchSessionDetected: true,
      campaignSyncState: {
        status: 'needs-session',
        lastAttemptAt: 1,
        lastSuccessAt: 1,
        campaignCount: 1,
        nextRetryAt: null,
      },
    }),
  ).toBe('pending-validation');
  expect(
    deriveCampaignSyncStatus({
      ...base,
      dropsRefreshLoading: false,
      campaignSyncState: {
        status: 'retry-scheduled',
        lastAttemptAt: 1,
        lastSuccessAt: null,
        campaignCount: 0,
        nextRetryAt: Date.now() + 60_000,
        error: 'offline',
      },
    }),
  ).toBe('pending-validation');
  expect(
    deriveCampaignSyncStatus({
      ...base,
      availableCampaignCount: 1,
      twitchSessionDetected: true,
      dropsRefreshLoading: false,
      twitchSessionSyncState: { status: 'blocked', attempts: 2, nextRetryAt: null },
    }),
  ).toBe('signed-out');
});

test('a closed Twitch tab keeps saved campaigns pending validation with both recovery actions', () => {
  const savedCampaign = game({ campaignId: 'saved-campaign', isConnected: false });
  const state = {
    ...appState(savedCampaign),
    availableGames: [],
    twitchSessionDetected: false,
    twitchSessionSyncState: { status: 'retrying', attempts: 1, nextRetryAt: Date.now() + 60_000 },
    campaignSyncState: {
      status: 'retry-scheduled',
      lastAttemptAt: Date.now(),
      lastSuccessAt: null,
      campaignCount: 0,
      nextRetryAt: Date.now() + 60_000,
      error: 'offline',
    },
    queue: [savedCampaign],
  } satisfies AppState;

  const campaignSyncStatus = deriveCampaignSyncStatus({
    dropsRefreshLoading: false,
    activeSyncError: null,
    gamesLoading: false,
    availableCampaignCount: 0,
    twitchSessionDetected: false,
    isStale: false,
    campaignSyncState: state.campaignSyncState,
    twitchSessionSyncState: state.twitchSessionSyncState,
  });
  const markup = renderMainView(state, [savedCampaign], { campaignSyncStatus });

  expect(campaignSyncStatus).toBe('pending-validation');
  expect(markup).toContain('Saved campaigns are pending validation.');
  expect(markup).toContain('Retry');
  expect(markup).toContain('Open Twitch Drops');
  expect(markup).toContain('data-session-mode="pending-validation"');
  expect(markup).not.toContain('data-session-mode="ready"');
  expect(markup).not.toContain('Updating campaigns…');
  expect(markup).not.toContain('data-session-campaign-notice="true"');
  expect(markup).not.toContain('data-session-priority="twitch-required"');
  expect(markup).not.toContain('offline');
});

test('repeated network recovery shows the cause and next retry without asking users to sign in', () => {
  const savedCampaign = game({ campaignId: 'saved-campaign' });
  const state = {
    ...appState(savedCampaign),
    campaignSyncState: {
      status: 'retry-scheduled',
      lastAttemptAt: Date.now(),
      lastSuccessAt: null,
      campaignCount: 1,
      retryAttemptCount: 3,
      lastErrorKind: 'network',
      nextRetryAt: Date.now() + 60_000,
      attemptDeadlineAt: null,
      error: 'offline',
    },
  } satisfies AppState;

  const markup = renderMainView(state, [], { campaignSyncStatus: 'pending-validation' });

  expect(markup).toContain('Campaign validation is delayed.');
  expect(markup).toContain('Twitch could not be reached.');
  expect(markup).toContain('Automatic retry in 1m.');
  expect(markup).not.toContain('Sign in');
  expect(markup).not.toContain('offline');
});

test('a retry scheduling failure remains actionable with its friendly error', () => {
  const state = {
    ...appState(game()),
    campaignSyncState: {
      status: 'retry-failed',
      lastAttemptAt: Date.now(),
      lastSuccessAt: null,
      campaignCount: 1,
      retryAttemptCount: 3,
      lastErrorKind: 'network',
      nextRetryAt: null,
      attemptDeadlineAt: null,
      error: 'Unable to schedule another campaign check.',
    },
  } satisfies AppState;

  const markup = renderMainView(state, [], { campaignSyncStatus: 'failed' });

  expect(markup).toContain('Campaign update failed. Showing saved data.');
  expect(markup).toContain('Unable to schedule another campaign check.');
  expect(markup).toContain('Retry');
  expect(markup).toContain('data-session-mode="pending-validation"');
});

test('queue cleanup remains visible when favorite auto-start is disabled', () => {
  const state = {
    ...appState(null),
    autoStartFavoriteGames: false,
    automationActivity: [
      {
        id: 'queue-cleanup:expired:campaign:closed-campaign',
        kind: 'queue-campaigns-removed',
        at: Date.now(),
        message: 'Removed 1 expired campaign from the queue: Closed Campaign.',
      },
    ],
  } satisfies AppState;

  const markup = renderMainView(state);

  expect(markup).toContain('aria-label="Queue campaign update"');
  expect(markup).toContain('<summary');
  expect(markup).toContain('>Queue updated</summary>');
  expect(markup).toContain('Closed Campaign');
  expect(markup).toContain('aria-label="Dismiss queue update"');
});

test('a dismissed queue cleanup stays hidden until a new update arrives', () => {
  // Given
  const dismissedActivity = {
    id: 'queue-cleanup:expired:campaign:closed-campaign',
    kind: 'queue-campaigns-removed' as const,
    at: Date.now(),
    message: 'Removed Closed Campaign.',
  };
  const dismissedState = {
    ...appState(null),
    automationActivity: [dismissedActivity],
  } satisfies AppState;
  const dismissedOverrides = {
    runtimeMode: 'idle' as const,
    dismissedQueueCleanupActivityId: dismissedActivity.id,
    onDismissQueueCleanup: () => {},
  };

  // When
  const dismissedMarkup = renderMainView(dismissedState, [], dismissedOverrides);
  const newerMarkup = renderMainView(
    {
      ...dismissedState,
      automationActivity: [
        {
          ...dismissedActivity,
          id: 'queue-cleanup:expired:campaign:newly-closed-campaign',
          message: 'Removed Newly Closed Campaign.',
        },
      ],
    },
    [],
    dismissedOverrides,
  );

  // Then
  expect(dismissedMarkup).not.toContain('aria-label="Queue campaign update"');
  expect(newerMarkup).toContain('aria-label="Queue campaign update"');
  expect(newerMarkup).toContain('Newly Closed Campaign');
});

test('unverified recovery does not show the fresh-campaign success banner', () => {
  const state = {
    ...appState(game()),
    twitchSessionDetected: false,
    campaignSyncState: {
      status: 'needs-session',
      lastAttemptAt: Date.now(),
      lastSuccessAt: null,
      campaignCount: 1,
      retryAttemptCount: 1,
      lastErrorKind: 'session',
      nextRetryAt: null,
      attemptDeadlineAt: null,
    },
  } satisfies AppState;

  const markup = renderMainView(state, [], {
    campaignSyncStatus: 'pending-validation',
    firstSyncConfirmation: true,
    firstSyncCampaignCount: 3,
  });

  expect(markup).not.toContain('3 campaigns loaded.');
});
