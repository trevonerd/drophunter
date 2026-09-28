import { browser } from '../shared/browser-api.ts';
import type { AppState } from '../types/index.ts';
import { logWarn } from './logging.ts';

export const FARMING_RECOVERY_RETRY_ALARM_NAME = 'farmingRecoveryRetry';

export async function reconcileFarmingRecoveryAlarm(state: AppState): Promise<void> {
  const retryAt = state.recoveryBackoffUntil;
  if (
    !state.isRunning ||
    state.isPaused ||
    !state.recoveryReason ||
    typeof retryAt !== 'number' ||
    !Number.isFinite(retryAt)
  ) {
    await browser.alarms.clear(FARMING_RECOVERY_RETRY_ALARM_NAME).catch(() => undefined);
    state.recoverySchedulerUnavailable = false;
    return;
  }
  try {
    const when = Math.max(Date.now() + 30_000, retryAt);
    const existing = await browser.alarms.get(FARMING_RECOVERY_RETRY_ALARM_NAME);
    // Chrome rounds near-term deadlines to its minimum. A subsequent save must
    // never push an already scheduled retry another 30 seconds into the future.
    if (
      existing &&
      existing.scheduledTime > Date.now() &&
      existing.scheduledTime >= retryAt &&
      existing.scheduledTime <= when
    ) {
      state.recoverySchedulerUnavailable = false;
      return;
    }
    await browser.alarms.create(FARMING_RECOVERY_RETRY_ALARM_NAME, { when });
    state.recoverySchedulerUnavailable = false;
  } catch (error) {
    state.recoverySchedulerUnavailable = true;
    logWarn('Farming recovery alarm unavailable; monitoring heartbeat remains active', {
      error: String(error),
    });
  }
}
