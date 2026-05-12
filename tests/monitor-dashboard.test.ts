import { describe, expect, test } from 'bun:test';
import { openMonitorDashboardWindow } from '../src/background/monitor-dashboard.ts';
import { createInitialState } from '../src/shared/utils.ts';

function createWindowsApi(existingWindow: { id?: number } | null = null) {
  const removed: number[] = [];
  const created: unknown[] = [];

  return {
    removed,
    created,
    async get() {
      return existingWindow;
    },
    async remove(windowId: number) {
      removed.push(windowId);
    },
    async create(createData: chrome.windows.CreateData) {
      created.push(createData);
      return { id: 99 };
    },
  };
}

describe('monitor dashboard window', () => {
  test('toggle closes an existing monitor window and clears state', async () => {
    const state = { appState: { ...createInitialState(), monitorWindowId: 10 } };
    const windowsApi = createWindowsApi({ id: 10 });
    let saveCount = 0;

    const result = await openMonitorDashboardWindow(state, {
      toggle: true,
      windowsApi,
      monitorDashboardUrl: () => 'chrome-extension://id/monitor.html',
      applyBestEffortAlwaysOnTop: async () => {},
      saveState: async () => {
        saveCount += 1;
      },
    });

    expect(result).toEqual({ success: true, opened: false });
    expect(state.appState.monitorWindowId).toBeNull();
    expect(windowsApi.removed).toEqual([10]);
    expect(saveCount).toBe(1);
  });

  test('creates a popup monitor window when none exists', async () => {
    const state = { appState: createInitialState() };
    const windowsApi = createWindowsApi(null);
    const alwaysOnTop: number[] = [];

    const result = await openMonitorDashboardWindow(state, {
      windowsApi,
      monitorDashboardUrl: () => 'chrome-extension://id/monitor.html',
      applyBestEffortAlwaysOnTop: async (windowId) => {
        alwaysOnTop.push(windowId);
      },
      saveState: async () => {},
    });

    expect(result).toEqual({ success: true, opened: true });
    expect(state.appState.monitorWindowId).toBe(99);
    expect(alwaysOnTop).toEqual([99]);
    expect(windowsApi.created).toEqual([
      {
        url: 'chrome-extension://id/monitor.html',
        type: 'popup',
        width: 360,
        height: 220,
        focused: true,
      },
    ]);
  });
});
