import { describe, expect, test } from 'bun:test';
import {
  clearManagedTabOwnership,
  shouldMuteManagedFarmingTab,
  syncManagedTabMuteState,
} from '../src/background/tab-management.ts';
import { createInitialState } from '../src/shared/utils.ts';
import { createTabManagementState } from './fixtures/tab-management-state.ts';
import { setupTabManagementMock, type TabManagementTabUpdateDetails } from './mocks/tab-management.ts';

describe('clearManagedTabOwnership', () => {
  test('clears tabId and activeStreamer from state', () => {
    const state = createTabManagementState({
      appState: { ...createInitialState(), tabId: 42, activeStreamer: 'TestChannel' },
    });
    clearManagedTabOwnership(state);
    expect(state.appState.tabId).toBeNull();
    expect(state.appState.activeStreamer).toBeNull();
  });
});

describe('shouldMuteManagedFarmingTab', () => {
  test('returns true when muteFarmingTab is undefined', () => {
    const state = createTabManagementState();
    delete state.appState.muteFarmingTab;
    expect(shouldMuteManagedFarmingTab(state)).toBe(true);
  });

  test('returns true when muteFarmingTab is true', () => {
    const state = createTabManagementState({
      appState: { ...createInitialState(), muteFarmingTab: true },
    });
    expect(shouldMuteManagedFarmingTab(state)).toBe(true);
  });

  test('returns false when muteFarmingTab is explicitly false', () => {
    const state = createTabManagementState({
      appState: { ...createInitialState(), muteFarmingTab: false },
    });
    expect(shouldMuteManagedFarmingTab(state)).toBe(false);
  });
});

describe('syncManagedTabMuteState', () => {
  test('does nothing when tabId is null', async () => {
    const setup = setupTabManagementMock();
    try {
      let updateCalled = false;
      setup.mock.tabs.update = () => {
        updateCalled = true;
        return Promise.reject(new Error('should not be called'));
      };
      const state = createTabManagementState({
        appState: { ...createInitialState(), tabId: null },
      });
      await syncManagedTabMuteState(state);
      expect(updateCalled).toBe(false);
    } finally {
      setup.teardown();
    }
  });

  test('updates tab with muted=true when muteFarmingTab is not false', async () => {
    await assertMuteUpdate(true);
  });

  test('updates tab with muted=false when muteFarmingTab is false', async () => {
    await assertMuteUpdate(false);
  });
});

async function assertMuteUpdate(muted: boolean): Promise<void> {
  const setup = setupTabManagementMock();
  try {
    let updatedMuted: boolean | undefined;
    setup.mock.tabs.update = async (tabId: number, details: TabManagementTabUpdateDetails) => {
      updatedMuted = details.muted;
      return { id: tabId, ...details };
    };
    const state = createTabManagementState({
      appState: { ...createInitialState(), tabId: 42, muteFarmingTab: muted },
    });
    await syncManagedTabMuteState(state);
    expect(updatedMuted).toBe(muted);
  } finally {
    setup.teardown();
  }
}
