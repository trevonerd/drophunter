import { renderToStaticMarkup } from 'react-dom/server';
import { MainView, type MainViewProps } from '../../src/popup/components/MainView';
import type { AppState, TwitchDrop, TwitchGame } from '../../src/types';
import { createInitialState } from '../../src/shared/utils';

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
    ...createInitialState(),
    selectedGame,
    availableGames: selectedGame ? [selectedGame] : [],
    twitchSessionDetected: true,
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
    notificationPermissionDenied: false,
    onAutoStartFavoriteGamesToggle: () => {},
    onMuteToggle: () => {},
    onOpenDropsPage: () => {},
    onOpenMonitor: () => {},
    onOpenSettings: () => {},
    onPause: () => {},
    onResume: () => {},
    onStop: () => {},
    onDismissFarmingMessage: () => {},
    onAddToQueue: () => {},
    onRemoveFromQueue: () => {},
    onClearQueue: () => {},
    onReorderQueue: () => {},
    onAddAllToQueue: () => {},
    onLinkAccount: () => {},
    onSetGamePreference: () => undefined,
    onStartQueuedCampaign: () => {},
    onStart: () => {},
    onRetry: () => {},
    ...overrides,
  } satisfies MainViewProps;

  return renderToStaticMarkup(<MainView {...props} />);
}

export function startButtonMarkup(markup: string): string {
  return markup.match(/<button[^>]*>Start (?:Farming|Queue \(\d+\))<\/button>/)?.[0] ?? '';
}
