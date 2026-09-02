import { expect, test } from 'bun:test';
import { deriveCampaignSyncStatus } from '../src/popup/constants';
import type { AppState } from '../src/types';
import { appState, drop, game, renderMainView } from './fixtures/popup-reward';

test('confirmed invalid OAuth gates farming controls and preserves a read-only saved queue summary', () => {
  const savedCampaign = game({ campaignId: 'saved-campaign' });
  const state = {
    ...appState(null),
    twitchSessionDetected: false,
    twitchSessionSyncState: { status: 'blocked', attempts: 1, nextRetryAt: null },
    queue: [savedCampaign],
    lastStopReason: 'sign-in-required',
  } satisfies AppState;

  const markup = renderMainView(state, [savedCampaign], { campaignSyncStatus: 'signed-out' });

  expect(markup).toContain('data-session-priority="twitch-required"');
  expect(markup).toContain('data-saved-queue-count="1"');
  expect(markup).not.toContain('<select');
  expect(markup).not.toContain('aria-label="Add selected campaign to queue"');
  expect(markup).not.toContain('>Start Farming<');
  expect(markup).not.toContain('>Start Queue');
  expect(markup).not.toContain('aria-label="Campaigns"');
  expect(markup).toContain('Your queue is saved (1 campaign).');
  expect(markup).toContain('aria-label="Open live monitor"');
  expect(markup).toContain('aria-label="Open settings"');
  expect(markup).not.toContain('aria-label="Mute stream audio"');
  expect(markup).not.toContain('aria-label="Enable notifications"');
});

test('Twitch gate is reserved for confirmed terminal authentication blockage', () => {
  const base = {
    activeSyncError: null,
    gamesLoading: false,
    availableCampaignCount: 0,
    twitchSessionDetected: false,
    isStale: false,
  };

  expect(deriveCampaignSyncStatus({ ...base, dropsRefreshLoading: false })).toBe('syncing');
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
  ).toBe('fresh');
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
  ).toBe('syncing');
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

