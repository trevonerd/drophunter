import type { CampaignSyncState } from '../types/index.ts';

export type StartupPresentation = 'normal' | 'starting-silently' | 'blocked';

export function isRoutineStartupSync(campaignSyncState: CampaignSyncState): boolean {
  return (
    campaignSyncState.status === 'syncing' ||
    campaignSyncState.status === 'idle' ||
    (campaignSyncState.status === 'retry-scheduled' && campaignSyncState.retryAttemptCount < 3)
  );
}

export function classifyStartupPresentation(input: {
  readonly blocksStartup: boolean;
  readonly automaticStartPending: boolean;
  readonly campaignSyncState: CampaignSyncState;
}): StartupPresentation {
  if (!input.blocksStartup) return 'normal';
  if (input.automaticStartPending && isRoutineStartupSync(input.campaignSyncState)) {
    return 'starting-silently';
  }
  return 'blocked';
}
