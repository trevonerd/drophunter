import { browser } from '../shared/browser-api.ts';
import type { AutomationNotificationPersistence } from './notifications.ts';

const AUTOMATION_NOTIFICATION_TRANSITIONS_KEY = 'automationNotificationTransitions';
const MAX_PERSISTED_TRANSITIONS = 200;

async function readTransitions(): Promise<string[]> {
  const stored = await browser.storage.local.get([AUTOMATION_NOTIFICATION_TRANSITIONS_KEY]);
  const value = stored[AUTOMATION_NOTIFICATION_TRANSITIONS_KEY];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

export const automationNotificationPersistence: AutomationNotificationPersistence = {
  async hasSeen(key) {
    return (await readTransitions()).includes(key);
  },
  async markSeen(key) {
    const transitions = await readTransitions();
    if (transitions.includes(key)) {
      return;
    }
    await browser.storage.local.set({
      [AUTOMATION_NOTIFICATION_TRANSITIONS_KEY]: [...transitions, key].slice(-MAX_PERSISTED_TRANSITIONS),
    });
  },
};