test('a missing cached session stays neutral and never exposes Open Twitch', () => {
  const savedCampaign = game({ campaignId: 'saved-campaign' });
  const state = {
    ...appState(null),
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

  const markup = renderMainView(state, [savedCampaign], { campaignSyncStatus: 'syncing' });

  expect(markup).toContain('Updating campaigns…');
  expect(markup).not.toContain('data-session-priority="twitch-required"');
  expect(markup).not.toContain('Open Twitch');
  expect(markup).not.toContain('offline');
});

test('blocked Twitch state renders a single recovery gate even with cached campaigns', () => {
  const savedCampaign = game({ campaignId: 'saved-campaign' });
  const state = {
    ...appState(savedCampaign),
    twitchSessionDetected: true,
    twitchSessionSyncState: { status: 'blocked', attempts: 2, nextRetryAt: null },
    lastStopReason: 'sign-in-required',
    queue: [savedCampaign],
  } satisfies AppState;

  const markup = renderMainView(state, [savedCampaign], { campaignSyncStatus: 'signed-out' });

  expect(markup).toContain('data-session-priority="twitch-required"');
  expect(markup.match(/Open Twitch/g)).toHaveLength(1);
  expect(markup).not.toContain('data-session-mode="recovering"');
});

test('the persistent session summary maps runtime states to one operational mode', () => {
  const selectedGame = game();
  const idleMarkup = renderMainView(appState(selectedGame));
  const runningState = {
    ...appState(selectedGame),
    isRunning: true,
    currentDrop: drop({ status: 'active', progress: 42, remainingMinutes: 18 }),
  } satisfies AppState;
  const runningMarkup = renderMainView(runningState, [], { runtimeMode: 'running' });
  const pausedMarkup = renderMainView({ ...runningState, isPaused: true }, [], { runtimeMode: 'paused' });
  const recoveryMarkup = renderMainView(
    { ...runningState, recoveryReason: 'offline', recoveryAttempts: 1 },
    [],
    { runtimeMode: 'recovering' },
  );
  const completeMarkup = renderMainView(
    { ...appState(selectedGame), lastStopReason: 'queue-complete' },
    [],
    { runtimeMode: 'stopped-terminal' },
  );

  expect(idleMarkup).toContain('data-session-mode="ready"');
  expect(runningMarkup).toContain('data-session-mode="running"');
  expect(runningMarkup).toContain('data-progress-state="tracking"');
  const runningSummary = runningMarkup.match(/<section[^>]*data-session-mode="running"[\s\S]*?<\/section>/)?.[0];
  expect(runningSummary).toContain('role="progressbar"');
  expect(runningSummary).toContain('aria-valuenow="42"');
  expect(runningSummary).toContain('· 42%');
  expect(runningSummary).toContain('· ETA 18m');
  expect(runningSummary).not.toContain('Tracking progress');
  expect(runningSummary).not.toContain('queue advances');
  expect(pausedMarkup).toContain('data-session-mode="paused"');
  expect(pausedMarkup).toContain('data-progress-state="paused"');
  expect(recoveryMarkup).toContain('data-session-mode="recovering"');
  expect(recoveryMarkup).toContain('data-progress-state="recovering"');
  expect(completeMarkup).toContain('data-session-mode="complete"');
});

test('non-blocking Twitch retries keep cached Hidden farming linear and silent', () => {
  const selectedGame = game({ campaignId: 'fragpunk-campaign' });
  const state = {
    ...appState(selectedGame),
    isRunning: true,
    watchTransportPreference: 'tabless',
    watchTransportMode: 'tabless',
    twitchSessionSyncState: { status: 'retrying', attempts: 3, nextRetryAt: Date.now() + 30_000 },
    resumedFromCrash: Date.now(),
    currentDrop: drop({ status: 'active', progress: 42 }),
  } satisfies AppState;

  const markup = renderMainView(state, [selectedGame], { runtimeMode: 'running' });

  expect(markup).toContain('data-session-mode="running"');
  expect(markup).toContain('Hidden');
  expect(markup).toContain('>Pause<');
  expect(markup).toContain('>Stop<');
  expect(markup).not.toContain('Recovering');
  expect(markup).not.toContain('retry in');
  expect(markup).not.toContain('Resumed after a browser interruption');
  expect(markup).not.toContain('Open Twitch');
});

test('popup landmarks keep global header actions and session owns farming controls', () => {
  const selectedGame = game();
  const idleMarkup = renderMainView(appState(selectedGame));
  const runningState = {
    ...appState(selectedGame),
    isRunning: true,
    watchTransportMode: 'managed-tab',
    tabId: 17,
  } satisfies AppState;
  const runningMarkup = renderMainView(runningState, [], { runtimeMode: 'running' });
  const idleHeader = idleMarkup.match(/<header[\s\S]*?<\/header>/)?.[0] ?? '';
  const runningHeader = runningMarkup.match(/<header[\s\S]*?<\/header>/)?.[0] ?? '';

  expect(idleMarkup).toContain('<header');
  expect(idleMarkup).toContain('<main');
  expect(idleHeader).toContain('aria-label="Open live monitor"');
  expect(idleHeader).toContain('aria-label="Open settings"');
  expect(idleHeader).not.toContain('aria-label="Mute stream audio"');
  expect(idleHeader).not.toContain('aria-label="Open Twitch Drops"');
  expect(idleHeader).not.toContain('aria-label="Enable notifications"');
  expect(runningHeader).not.toContain('Pause farming');
  expect(runningHeader).not.toContain('Stop farming');
  expect(runningHeader).toContain('aria-label="Turn stream audio on"');
  expect(runningHeader).toContain('aria-label="Open live monitor"');
  expect(runningHeader).toContain('aria-label="Open settings"');
  const runningSummary = runningMarkup.match(/<section[^>]*data-session-mode="running"[\s\S]*?<\/section>/)?.[0];
  expect(runningSummary).toContain('>Pause<');
  expect(runningSummary).toContain('>Stop<');
  expect(runningMarkup).not.toContain('Select a campaign to start');
  expect(runningMarkup).toContain('aria-label="Sort games"');
  expect(runningMarkup).toContain('aria-label="Filter games"');
});
