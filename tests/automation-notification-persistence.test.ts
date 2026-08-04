import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { automationNotificationPersistence } from '../src/background/automation-notification-persistence.ts';
import type { ChromeMocks } from './mocks/chrome.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

describe('automation notification persistence', () => {
  let mocks: ChromeMocks;
  beforeEach(() => {
    mocks = setupChromeMocks();
  });
  afterEach(() => mocks.teardown());

  test('persists and deduplicates transition keys across controller lifetimes', async () => {
    expect(await automationNotificationPersistence.hasSeen('start:campaign-a')).toBe(false);
    await automationNotificationPersistence.markSeen('start:campaign-a');
    await automationNotificationPersistence.markSeen('start:campaign-a');
    expect(await automationNotificationPersistence.hasSeen('start:campaign-a')).toBe(true);
    expect(mocks.storage.local._store.get('automationNotificationTransitions')).toEqual(['start:campaign-a']);
  });
});
