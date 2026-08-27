export type ActivationTrigger =
  | 'popup-open'
  | 'worker-start'
  | 'browser-start'
  | 'wake'
  | 'extension-update'
  | 'periodic-campaign'
  | 'auth-recovered'
  | 'manual';

interface CampaignSyncSnapshot {
  readonly lastAttemptAt: number | null;
  readonly lastSuccessAt: number | null;
  readonly campaignCount: number | null;
}

export type CampaignSyncState =
  | (CampaignSyncSnapshot & { readonly status: 'idle'; readonly nextRetryAt: null })
  | (CampaignSyncSnapshot & { readonly status: 'syncing'; readonly nextRetryAt: null })
  | (CampaignSyncSnapshot & { readonly status: 'needs-session'; readonly nextRetryAt: null })
  | (CampaignSyncSnapshot & {
      readonly status: 'retry-scheduled';
      readonly nextRetryAt: number;
      readonly error: string;
    });

export type ActivationSyncResult =
  | { readonly kind: 'cache-fresh'; readonly campaignCount: number | null }
  | { readonly kind: 'not-needed' }
  | { readonly kind: 'synced'; readonly campaignCount: number }
  | { readonly kind: 'needs-session' }
  | { readonly kind: 'retry-scheduled'; readonly retryAt: number; readonly error: string };
