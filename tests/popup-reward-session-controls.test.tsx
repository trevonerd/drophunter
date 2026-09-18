import { expect, test } from 'bun:test';
import type { AppState } from '../src/types';
import { appState, game, renderMainView } from './fixtures/popup-reward';

test('automation summary owns policy and does not duplicate session or queue state', () => {
  const stoppedCampaign = game({ campaignName: 'Stopped Campaign' });
  const nextCampaign = game({
    id: 'next-game',
    name: 'Next Game',
    campaignId: 'next-campaign',
    campaignName: 'Next Campaign',
  });

  const stoppedMarkup = renderMainView(appState(stoppedCampaign), [nextCampaign]);
  const runningMarkup = renderMainView(
    { ...appState(stoppedCampaign), isRunning: true },
    [stoppedCampaign, nextCampaign],
  );

  const stoppedAutomation =
    stoppedMarkup.match(/<section[^>]*aria-labelledby="automation-summary-heading"[\s\S]*?<\/section>/)?.[0] ?? '';
  expect(stoppedAutomation).toContain('Favorite auto-start');
  expect(stoppedAutomation).toContain('role="switch"');
  expect(stoppedAutomation).not.toContain('data-automation-slot');
  expect(stoppedAutomation).not.toContain('Next Game · Next Campaign');
  expect(
    runningMarkup.match(/<section[^>]*aria-labelledby="automation-summary-heading"[\s\S]*?<\/section>/)?.[0],
  ).not.toContain(
    'Example Game · Stopped Campaign',
  );
});

test('automation summary hides transport diagnostics from the main interface', () => {
  const selected = game();
  const state = {
    ...appState(selected),
    isRunning: true,
    watchTransportPreference: 'tabless' as const,
    watchTransportMode: 'tabless' as const,
    watchHealth: {
      mode: 'tabless' as const,
      isHealthy: true,
      status: 'healthy' as const,
      reason: 'heartbeat' as const,
      consecutiveFailures: 0,
      consecutiveStalls: 0,
      progress: 42,
      shouldFallback: false,
      checkedAt: 1,
    },
  };

  const markup = renderMainView(state);

  expect(markup).not.toContain('data-watch-transport-status');
  expect(markup).not.toContain('Tabless heartbeat');
  expect(markup).not.toContain('Healthy');
});

test('paused or stopped session keeps favorite auto-start state clear to the user', () => {
  const selected = game();
  const markup = renderMainView(
    {
      ...appState(selected),
      isRunning: true,
      isPaused: true,
      autoStartFavoriteGames: true,
    },
    [selected],
    { runtimeMode: 'paused' },
  );

  expect(markup).toContain('Favorite auto-start can restart farming after Pause or Stop.');
  expect(markup).toContain('Turn it off to keep farming stopped.');
  expect(markup).toContain('aria-describedby="session-auto-start-note"');
  expect(markup).not.toContain('class="dh-running-badge"');
});

test('paused manual queue promises continuation only after Resume', () => {
  const selected = game();
  const markup = renderMainView(
    {
      ...appState(selected),
      isRunning: true,
      isPaused: true,
      manualQueueAuthorized: true,
      queue: [selected],
    },
    [selected],
    { runtimeMode: 'paused' },
  );

  expect(markup).toContain('The started queue is saved and will continue after Resume.');
  expect(markup).not.toContain('The started queue will continue automatically');
  expect(markup).not.toContain('session-auto-start-note');
});

test('no-streamer recovery omits redundant queue continuation copy', () => {
  const selected = game();
  const next = game({
    id: 'next-game',
    name: 'Next Game',
    campaignId: 'next-campaign',
    campaignName: 'Next Campaign',
  });
  const markup = renderMainView(
    {
      ...appState(selected),
      isRunning: true,
      autoStartFavoriteGames: true,
      manualQueueAuthorized: true,
      farmingSessionOrigin: 'manual',
      queue: [selected, next],
      recoveryReason: 'no-streamers',
      recoveryAttempts: 1,
      recoveryBackoffUntil: 60_000,
      watchTransportPreference: 'tabless',
      watchTransportMode: 'managed-tab',
      activeStreamer: {
        id: 'stale-streamer-id',
        name: 'stale-streamer',
        displayName: 'Stale Streamer',
        isLive: false,
      },
      tabId: 42,
    },
    [next],
    { runtimeMode: 'recovering', recoveryNow: 1 },
  );

  expect(markup).toContain('No eligible streamer yet · retry in 1m');
  expect(markup).not.toContain('The started queue will continue automatically');
  expect(markup).not.toContain('data-watch-transport=');
  expect(markup).not.toContain('Fallback tab');
  expect(markup).toContain('Turn it off to keep farming stopped.');
});

