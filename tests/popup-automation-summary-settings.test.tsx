import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AutomationSummary } from '../src/popup/components/AutomationSummary';
import { SettingsView } from '../src/popup/components/SettingsView';
import { createInitialState } from '../src/shared/utils';

test('automation shows one recent event only while enabled and never renders an activity feed', () => {
  const recentActivity = {
    id: 'auto-started:campaign-1',
    kind: 'auto-started' as const,
    at: Date.now(),
    campaignId: 'campaign-1',
    message: 'Cyberpunk 2077 started automatically.',
  };
  const enabledState = {
    ...createInitialState(),
    twitchSessionDetected: true,
    autoStartFavoriteGames: true,
    automationActivity: [recentActivity],
  };
  const enabledMarkup = renderToStaticMarkup(
    <AutomationSummary state={enabledState} notificationPermissionDenied={false} onToggle={() => {}} />,
  );
  const disabledMarkup = renderToStaticMarkup(
    <AutomationSummary
      state={{ ...enabledState, autoStartFavoriteGames: false }}
      notificationPermissionDenied={false}
      onToggle={() => {}}
    />,
  );
  const permissionDeniedMarkup = renderToStaticMarkup(
    <AutomationSummary
      state={{ ...enabledState, autoStartFavoriteGames: false }}
      notificationPermissionDenied
      onToggle={() => {}}
    />,
  );

  expect(enabledMarkup).toContain('Favorite auto-start');
  expect(enabledMarkup).toContain('role="switch"');
  expect(enabledMarkup).toContain('aria-checked="true"');
  expect(enabledMarkup).toContain('Cyberpunk 2077 started automatically.');
  expect(enabledMarkup).not.toContain('>Activity<');
  expect(enabledMarkup).not.toContain('>Now<');
  expect(enabledMarkup).not.toContain('>Next<');
  expect(disabledMarkup).not.toContain('Cyberpunk 2077 started automatically.');
  expect(disabledMarkup).toContain('>Off<');
  expect(permissionDeniedMarkup).toContain('Notifications are required to turn on favorite auto-start.');
  expect(permissionDeniedMarkup).toContain('role="status"');
});

test('settings exposes farming automation controls and the resumed-session wording', () => {
  const state = {
    ...createInitialState(),
    campaignPriorityMode: 'ending-soonest' as const,
    farmCategoryScope: 'favorites-only' as const,
  };
  const markup = renderToStaticMarkup(
    <SettingsView
      state={state}
      onBack={() => {}}
      onOpenClaimLog={() => {}}
      onMonitorAutoOpenToggle={() => {}}
      onMuteFarmingTabToggle={() => {}}
      onNotificationsEnabledToggle={() => {}}
      onTelegramAlertsToggle={async () => undefined}
      onSaveTelegramCredentials={async () => undefined}
      onTestTelegramAlerts={async () => undefined}
      onLoadTelegramSettings={async () => undefined}
      onAutoResumeOnStartupToggle={() => {}}
      onAutoClaimChannelPointsBonusToggle={() => {}}
      onAutoClaimDropsToggle={() => {}}
      onStreamerSelectionModeChange={() => {}}
      onPreferredStreamerLanguageChange={() => {}}
      onFarmCategoryScopeChange={() => {}}
      onWatchTransportModeChange={() => {}}
    />,
  );

  expect(markup).toContain('Farming automation');
  expect(markup).toContain('Campaign scope');
  expect(markup).not.toContain('Campaign priority');
  expect(markup).not.toContain('Auto-start favorite games');
  expect(markup).not.toContain('Favorite games (');
  expect(markup).toContain('Watch source');
  expect(markup).toContain('No stream tab (preferred)');
  expect(markup).toContain('Managed background tab');
  expect(markup).toContain('Resume interrupted session');
  expect(markup).toContain('Resume a farming session that was already running before the browser stopped.');
});
