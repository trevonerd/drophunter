import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '..');

// The popup UI used to live entirely in App.tsx. It is now split across
// src/popup (components, hooks, format/constants helpers), so these source
// assertions read the concatenation of every popup .ts/.tsx file.
function readPopupSource(): string {
  const popupDir = join(repoRoot, 'src/popup');
  return readdirSync(popupDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name))
    .sort()
    .map((filePath) => readFileSync(filePath, 'utf-8'))
    .join('\n');
}

test('popup campaign catalog groups campaigns with the shared category identity', () => {
  const source = readPopupSource();

  expect(source).toContain('const key = gameCategoryKey(campaign);');
  expect(source).toContain('campaigns: groupedCampaigns');
  expect(source).not.toContain('CampaignSelector');
});

test('popup reward grouping uses reward automation semantics', () => {
  const source = readPopupSource();

  expect(source).toContain("import { isRewardAutomatable } from '../../shared/reward-semantics';");
  expect(source).toContain('pendingDrops.every((drop) => !isRewardAutomatable(drop))');
});

test('popup maps the typed farming-complete queue response to campaign status vocabulary', () => {
  const source = readPopupSource();

  expect(source).toContain("response.reason === 'farming-complete'");
  expect(source).toContain('formatFarmingCompleteQueueMessage(requestedGame)');
});

test('popup does not duplicate refresh loading state under the game selector', () => {
  const source = readPopupSource();

  expect(source).not.toContain("setQueueMessage('Refreshing campaigns from Twitch...')");
});

test('popup treats Drops page refresh response as an async launch acknowledgement', () => {
  const source = readPopupSource();

  expect(source).toContain('const active = options.active !== false;');
  expect(source).toContain('payload: { waitForRefresh: false, active }');
  expect(source).toContain('lastDropsPageRefreshError: null');
  expect(source).toContain('lastDropsPageRefreshAttemptAt: attemptAt');
  expect(source).not.toContain('response?.appState ??');
  expect(source).not.toContain(
    'prev.dropsPageRefreshInProgress ? { ...prev, dropsPageRefreshInProgress: false }',
  );
});

test('popup does not silently refresh campaigns on mount', () => {
  const source = readPopupSource();

  expect(source).not.toContain('ENSURE_GAMES_CACHE');
  expect(source).not.toContain('fetchAvailableGames');
});

test('popup no longer carries the removed dropdown selection workflow', () => {
  const source = readPopupSource();

  expect(source).not.toContain('const handleGameSelect = async (gameId: string) => {');
  expect(source).not.toContain('beginRewardsLoad');
  expect(source).not.toContain('pendingGameRef');
});

test('popup favorite updates use the same category aliases as durable storage', () => {
  const source = readPopupSource();

  expect(source).toContain('isFavoriteGame(game, favoriteGameIdentityKeys(prev.favoriteGames))');
  expect(source).toContain('[entry.gameId, ...(entry.identityKeys ?? [])]');
});

test('popup campaign catalog and queue use campaign-aware identities', () => {
  const source = readPopupSource();

  expect(source).toContain('key={queueGameIdentity(game)}');
  expect(source).toContain('data-campaign-key={key}');
  expect(source).not.toContain('value={selectedGame?.id ??');
});

test('popup uses a single campaign sync panel for empty, stale, syncing, failed, and fresh states', () => {
  const source = readPopupSource();

  expect(source).toContain(
    "type CampaignSyncStatus = 'empty' | 'signed-out' | 'fresh' | 'stale' | 'syncing' | 'failed'",
  );
  expect(source).toContain('function CampaignSyncPanel');
  expect(source).toContain('aria-live="polite"');
  expect(source).toContain('function TwitchSessionGate');
  expect(source).toContain('Updating campaigns…');
  expect(source).toContain('Waiting for first sync');
  expect(source).toContain('Campaign update failed. Showing saved data.');
  expect(source).toContain('Campaign update failed. No campaigns are available yet.');
  expect(source).toContain('hasCachedCampaigns={state.availableGames.length > 0}');
});

test('popup splits the main campaign UI into focused components', () => {
  const source = readPopupSource();

  expect(source).toContain('function PopupHeader');
  expect(source).toContain('function QueueChips');
  expect(source).toContain('function RewardList');
});

