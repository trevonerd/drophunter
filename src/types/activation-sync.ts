export type ActivationTrigger =
  | 'popup-open'
  | 'worker-start'
  | 'browser-start'
  | 'wake'
  | 'extension-update'
  | 'periodic-campaign'
  | 'auth-recovered'
  | 'manual-retry'
  | 'manual';

export const ACTIVATION_SYNC_ERROR_KINDS = {
  auth: 'auth',
  session: 'session',
  integrity: 'integrity',
  network: 'network',
  'rate-limit': 'rate-limit',
  'invalid-response': 'invalid-response',
} as const;

export type ActivationSyncErrorKind =
  (typeof ACTIVATION_SYNC_ERROR_KINDS)[keyof typeof ACTIVATION_SYNC_ERROR_KINDS];

interface CampaignSyncSnapshot {
  readonly lastAttemptAt: number | null;
  readonly lastSuccessAt: number | null;
  readonly campaignCount: number | null;
  /** Consecutive failures in the current retry episode. */
  readonly retryAttemptCount: number;
  /** Error classification retained across a retry or session-needed state. */
  readonly lastErrorKind: ActivationSyncErrorKind | null;
}

export type CampaignSyncState =
  | (CampaignSyncSnapshot & {
      readonly status: 'idle';
      readonly nextRetryAt: null;
      readonly attemptDeadlineAt: null;
    })
  | (CampaignSyncSnapshot & {
      readonly status: 'syncing';
      readonly nextRetryAt: null;
      readonly attemptDeadlineAt: number;
    })
  | (CampaignSyncSnapshot & {
      readonly status: 'needs-session';
      readonly nextRetryAt: null;
      readonly attemptDeadlineAt: null;
    })
  | (CampaignSyncSnapshot & {
      readonly status: 'retry-scheduled';
      readonly nextRetryAt: number;
      readonly attemptDeadlineAt: null;
      readonly error: string;
    })
  | (CampaignSyncSnapshot & {
      readonly status: 'retry-failed';
      readonly nextRetryAt: null;
      readonly attemptDeadlineAt: null;
      readonly error: string;
    });

export type ActivationSyncResult =
  | { readonly kind: 'cache-fresh'; readonly campaignCount: number | null }
  | { readonly kind: 'not-needed' }
  | { readonly kind: 'synced'; readonly campaignCount: number }
  | { readonly kind: 'needs-session' }
  | { readonly kind: 'retry-scheduled'; readonly retryAt: number; readonly error: string }
  | { readonly kind: 'retry-failed'; readonly error: string };
