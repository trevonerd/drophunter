export interface StalledCampaignBlock {
  readonly blockedAt: number;
  readonly rotationAttempts: number;
  readonly eligibleStreamerNames: readonly string[];
  readonly rewardProgressByKey: Readonly<
    Record<string, { readonly progress: number; readonly currentMinutes: number }>
  >;
}
