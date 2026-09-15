import type { CampaignSyncState } from '../types/index.ts';
import type { AutomationEventNotifier } from './automation-event-notifier.ts';
import { logWarn } from './logging.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

interface CampaignSyncStatePersistence {
  readonly broadcast: (state: ServiceWorkerState['appState']) => void;
  readonly save: (state: ServiceWorkerState) => Promise<void>;
  readonly notifyAutomation?: AutomationEventNotifier['notify'];
}

export async function persistCampaignSyncState(
  state: ServiceWorkerState,
  campaignSyncState: CampaignSyncState,
  persistence: CampaignSyncStatePersistence,
): Promise<void> {
  state.appState.campaignSyncState = campaignSyncState;
  state.appState.dropsPageRefreshInProgress = campaignSyncState.status === 'syncing';
  state.appState.lastDropsPageRefreshAttemptAt = campaignSyncState.lastAttemptAt;
  state.appState.lastDropsPageRefreshCampaignCount = campaignSyncState.campaignCount;
  if (campaignSyncState.status === 'idle' && campaignSyncState.lastSuccessAt !== null) {
    state.appState.lastSuccessfulRefreshAt = campaignSyncState.lastSuccessAt;
    state.appState.lastDropsPageRefreshCompletedAt = campaignSyncState.lastSuccessAt;
    state.appState.lastDropsPageRefreshError = null;
  } else if (campaignSyncState.status === 'needs-session') {
    state.appState.lastDropsPageRefreshError = 'Open Twitch Drops so DropHunter can detect your session.';
  } else if (campaignSyncState.status === 'retry-scheduled' || campaignSyncState.status === 'retry-failed') {
    state.appState.lastDropsPageRefreshError = campaignSyncState.error;
  } else {
    state.appState.lastDropsPageRefreshError = null;
  }
  await persistence.save(state);
  persistence.broadcast(state.appState);
  const appState = state.appState;
  const hasWaitingWork =
    appState.isRunning ||
    (appState.manualQueueAuthorized && appState.queue.length > 0) ||
    (appState.autoStartFavoriteGames && appState.favoriteGames.length > 0);
  if (
    appState.campaignSyncState === campaignSyncState &&
    campaignSyncState.status === 'needs-session' &&
    hasWaitingWork &&
    !appState.isPaused &&
    appState.lastStopReason !== 'user-stop'
  ) {
    void Promise.resolve()
      .then(() => {
        if (
          state.appState.campaignSyncState !== campaignSyncState ||
          state.appState.isPaused ||
          state.appState.lastStopReason === 'user-stop'
        )
          return;
        return persistence.notifyAutomation?.({
          transitionId: `campaign-sync-needs-session:${campaignSyncState.lastSuccessAt ?? 'initial'}`,
          event: 'sign-in-required',
          campaignId: 'campaign-sync',
          telegramReason: 'sign-in-required',
          title: 'Open Twitch Drops',
          message:
            campaignSyncState.lastErrorKind === 'integrity'
              ? 'Open Twitch Drops to refresh Twitch verification and resume your waiting campaigns.'
              : 'Open Twitch Drops so DropHunter can detect your session and resume your waiting campaigns.',
        });
      })
      .catch(() => logWarn('Campaign session notification delivery failed'));
  }
}
