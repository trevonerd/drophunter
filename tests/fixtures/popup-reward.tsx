import { renderToStaticMarkup } from 'react-dom/server';
import { MainView, type MainViewProps } from '../../src/popup/components/MainView';
import type { AppState, TwitchDrop, TwitchGame } from '../../src/types';

export function game(overrides: Partial<TwitchGame> = {}): TwitchGame {
  return {
    id: 'game-id',
    name: 'Example Game',
    imageUrl: '',
    campaignId: 'campaign-id',
    campaignName: 'Example Campaign',
    isConnected: true,
    rewardSummary: { completion: 'farmable', remainderReasons: [] },
    ...overrides,
  };
}

export function appState(selectedGame: TwitchGame | null): AppState {
  return {
    selectedGame,
    isRunning: false,
    isPaused: false,
    monitorAutoOpen: false,
    autoResumeOnStartup: false,
    muteFarmingTab: true,
    notificationsEnabled: false,
    telegramAlertsEnabled: false,
    autoClaimChannelPointsBonus: false,
    autoClaimDrops: false,
    totalDropsClaimed: 0,
    totalChannelPointsClaimed: 0,
    streamerSelectionMode: 'low-view',
    preferredStreamerLanguage: null,
    activeStreamer: null,
    currentDrop: null,
    completedDrops: [],
    pendingDrops: [],
    allDrops: [],
    availableGames: selectedGame ? [selectedGame] : [],
    queue: [],
    monitorWindowId: null,
    tabId: null,
    completionNotified: false,
    twitchSessionDetected: true,
    dropsPageRefreshInProgress: false,
  };
}

export function drop(overrides: Partial<TwitchDrop> = {}): TwitchDrop {
  return {
    id: 'reward-id',
    name: 'Example Reward',
    gameId: 'game-id',
    gameName: 'Example Game',
    imageUrl: '',
    progress: 0,
    currentMinutes: 0,
    claimed: false,
    claimable: false,
    status: 'pending',
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
    ...overrides,
  };
}

export function renderMainView(
  state: AppState,
  queueGames: TwitchGame[] = [],
  overrides: Partial<MainViewProps> = {},
): string {
  const props = {
    state,
    actionLoading: false,
    dropsRefreshLoading: false,
    campaignSyncStatus: 'fresh',
    activeSyncError: null,
    sortedGames: state.availableGames,
    queueGames,
    pendingDrops: state.pendingDrops,
    completedDrops: state.completedDrops,
    runtimeMode: 'idle',
    recoveryNow: 0,
    onboardingStep: null,
    firstSyncConfirmation: false,
    firstSyncCampaignCount: null,
    queueMessage: null,
    rewardsLoading: false,
    notificationPermissionDenied: false,
    onAutoStartFavoriteGamesToggle: () => {},
    onMuteToggle: () => {},
    onOpenDropsPage: () => {},
    onOpenMonitor: () => {},
    onOpenSettings: () => {},
    onPause: () => {},
    onResume: () => {},
    onStop: () => {},
    onRefreshCampaigns: () => {},
    onAddToQueue: () => {},
    onRemoveFromQueue: () => {},
    onClearQueue: () => {},
    onReorderQueue: () => {},
    onStart: () => {},
    ...overrides,
  } satisfies MainViewProps;

  return renderToStaticMarkup(<MainView {...props} />);
}

export function startButtonMarkup(markup: string): string {
  return markup.match(/<button[^>]*>Start (?:Farming|Queue \(\d+\))<\/button>/)?.[0] ?? '';
}