test('popup queue chips support drag-and-drop reordering', () => {
  const source = readPopupSource();

  expect(source).toContain("type: 'REORDER_QUEUE'");
  expect(source).toContain('<ol className="flex flex-col gap-1">');
  expect(source).toContain('data-queue-item="campaign"');
  expect(source).toContain('draggable');
  expect(source).toContain('useQueueDragReorder');
  expect(source).toContain('onReorder={onReorderQueue}');
});

test('popup async copy uses ellipsis glyphs instead of three-dot loading text', () => {
  const source = readPopupSource();

  expect(source).not.toContain('Loading...');
  expect(source).not.toContain('Refreshing...');
  expect(source).not.toContain('Starting...');
  expect(source).toContain('Loading…');
  expect(source).toContain('Starting…');
});

test('popup exposes a quick audio toggle for the farming tab', () => {
  const source = readPopupSource();

  expect(source).toContain('Turn stream audio on');
  expect(source).toContain('Mute stream audio');
  expect(source).toContain('handleMuteFarmingTabToggle');
  expect(source).toContain('<SpeakerIcon muted={state.muteFarmingTab} />');
});

test('popup campaign catalog replaces the old selector with search and explicit queue copy', () => {
  const source = readPopupSource();

  expect(source).toContain('placeholder="Search games, campaigns or Drops"');
  expect(source).toContain("setQueueMessage('Select a campaign to start farming.')");
  expect(source).not.toContain('Select a game to start');
});

test('popup renders first-sync confirmation banner with campaign count', () => {
  const source = readPopupSource();

  expect(source).toContain(
    '{!dropsRefreshLoading && firstSyncConfirmation && firstSyncCampaignCount != null &&',
  );
  expect(source).toContain('campaigns loaded.');
  expect(source).toContain('firstSyncCampaignCount');
  expect(source).toContain('hasUnseenRefreshSuccess');
  expect(source).toContain('MARK_DROPS_REFRESH_NOTICE_SEEN');
});

test('popup auto-dismisses first-sync confirmation after 30 seconds', () => {
  const source = readPopupSource();

  expect(source).toContain('setFirstSyncConfirmation(false);');
  expect(source).toContain('setFirstSyncCampaignCount(null);');
  expect(source).toContain('}, 30000');
});

test('popup applies onboarding-pulse class to campaign list when step is selector', () => {
  const source = readPopupSource();

  expect(source).toContain("onboardingStep === 'selector' ? 'onboarding-pulse rounded-lg' : ''");
  expect(source).toContain('<CampaignList');
});

test('favorite campaign highlight lasts exactly 180 milliseconds without bounce', () => {
  const source = readPopupSource();

  expect(source).toContain('setActiveHighlightKey(null), 180');
  expect(source).toContain('duration-[180ms]');
  expect(source).not.toContain('animate-bounce');
});

test('popup applies onboarding-pulse class to start button when step is start', () => {
  const source = readPopupSource();

  expect(source).toContain("startHighlighted={onboardingStep === 'start'}");
  expect(source).toContain("props.startHighlighted ? 'onboarding-pulse' : ''");
});

test('popup saves onboardingCompleted to chrome.storage.local after first start', () => {
  const source = readPopupSource();

  expect(source).toContain('await browser.storage.local.set({ onboardingCompleted: true })');
  expect(source).toContain('setOnboardingStep(null)');
  expect(source).toContain('setOnboardingCompleted(true)');
});

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
  expect(source).toContain('const active = options.active !== false;');
  expect(source).toContain('payload: { waitForRefresh: false, active }');
  expect(source).not.toContain('payload: { waitForRefresh: true, active: false }');
});

test('popup auto-refreshes stale campaign data without focusing Twitch', () => {
  const source = readPopupSource();

  expect(source).toContain('autoRefreshAttemptedFor');
  expect(source).toContain('void openDropsPage({ active: false })');
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

test('QuestionIcon keeps the compact circled-question SVG conventions', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/components/icons.tsx'), 'utf-8');

  expect(source).toContain('export function QuestionIcon()');
  expect(source).toContain('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">');
  expect(source).toContain('<circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />');
  expect(source).toContain('stroke="currentColor" strokeWidth="2" strokeLinecap="round"');
});
