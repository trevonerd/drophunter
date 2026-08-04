import { browser } from '../shared/browser-api.ts';

export const AUTO_START_SNOOZE_KEY = 'autoStartSnoozedForBrowserSession';

export async function isAutoStartSnoozed(): Promise<boolean> {
  const stored = await browser.storage.session.get([AUTO_START_SNOOZE_KEY]);
  return stored[AUTO_START_SNOOZE_KEY] === true;
}

export async function setAutoStartSnoozed(): Promise<void> {
  await browser.storage.session.set({ [AUTO_START_SNOOZE_KEY]: true });
}

export async function clearAutoStartSnooze(): Promise<void> {
  await browser.storage.session.remove([AUTO_START_SNOOZE_KEY]);
}
