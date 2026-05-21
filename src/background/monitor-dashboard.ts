import { browser } from '../shared/browser-api.ts';
import type { AppState } from '../types';

interface MonitorDashboardState {
  appState: Pick<AppState, 'monitorWindowId'>;
}

interface ChromeWindowSummary {
  id?: number;
}

interface WindowCreateData {
  url: string;
  type: 'popup';
  width: number;
  height: number;
  focused: boolean;
}

interface WindowsApi {
  get(windowId: number): Promise<ChromeWindowSummary | null>;
  remove(windowId: number): Promise<unknown>;
  create(createData: WindowCreateData): Promise<ChromeWindowSummary | null>;
}

interface OpenMonitorDashboardOptions {
  toggle?: boolean;
  windowsApi?: WindowsApi;
  monitorDashboardUrl: () => string;
  applyBestEffortAlwaysOnTop: (windowId: number) => Promise<unknown> | unknown;
  saveState: () => Promise<unknown> | unknown;
}

export async function openMonitorDashboardWindow(
  state: MonitorDashboardState,
  options: OpenMonitorDashboardOptions,
) {
  const windowsApi = options.windowsApi ?? browser.windows;
  const url = options.monitorDashboardUrl();
  if (state.appState.monitorWindowId) {
    const existingWindow = await windowsApi.get(state.appState.monitorWindowId).catch(() => null);
    if (existingWindow?.id) {
      if (options.toggle) {
        await windowsApi.remove(existingWindow.id).catch(() => undefined);
        state.appState.monitorWindowId = null;
        await options.saveState();
        return { success: true, opened: false };
      }
      await options.applyBestEffortAlwaysOnTop(existingWindow.id);
      return { success: true, opened: true };
    }
    state.appState.monitorWindowId = null;
  }

  const createdWindow = await windowsApi
    .create({
      url,
      type: 'popup',
      width: 360,
      height: 220,
      focused: true,
    })
    .catch(() => null);
  if (!createdWindow?.id) {
    return { success: false, error: 'Unable to open monitor window.' };
  }

  state.appState.monitorWindowId = createdWindow.id;
  await options.applyBestEffortAlwaysOnTop(createdWindow.id);
  await options.saveState();
  return { success: true, opened: true };
}
