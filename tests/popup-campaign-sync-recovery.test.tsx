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
        attemptDeadlineAt: null,
        retryAttemptCount: 0,
        lastErrorKind: null,
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
        attemptDeadlineAt: null,
        retryAttemptCount: 1,
        lastErrorKind: 'network',
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

test('a closed Twitch tab keeps saved campaigns pending validation without a manual retry action', () => {
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
      retryAttemptCount: 0,
      lastErrorKind: 'network' as const,
      attemptDeadlineAt: null,
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
  expect(markup).not.toContain('>Retry</button>');
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

test('a retry scheduling failure remains understandable without a retry action', () => {
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
  expect(markup).not.toContain('>Retry</button>');
  expect(markup).toContain('data-session-mode="pending-validation"');
});

test('campaign warnings remain visible with favorite auto-start disabled', () => {
  const campaign = game({ campaignName: 'Problem Campaign' });
  const state = appState(null);
  state.autoStartFavoriteGames = false;
  state.campaignFailureEpisodesByKey = { 'campaign:problem': {
    id: 'failure:problem', game: campaign, reason: 'stalled-progress',
    startedAt: 1, lastAttemptAt: 1, visible: true,
  } };
  const markup = renderMainView(state);
  expect(markup).toContain('aria-label="Farming messages"');
  expect(markup).toContain('<summary');
  expect(markup).toContain('Campaign warnings (1)');
  expect(markup).toContain('Problem Campaign');
  expect(markup).toContain('aria-label="Dismiss farming message"');
});

test('persisted dismissal hides its episode without hiding a new campaign failure', () => {
  const campaign = game({ campaignName: 'Problem Campaign' });
  const state = appState(null);
  const episode = { id: 'failure:problem', game: campaign, reason: 'stalled-progress',
    startedAt: 1, lastAttemptAt: 1, visible: true };
  state.campaignFailureEpisodesByKey = { 'campaign:problem': episode };
  state.dismissedFarmingMessageIds = [episode.id];
  expect(renderMainView(state)).not.toContain('aria-label="Farming messages"');
  state.campaignFailureEpisodesByKey['campaign:new'] = { ...episode, id: 'failure:new',
    game: { ...campaign, campaignId: 'new', campaignName: 'New Problem' } };
  const markup = renderMainView(state);
  expect(markup).toContain('Campaign warnings (1)');
  expect(markup).toContain('New Problem');
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
