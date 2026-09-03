import { expect, test } from 'bun:test';
import { readPopupSource } from '../popup-source-fixture.ts';

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

test('popup delegates manual Drops opening and sync to the coordinator', () => {
  const source = readPopupSource();

  expect(source).toContain("type: 'OPEN_DROPS_AND_SYNC'");
  expect(source).toContain('lastDropsPageRefreshError: null');
  expect(source).toContain('lastDropsPageRefreshAttemptAt: attemptAt');
  expect(source).toContain('if (response?.appState) setState(response.appState)');
  expect(source).not.toContain("type: 'OPEN_DROPS_PAGE_AND_REFRESH'");
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

test('popup preference updates use the same category aliases as durable storage', () => {
  const source = readPopupSource();

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

  expect(source).toContain("| 'waiting'");
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
