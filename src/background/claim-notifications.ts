import type { ClaimLogEntry } from '../types/index.ts';
import type { ClaimNotificationOptions } from './claim-log.ts';
import { logWarn } from './logging.ts';

interface ClaimNotificationDependencies {
  readonly notifyBrowser: (title: string, message: string) => Promise<unknown>;
  readonly notifyTelegram: (entries: ClaimLogEntry[]) => Promise<unknown>;
}

const BROWSER_SUMMARY_THRESHOLD = 3;

function browserMessages(entries: ClaimLogEntry[]): string[] {
  if (entries.length > BROWSER_SUMMARY_THRESHOLD) return [`Claimed ${entries.length} drops`];
  return entries.map((entry) => `Claimed: ${entry.dropName} (${entry.campaignLabel || entry.gameName})`);
}

export function createClaimRecordedHandler(dependencies: ClaimNotificationDependencies) {
  return async (recorded: ClaimLogEntry[], options: ClaimNotificationOptions = {}): Promise<void> => {
    const entries = options.silentIds
      ? recorded.filter((entry) => !options.silentIds?.has(entry.id))
      : recorded;
    if (entries.length === 0) return;
    const browserDeliveries = options.suppressBrowserNotifications ? [] : browserMessages(entries);
    const deliveries = await Promise.allSettled([
      ...browserDeliveries.map((message) =>
        Promise.resolve().then(() => dependencies.notifyBrowser('Drop completed', message)),
      ),
      Promise.resolve().then(() => dependencies.notifyTelegram(entries)),
    ]);
    if (deliveries.some((result) => result.status === 'rejected')) {
      logWarn('Claim notification delivery failed');
    }
  };
}
