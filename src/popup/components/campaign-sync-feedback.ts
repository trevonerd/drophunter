import type { ActivationSyncErrorKind, CampaignSyncState } from '../../types/activation-sync';

const FAILURE_MESSAGES = {
  network: 'Twitch could not be reached.',
  integrity: 'Twitch verification is temporarily unavailable.',
  'rate-limit': 'Twitch requested a cooldown.',
  'invalid-response': 'Twitch returned incomplete campaign data.',
  auth: 'Twitch rejected the saved session.',
  session: 'The Twitch session needs refreshing.',
} as const satisfies Readonly<Record<ActivationSyncErrorKind, string>>;

export function campaignValidationFeedback(state: CampaignSyncState, now = Date.now()): string | null {
  if (state.status !== 'retry-scheduled' && state.status !== 'needs-session') return null;
  const cause =
    state.lastErrorKind == null
      ? 'The last campaign check did not finish.'
      : FAILURE_MESSAGES[state.lastErrorKind];
  if (state.status === 'needs-session') {
    const action = state.lastErrorKind === 'integrity' ? 'refresh verification' : 'restore the session';
    return `${cause} Open Twitch Drops to ${action}.`;
  }
  const remainingMs = state.nextRetryAt - now;
  const retry =
    remainingMs > 0
      ? `Automatic retry in ${Math.max(1, Math.ceil(remainingMs / 60_000))}m.`
      : 'Automatic retry due now.';
  return `${cause} ${retry}`;
}
