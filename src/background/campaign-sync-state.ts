import type { CampaignSyncState } from '../types/index.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

interface CampaignSyncStatePersistence {
  readonly broadcast: (state: ServiceWorkerState['appState']) => void;
  readonly save: (state: ServiceWorkerState) => Promise<void>;
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
  } else if (campaignSyncState.status === 'retry-scheduled') {
    state.appState.lastDropsPageRefreshError = campaignSyncState.error;
  } else {
    state.appState.lastDropsPageRefreshError = null;
  }
  await persistence.save(state);
  persistence.broadcast(state.appState);
}
