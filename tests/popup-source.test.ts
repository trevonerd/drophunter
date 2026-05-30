import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '..');

test('popup keeps the account-link lock indicator in the game selector', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain("game.isConnected === false ? '\\u{1F512} ' : ''");
});

test('popup does not duplicate refresh loading state under the game selector', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).not.toContain("setQueueMessage('Refreshing campaigns from Twitch...')");
});

test('popup applies returned app state after drops page refresh', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain('response?.appState ??');
  expect(source).not.toContain('prev.dropsPageRefreshInProgress ? { ...prev, dropsPageRefreshInProgress: false }');
});

test('popup clears game switch state in handleGameSelect', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain('const handleGameSelect = async (gameId: string) => {');
  expect(source).toContain('selectedGame: selected,');
  expect(source).toContain('pendingDrops: [],');
  expect(source).toContain('completedDrops: [],');
  expect(source).toContain('currentDrop: null,');
  expect(source).toContain('completionNotified: false,');
});

test('popup uses a single campaign sync panel for empty, stale, syncing, failed, and fresh states', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain("type CampaignSyncStatus = 'empty' | 'fresh' | 'stale' | 'syncing' | 'failed'");
  expect(source).toContain('function CampaignSyncPanel');
  expect(source).toContain('aria-live="polite"');
  expect(source).toContain('Opening Twitch Drops and updating campaigns…');
  expect(source).toContain('Could not update. Old data is still shown.');
});

test('popup splits the main campaign UI into focused components', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain('function PopupHeader');
  expect(source).toContain('function CampaignSelector');
  expect(source).toContain('function QueueChips');
  expect(source).toContain('function RewardList');
});

test('popup async copy uses ellipsis glyphs instead of three-dot loading text', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).not.toContain('Loading...');
  expect(source).not.toContain('Refreshing...');
  expect(source).not.toContain('Starting...');
  expect(source).toContain('Loading…');
  expect(source).toContain('Refreshing…');
  expect(source).toContain('Starting…');
});

test('popup exposes a quick audio toggle for the farming tab', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain('Turn stream audio on');
  expect(source).toContain('Mute stream audio');
  expect(source).toContain('handleMuteFarmingTabToggle');
  expect(source).toContain('<SpeakerIcon muted={state.muteFarmingTab} />');
});

test('popup campaign selector uses improved placeholder text', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain('<option value="">Select a game to start</option>');
  expect(source).not.toContain('<option value="">Select a campaign…</option>');
});

test('popup renders first-sync confirmation banner with campaign count', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain('{firstSyncConfirmation &&');
  expect(source).toContain('campaigns loaded — select a game below and press Start');
  expect(source).toContain('state.availableGames.length');
});

test('popup auto-dismisses first-sync confirmation after 30 seconds', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain('setFirstSyncConfirmation(false), 30000');
});

test('popup applies onboarding-pulse class to campaign selector when step is selector', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain("onboardingStep === 'selector' ? 'onboarding-pulse' : ''");
});

test('popup applies onboarding-pulse class to start button when step is start', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain("onboardingStep === 'start' ? 'onboarding-pulse' : ''");
});

test('popup saves onboardingCompleted to chrome.storage.local after first start', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain("await browser.storage.local.set({ onboardingCompleted: true })");
  expect(source).toContain('setOnboardingStep(null)');
  expect(source).toContain('setOnboardingCompleted(true)');
});

test('popup loads onboardingCompleted from chrome.storage.local on mount', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain("browser.storage.local.get('onboardingCompleted')");
  expect(source).toContain('stored.onboardingCompleted === true');
});

test('popup advances onboarding step on game select', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain("setFirstSyncConfirmation(false)");
  expect(source).toContain("onboardingStep === 'selector'");
  expect(source).toContain("setOnboardingStep('start')");
});

test('popup uses header-control-hidden class for progressive disclosure', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain('header-control-hidden');
  expect(source).toContain('header-control-visible');
});

test('popup conditionally hides mute and monitor in header', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain('onboardingCompleted || state.isRunning ? \'header-control-visible\' : \'header-control-hidden\'');
  expect(source).toContain('onboardingCompleted={onboardingCompleted}');
});

test('popup shows stale warning for idle cached campaigns', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  const isStaleMatch = source.match(/const isStale\s*=\s*\n\s*([\s\S]*?)\s*STALE_THRESHOLD_MS;/);
  expect(isStaleMatch).toBeTruthy();
  if (isStaleMatch) {
    expect(isStaleMatch[1]).toContain('!state.isRunning');
    expect(isStaleMatch[1]).toContain('state.availableGames.length > 0');
    expect(isStaleMatch[1]).not.toMatch(/(^|\s)state\.isRunning\s*&&/);
  }
});

test('popup onboardingCompleted passed to PopupHeader prop interface', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain('onboardingCompleted: boolean;');
});

test('popup onboarding step state tracks selector and start modes', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain("useState<'selector' | 'start' | null>(null)");
});

test('popup CSS defines pulse-glow animation for onboarding highlights', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/index.css'), 'utf-8');

  expect(source).toContain('@keyframes pulse-glow');
  expect(source).toContain('.onboarding-pulse');
  expect(source).toContain('header-control-hidden');
  expect(source).toContain('header-control-visible');
});
