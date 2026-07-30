import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MainView } from '../src/popup/components/MainView';
import { createInitialState } from '../src/shared/utils';
import type { TwitchDrop, TwitchGame } from '../src/types';

const campaign: TwitchGame = {
  id: 'game-1',
  name: 'Galactic Frontiers',
  imageUrl: '',
  campaignId: 'campaign-1',
  campaignName: 'Summer Expedition',
  isConnected: true,
  rewardSummary: { completion: 'farmable', remainderReasons: [] },
};

function reward(id: string, name: string, progress: number): TwitchDrop {
  return {
    id,
    name,
    gameId: campaign.id,
    gameName: campaign.name,
    campaignId: campaign.campaignId,
    imageUrl: '',
    progress,
    currentMinutes: progress,
    remainingMinutes: 100 - progress,
    claimed: false,
    claimable: false,
    status: progress > 0 ? 'active' : 'pending',
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
  };
}

function renderRunningPopup(currentDrop: TwitchDrop, pendingDrops: TwitchDrop[]): string {
  const state = {
    ...createInitialState(),
    selectedGame: campaign,
    availableGames: [campaign],
    queue: [campaign],
    currentDrop,
    pendingDrops,
    allDrops: pendingDrops,
    isRunning: true,
    twitchSessionDetected: true,
  };

  return renderToStaticMarkup(
    <MainView
      state={state}
      actionLoading={false}
      dropsRefreshLoading={false}
      campaignSyncStatus="fresh"
      activeSyncError={null}
      sortedGames={[campaign]}
      queueGames={[campaign]}
      pendingDrops={pendingDrops}
      completedDrops={[]}
      claimableCount={0}
      runtimeMode="running"
      recoveryNow={0}
      onboardingStep={null}
      firstSyncConfirmation={false}
      firstSyncCampaignCount={null}
      queueMessage={null}
      rewardsLoading={false}
      onMuteToggle={() => {}}
      onOpenDropsPage={() => {}}
      onOpenMonitor={() => {}}
      onOpenSettings={() => {}}
      onPause={() => {}}
      onResume={() => {}}
      onStop={() => {}}
      onRefreshCampaigns={() => {}}
      onSelectGame={() => {}}
      onAddToQueue={() => {}}
      onRemoveFromQueue={() => {}}
      onClearQueue={() => {}}
      onReorderQueue={() => {}}
      onStart={() => {}}
    />,
  );
}

test('running popup presents the active reward once and hides an empty Pending group', () => {
  // Given the current reward is the only unfinished reward
  const currentDrop = reward('current', 'Orbital Explorer Bundle', 42);

  // When the running popup is rendered
  const markup = renderRunningPopup(currentDrop, [currentDrop]);
  const runningBlock = markup.match(/<section[^>]*data-session-mode="running"[\s\S]*?<\/section>/)?.[0];

  // Then the running block uses the reward-row UI and Pending is omitted
  expect(runningBlock).toContain('Active');
  expect(runningBlock).toContain('Orbital Explorer Bundle progress');
  expect(markup).not.toContain('Pending (1)');
});

test('running popup counts only not-yet-started rewards as Pending', () => {
  // Given one active reward and one reward that has not started
  const currentDrop = reward('current', 'Orbital Explorer Bundle', 42);
  const nextDrop = reward('next', 'Neon Vanguard Crate', 0);

  // When the running popup is rendered
  const markup = renderRunningPopup(currentDrop, [currentDrop, nextDrop]);

  // Then only the not-yet-started reward remains in Pending
  expect(markup).toContain('Pending (1)');
  expect(markup).not.toContain('Pending (2)');
});
