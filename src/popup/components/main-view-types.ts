import type { RuntimeMode } from '../../shared/runtime-status';
import type { AppState, GamePreference, TwitchDrop, TwitchGame } from '../../types';
import type { CampaignSyncStatus } from '../constants';

export interface MainViewProps {
  state: AppState;
  actionLoading: boolean;
  dropsRefreshLoading: boolean;
  campaignSyncStatus: CampaignSyncStatus;
  activeSyncError: string | null;
  sortedGames: TwitchGame[];
  queueGames: TwitchGame[];
  pendingDrops: TwitchDrop[];
  completedDrops: TwitchDrop[];
  runtimeMode: RuntimeMode;
  recoveryNow: number;
  onboardingStep: 'selector' | 'start' | null;
  firstSyncConfirmation: boolean;
  firstSyncCampaignCount: number | null;
  queueMessage: string | null;
  notificationPermissionDenied: boolean;
  onAutoStartFavoriteGamesToggle: () => void;
  onMuteToggle: () => void;
  onOpenDropsPage: () => void;
  onOpenMonitor: () => void;
  onOpenSettings: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onRefreshCampaigns: () => void;
  onAddToQueue: (game?: TwitchGame) => void;
  onAddAllToQueue: (games: readonly TwitchGame[]) => void;
  onLinkAccount: (game: TwitchGame) => void;
  onSetGamePreference: (game: TwitchGame, preference: GamePreference) => Promise<boolean> | undefined;
  onRemoveFromQueue: (game: TwitchGame) => void;
  onClearQueue: () => void;
  onReorderQueue: (fromIndex: number, toIndex: number) => void;
  onStart: () => void;
}
