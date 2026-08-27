import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readPopupSource } from '../popup-source-fixture.ts';

const repoRoot = resolve(import.meta.dir, '../..');

test('popup loads onboardingCompleted from chrome.storage.local on mount', () => {
  const source = readPopupSource();

  expect(source).toContain("browser.storage.local.get('onboardingCompleted')");
  expect(source).toContain('stored.onboardingCompleted === true');
});

test('popup advances onboarding after a campaign is added to the queue', () => {
  const source = readPopupSource();

  expect(source).toContain("if (onboardingStep === 'selector') setOnboardingStep('start');");
  expect(source).toContain("if (added > 0 && onboardingStep === 'selector') setOnboardingStep('start');");
});

test('popup header keeps global utilities while session controls stay in SessionSummary', () => {
  const source = readPopupSource();
  const headerSource = readFileSync(join(repoRoot, 'src/popup/components/PopupHeader.tsx'), 'utf-8');

  expect(headerSource).toContain('const iconButtonClass =');
  expect(headerSource).toContain('dh-icon-button shrink-0');
  expect(headerSource).toContain('{hasManagedFarmingTab && (');
  expect(headerSource).not.toContain('PauseIcon');
  expect(headerSource).not.toContain('StopIcon');
  expect(headerSource).not.toContain('dh-runtime-badge');
  expect(source).toContain('onClick={props.onPause}');
  expect(source).toContain('onClick={props.onStop}');
});

test('running session uses the stronger border without a glow', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/components/SessionSummary.tsx'), 'utf-8');

  expect(source).toContain("isRunning ? 'dh-panel-strong'");
  expect(source).not.toContain('shadow');
});

test('native popup prefers 400px without clipping at browser zoom', () => {
  const css = readFileSync(join(repoRoot, 'src/popup/index.css'), 'utf-8');
  const source = readPopupSource();

  expect(css).toContain('width: 400px;');
  expect(css).toContain('max-width: 100%;');
  expect(css).not.toContain('width: min(400px, calc(100vw - 6px));');
  expect(source).toContain('dh-view w-full max-w-[400px]');
  expect(css).toContain('@media (max-width: 280px)');
  expect(css).toContain('grid-template-columns: minmax(0, 1fr);');
  expect(css).toContain('.dh-drop-card-header');
  expect(css).toContain('flex-direction: column;');
});

test('popup keeps Twitch Drops access contextual instead of placing it in the header toolbar', () => {
  const source = readPopupSource();

  const headerSource = readFileSync(join(repoRoot, 'src/popup/components/PopupHeader.tsx'), 'utf-8');
  const syncPanelSource = readFileSync(join(repoRoot, 'src/popup/components/CampaignSyncPanel.tsx'), 'utf-8');

  expect(headerSource).not.toContain('DropsIcon');
  expect(headerSource).not.toContain('BellIcon');
  expect(syncPanelSource).toContain('DropsIcon');
  expect(source).not.toContain('Refreshing Twitch Drops');
});

test('popup opens Twitch Drops in the foreground from contextual Drops actions', () => {
  const source = readPopupSource();

  expect(source).toContain('onOpenDropsPage={() => void openDropsPage()}');
  expect(source).toContain("type: 'OPEN_DROPS_AND_SYNC'");
  expect(source).not.toContain('active: false');
});

test('popup activation checks campaign state without opening Twitch', () => {
  const source = readPopupSource();

  expect(source).toContain("sendRuntimeMessage({ type: 'ACTIVATE_POPUP' })");
  expect(source).not.toContain('autoRefreshAttemptedFor');
  expect(source).not.toContain('void openDropsPage({ active: false })');
});

test('popup does not mount reward loading UI just because Drops refresh is running', () => {
  const source = readPopupSource();

  expect(source).toContain('drops={catalogDrops}');
  expect(source).not.toContain('rewardsLoading={rewardsLoading}');
});

test('popup shows stale warning for idle cached campaigns', () => {
  const source = readPopupSource();

  const isStaleMatch = source.match(/const isStale\s*=\s*\n\s*([\s\S]*?)\s*STALE_THRESHOLD_MS;/);
  expect(isStaleMatch).toBeTruthy();
  if (isStaleMatch) {
    expect(isStaleMatch[1]).toContain('!state.isRunning');
    expect(isStaleMatch[1]).toContain('state.availableGames.length > 0');
    expect(isStaleMatch[1]).not.toMatch(/(^|\s)state\.isRunning\s*&&/);
  }
  expect(source).toContain('const campaignSyncStatus = deriveCampaignSyncStatus({');
  expect(source).toContain('isStale,');
});

test('popup onboardingCompleted stays out of PopupHeader progressive disclosure props', () => {
  const source = readPopupSource();

  expect(source).not.toContain('onboardingCompleted: boolean;');
  expect(source).not.toContain('onboardingCompleted={onboardingCompleted}');
});

test('popup onboarding step state tracks selector and start modes', () => {
  const source = readPopupSource();

  expect(source).toContain("useState<'selector' | 'start' | null>(null)");
});

test('popup CSS defines pulse-glow animation for onboarding highlights', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/index.css'), 'utf-8');

  expect(source).toContain('@keyframes pulse-glow');
  expect(source).toContain('.onboarding-pulse');
  expect(source).not.toContain('header-control-hidden');
  expect(source).not.toContain('header-control-visible');
});

test('popup has drop & campaign log view wired into the view switcher', () => {
  const source = readPopupSource();

  expect(source).toContain("'main' | 'settings' | 'log'");
  expect(source).toContain('function ClaimLogView');
  expect(source).toContain("activeView === 'log'");
  expect(source).toContain("setActiveView('log')");
  expect(source).toContain("setActiveView('settings')");
});

test('popup claim log view uses virtualized list with absolute positioning', () => {
  const source = readPopupSource();

  expect(source).toContain('useVirtualRows');
  expect(source).toContain("position: 'relative'");
  expect(source).toContain("position: 'absolute'");
  expect(source).toContain('totalHeight');
});

test('popup claim log view sends GET_CLAIM_LOG and CLEAR_CLAIM_LOG messages', () => {
  const source = readPopupSource();

  expect(source).toContain("type: 'GET_CLAIM_LOG'");
  expect(source).toContain("type: 'CLEAR_CLAIM_LOG'");
});

test('popup settings statistics panel has claim log icon button', () => {
  const source = readPopupSource();

  expect(source).toContain('aria-label="View drop claim log"');
  expect(source).toContain('HistoryIcon');
  expect(source).toContain('onOpenClaimLog');
});

test('popup claim log view has accessible empty state', () => {
  const source = readPopupSource();

  expect(source).toContain('No drops claimed yet.');
  expect(source).toContain('Claimed drops will appear here.');
  expect(source).toContain('aria-label="Claimed drops by campaign"');
  expect(source).toContain("listStyle: 'none'");
});

test('popup claim log entry row shows drop image with initials fallback', () => {
  const source = readPopupSource();

  expect(source).toContain('RewardThumb');
  expect(source).toContain('entry.imageUrl');
  expect(source).toContain('onError');
});

test('SubIcon uses the compact currentColor payment-card SVG conventions', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/components/icons.tsx'), 'utf-8');

  expect(source).toContain('export function SubIcon()');
  expect(source).toContain('data-subscription-icon="payment-card"');
  expect(source).toContain(
    '<rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="2" />',
  );
  expect(source).toContain('<path d="M3 9h18" stroke="currentColor" strokeWidth="2" />');
});