test('session summary exposes exactly one effective transport indicator', () => {
  const selected = game();
  const base = {
    ...appState(selected),
    isRunning: true,
    activeStreamer: {
      id: 'streamer-id',
      name: 'streamer',
      displayName: 'Streamer',
      isLive: true,
    },
  } satisfies AppState;

  const hiddenMarkup = renderMainView(
    {
      ...base,
      watchTransportMode: 'tabless',
      manualWatchState: 'inactive',
    },
    [],
    { runtimeMode: 'running' },
  );
  const hiddenSummary = hiddenMarkup.match(/<section[^>]*data-session-mode="running"[\s\S]*?<\/section>/)?.[0] ?? '';
  expect(hiddenSummary).toContain('data-watch-transport="hidden"');
  expect(hiddenSummary).toContain('>Hidden<');
  expect(hiddenSummary).toContain('<svg');
  expect(hiddenSummary.match(/>Hidden</g)).toHaveLength(1);

  const tabMarkup = renderMainView(
    {
      ...base,
      watchTransportMode: 'managed-tab',
      manualWatchState: 'inactive',
    },
    [],
    { runtimeMode: 'running' },
  );
  const tabSummary = tabMarkup.match(/<section[^>]*data-session-mode="running"[\s\S]*?<\/section>/)?.[0] ?? '';
  expect(tabSummary).toContain('data-watch-transport="tab"');
  expect(tabSummary).toContain('>Tab<');
  expect(tabSummary.match(/>Tab</g)).toHaveLength(1);

  const fallbackMarkup = renderMainView(
    {
      ...base,
      watchTransportPreference: 'tabless',
      watchTransportMode: 'managed-tab',
      manualWatchState: 'inactive',
    },
    [],
    { runtimeMode: 'running' },
  );
  const fallbackSummary =
    fallbackMarkup.match(/<section[^>]*data-session-mode="running"[\s\S]*?<\/section>/)?.[0] ?? '';
  expect(fallbackSummary).toContain('data-watch-transport="tab"');
  expect(fallbackSummary).toContain('>Tab<');
  expect(fallbackSummary).not.toContain('Fallback tab');
  expect(fallbackSummary).not.toContain('heartbeat');

  const manualMarkup = renderMainView(
    {
      ...base,
      watchTransportMode: 'managed-tab',
      manualWatchState: 'automation-paused',
    },
    [],
    { runtimeMode: 'running' },
  );
  const manualSummary =
    manualMarkup.match(/<section[^>]*data-session-mode="running"[\s\S]*?<\/section>/)?.[0] ?? '';
  expect(manualSummary).toContain('data-watch-transport="manual-tab"');
  expect(manualSummary).toContain('>Manual tab<');
  expect(manualSummary.match(/>Manual tab</g)).toHaveLength(1);
  expect(manualSummary).not.toContain('Tabless heartbeat');
  expect(manualSummary).not.toContain('Healthy');
});

test('non-blocking session retry never exposes Twitch recovery controls', () => {
  const selected = game();
  const authRecoveryMarkup = renderMainView(
    {
      ...appState(selected),
      isRunning: true,
      twitchSessionSyncState: { status: 'retrying', attempts: 1, nextRetryAt: 60_000 },
    },
    [],
    { runtimeMode: 'running', recoveryNow: 1 },
  );
  const otherRecoveryMarkup = renderMainView(
    {
      ...appState(selected),
      isRunning: true,
      recoveryReason: 'no-streamers',
      recoveryAttempts: 1,
      recoveryBackoffUntil: 60_000,
    },
    [],
    { runtimeMode: 'recovering', recoveryNow: 1 },
  );

  expect(authRecoveryMarkup).not.toContain('Open Twitch Drops</button>');
  expect(authRecoveryMarkup).toContain('Pause</button>');
  expect(authRecoveryMarkup).toContain('Stop</button>');
  expect(otherRecoveryMarkup).not.toContain('Open Twitch Drops</button>');
});
