import { browser } from '../shared/browser-api.ts';
import type { AutomationNotificationPersistence } from './automation-event-notifier.ts';

const AUTOMATION_NOTIFICATION_TRANSITIONS_KEY = 'automationNotificationTransitions';
const MAX_PERSISTED_TRANSITIONS = 200;
let pendingWrite = Promise.resolve();

async function readTransitions(): Promise<string[]> {
  const stored = await browser.storage.local.get([AUTOMATION_NOTIFICATION_TRANSITIONS_KEY]);
  const value = stored[AUTOMATION_NOTIFICATION_TRANSITIONS_KEY];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

export const automationNotificationPersistence: AutomationNotificationPersistence = {
  async hasSeen(key) {
    return (await readTransitions()).includes(key);
  },
  markSeen(key) {
    const write = pendingWrite.then(async () => {
      const transitions = await readTransitions();
      if (transitions.includes(key)) return;
      const stored = await browser.storage.local.get('appState');
      const app = stored.appState;
      const episodes =
        app &&
        typeof app === 'object' &&
        'campaignFailureEpisodesByKey' in app &&
        app.campaignFailureEpisodesByKey &&
        typeof app.campaignFailureEpisodesByKey === 'object'
          ? app.campaignFailureEpisodesByKey
          : {};
      const active = new Set(
        Object.values(episodes).flatMap((episode: unknown) =>
          episode && typeof episode === 'object' && 'id' in episode && typeof episode.id === 'string'
            ? [episode.id]
            : [],
        ),
      );
      const receipts = [...transitions, key];
      const protectedReceipt = (receipt: string) => active.has(receipt.replace(/^(browser|telegram):/, ''));
      await browser.storage.local.set({
        [AUTOMATION_NOTIFICATION_TRANSITIONS_KEY]: [
          ...receipts.filter(protectedReceipt),
          ...receipts.filter((receipt) => !protectedReceipt(receipt)).slice(-MAX_PERSISTED_TRANSITIONS),
        ],
      });
    });
    pendingWrite = write.then(
      () => undefined,
      () => undefined,
    );
    return write;
  },
};
