import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { waitForTabComplete } from '../src/background/tab-management.ts';
import { setupTabManagementMock, type TabManagementChrome } from './mocks/tab-management.ts';

describe('waitForTabComplete', () => {
  let mock: TabManagementChrome;
  let teardown: () => void;

  beforeEach(() => {
    const setup = setupTabManagementMock();
    mock = setup.mock;
    teardown = setup.teardown;
  });

  afterEach(() => teardown());

  test('resolves immediately if tab already complete', async () => {
    mock.tabs.setGetResult({ id: 5, status: 'complete' });
    await waitForTabComplete(5, 5000);
    expect(true).toBe(true);
  });

  test('resolves via onUpdated event when tab completes', async () => {
    mock.tabs.setGetResult({ id: 5, status: 'loading' });
    const promise = waitForTabComplete(5, 10000);
    mock.tabs.onUpdated.trigger(5, { status: 'complete' });
    await promise;
    expect(true).toBe(true);
  });

  test('resolves on timeout even if tab never completes', async () => {
    mock.tabs.setGetResult({ id: 5, status: 'loading' });
    await waitForTabComplete(5, 100);
    expect(true).toBe(true);
  });
});
