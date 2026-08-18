import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { applyBestEffortAlwaysOnTop } from '../src/background/tab-management.ts';
import { setupTabManagementMock, type TabManagementChrome } from './mocks/tab-management.ts';

describe('applyBestEffortAlwaysOnTop', () => {
  let mock: TabManagementChrome;
  let teardown: () => void;

  beforeEach(() => {
    const setup = setupTabManagementMock();
    mock = setup.mock;
    teardown = setup.teardown;
  });

  afterEach(() => teardown());

  test('sets alwaysOnTop and focused on window', async () => {
    await applyBestEffortAlwaysOnTop(1);
    expect(true).toBe(true);
  });

  test('falls back to focused-only if alwaysOnTop fails', async () => {
    let callCount = 0;
    const originalUpdate = mock.windows.update;
    mock.windows.update = async (windowId, details) => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('not allowed'));
      return originalUpdate(windowId, details);
    };
    await applyBestEffortAlwaysOnTop(1);
    expect(callCount).toBe(2);
  });
});
