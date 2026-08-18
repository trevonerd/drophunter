import { expect, test } from 'bun:test';
import { deriveCampaignSyncStatus } from '../src/popup/constants';
import type { AppState } from '../src/types';
import { appState, drop, game, renderMainView } from './fixtures/popup-reward';

test('signed-out popup gates farming controls and preserves a read-only saved queue summary', () => {
  const savedCampaign = game({ campaignId: 'saved-campaign' });
  const state = {
    ...appState(null),
    twitchSessionDetected: false,
    queue: [savedCampaign],
    lastStopReason: 'queue-complete',
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

test('signed-out sync status outranks cached campaigns and refresh activity', () => {
  const base = {
    activeSyncError: null,
    gamesLoading: false,
    availableCampaignCount: 1,
    twitchSessionDetected: false,
    isStale: false,
  };

  expect(deriveCampaignSyncStatus({ ...base, dropsRefreshLoading: false })).toBe('signed-out');
  expect(deriveCampaignSyncStatus({ ...base, dropsRefreshLoading: true })).toBe('signed-out');
  expect(
    deriveCampaignSyncStatus({
      ...base,
      dropsRefreshLoading: false,
      twitchSessionDetected: true,
      isStale: true,
    }),
  ).toBe('syncing');
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

