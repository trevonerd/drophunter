import type { CampaignSyncState } from '../types/activation-sync.ts';

type CampaignSyncPublicationDependencies = {
  readonly setCampaignSyncState: (state: CampaignSyncState) => Promise<void> | void;
};

export type CampaignSyncPublicationResult = {
  readonly alarmUpdated: boolean;
  readonly statePublished: boolean;
};

export async function publishCampaignSyncState(
  dependencies: CampaignSyncPublicationDependencies,
  state: CampaignSyncState,
  updateAlarm: () => Promise<void> | void,
): Promise<CampaignSyncPublicationResult> {
  const results = await Promise.allSettled([
    Promise.resolve(dependencies.setCampaignSyncState(state)),
    Promise.resolve(updateAlarm()),
  ]);
  return {
    statePublished: results[0]?.status === 'fulfilled',
    alarmUpdated: results[1]?.status === 'fulfilled',
  };
}
