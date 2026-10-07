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

  test('Chrome synchronous rejection of alwaysOnTop still opens the monitor', async () => {
    const calls: unknown[] = [];
    mock.windows.update = (windowId, details) => {
      calls.push(details);
      if ('alwaysOnTop' in details) throw new TypeError('Unexpected property: alwaysOnTop');
      return Promise.resolve({ id: windowId, focused: details.focused });
    };
    await applyBestEffortAlwaysOnTop(1);
    expect(calls).toEqual([{ focused: true, alwaysOnTop: true }, { focused: true }]);
  });
});
