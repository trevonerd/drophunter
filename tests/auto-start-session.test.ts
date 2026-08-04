import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  clearAutoStartSnooze,
  isAutoStartSnoozed,
  setAutoStartSnoozed,
} from '../src/background/auto-start-session.ts';
import type { ChromeMocks } from './mocks/chrome.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

describe('auto-start browser-session snooze', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('survives service-worker calls in session storage and clears on browser startup', async () => {
    expect(await isAutoStartSnoozed()).toBe(false);

    await setAutoStartSnoozed();
    expect(await isAutoStartSnoozed()).toBe(true);

    await clearAutoStartSnooze();
    expect(await isAutoStartSnoozed()).toBe(false);
  });
});
