import { expect, test } from 'bun:test';
import { deriveCampaignSyncStatus } from '../src/popup/constants';
import type { AppState } from '../src/types';
import { appState, game, renderMainView } from './fixtures/popup-reward';

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

test('repeated recovery attempts replace raw errors with a clear recovery state', () => {
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

  expect(markup).toContain('Campaign validation has not recovered after several retries.');
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
