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

test('popup treats Drops page refresh response as an async launch acknowledgement', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain('const active = options.active !== false;');
  expect(source).toContain('payload: { waitForRefresh: false, active }');
  expect(source).toContain('lastDropsPageRefreshError: null');
  expect(source).toContain('lastDropsPageRefreshAttemptAt: attemptAt');
  expect(source).not.toContain('response?.appState ??');
  expect(source).not.toContain('prev.dropsPageRefreshInProgress ? { ...prev, dropsPageRefreshInProgress: false }');
});

test('popup does not silently refresh campaigns on mount', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).not.toContain('ENSURE_GAMES_CACHE');
  expect(source).not.toContain('fetchAvailableGames');
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
  expect(source).toContain('Go to Twitch Drops');
  expect(source).toContain('Updating Twitch Drops and campaigns…');
  expect(source).toContain('Not synced yet');
  expect(source).toContain('Could not update. Old data is still shown.');
  expect(source).toContain('Could not update yet. No campaign data is shown.');
  expect(source).toContain('hasCachedCampaigns={state.availableGames.length > 0}');
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

  expect(source).toContain('{!dropsRefreshLoading && firstSyncConfirmation && firstSyncCampaignCount != null &&');
  expect(source).toContain('campaigns loaded — select a game below and press Start');
  expect(source).toContain('firstSyncCampaignCount');
  expect(source).toContain('hasUnseenRefreshSuccess');
  expect(source).toContain('MARK_DROPS_REFRESH_NOTICE_SEEN');
});

test('popup auto-dismisses first-sync confirmation after 30 seconds', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain('setFirstSyncConfirmation(false);');
  expect(source).toContain('setFirstSyncCampaignCount(null);');
  expect(source).toContain('}, 30000');
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

test('popup header keeps utility icons stable instead of using progressive disclosure', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain('const iconButtonClass =');
  expect(source).toContain('inline-flex h-6 w-6 shrink-0');
  expect(source).not.toContain('header-control-hidden');
  expect(source).not.toContain('header-control-visible');
});

test('popup Drops header button stays icon-only while sync feedback lives outside the toolbar', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain("aria-label={dropsRefreshLoading ? 'Twitch Drops sync in progress' : 'Open Twitch Drops'}");
  expect(source).toContain('<DropsIcon />');
  expect(source).not.toContain('Refreshing Twitch Drops');
  expect(source).not.toContain('<span>Refreshing…</span>');
});

test('popup opens Twitch Drops in the foreground from the header Drops action', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain('onOpenDropsPage={() => void openDropsPage()}');
  expect(source).toContain('const active = options.active !== false;');
  expect(source).toContain('payload: { waitForRefresh: false, active }');
  expect(source).not.toContain('payload: { waitForRefresh: true, active: false }');
});

test('popup auto-refreshes stale campaign data without focusing Twitch', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain('autoRefreshAttemptedFor');
  expect(source).toContain('void openDropsPage({ active: false })');
});

test('popup does not mount reward loading UI just because Drops refresh is running', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toMatch(
    /\(state\.selectedGame\s*\|\|\s*state\.isRunning\s*\|\|\s*pendingDrops\.length > 0\s*\|\|\s*completedDrops\.length > 0\)\s*&&\s*\(/,
  );
  expect(source).not.toMatch(/completedDrops\.length > 0\s*\|\|\s*dropsRefreshLoading\)\s*&&\s*\(/);
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
  expect(source).toContain(": isStale\n          ? 'syncing'");
});

test('popup onboardingCompleted stays out of PopupHeader progressive disclosure props', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).not.toContain('onboardingCompleted: boolean;');
  expect(source).not.toContain('onboardingCompleted={onboardingCompleted}');
});

test('popup onboarding step state tracks selector and start modes', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain("useState<'selector' | 'start' | null>(null)");
});

test('popup CSS defines pulse-glow animation for onboarding highlights', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/index.css'), 'utf-8');

  expect(source).toContain('@keyframes pulse-glow');
  expect(source).toContain('.onboarding-pulse');
  expect(source).not.toContain('header-control-hidden');
  expect(source).not.toContain('header-control-visible');
});
