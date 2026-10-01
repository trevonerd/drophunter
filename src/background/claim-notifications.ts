import type { ClaimLogEntry } from '../types/index.ts';
import type { ClaimNotificationOptions } from './claim-log.ts';
import { logWarn } from './logging.ts';

interface ClaimNotificationDependencies {
  readonly notifyBrowser: (title: string, message: string) => Promise<unknown>;
  readonly notifyTelegram: (entries: ClaimLogEntry[]) => Promise<unknown>;
}

export function createClaimRecordedHandler(dependencies: ClaimNotificationDependencies) {
  return async (entries: ClaimLogEntry[], options: ClaimNotificationOptions = {}): Promise<void> => {
    if (entries.length === 0) return;
    const deliveries = await Promise.allSettled([
      ...(options.suppressBrowserNotifications ? [] : entries).map((entry) =>
        Promise.resolve().then(() =>
          dependencies.notifyBrowser(
            'Drop completed',
            `Claimed: ${entry.dropName} (${entry.campaignLabel || entry.gameName})`,
          ),
        ),
      ),
      Promise.resolve().then(() => dependencies.notifyTelegram(entries)),
    ]);
    if (deliveries.some((result) => result.status === 'rejected')) {
      logWarn('Claim notification delivery failed');
    }
  };
}
