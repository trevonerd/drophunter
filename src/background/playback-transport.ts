import { browser } from '../shared/browser-api.ts';
import type { PlaybackPrepResult } from '../types/index.ts';
import { parsePlaybackPrepResult } from './watch-transport.ts';

export type PlaybackPreparationOptions = {
  readonly activateTab?: boolean;
  readonly unmuteTab?: boolean;
  readonly muteAfterPrep?: boolean;
};

export type VisiblePlaybackPreparation = {
  readonly focus: boolean;
  readonly muteAfterPrep: boolean;
};

export interface PlaybackTransport {
  readonly openManaged: (
    existingTabId: number | null,
    targetUrl: string,
    active: boolean,
  ) => Promise<number | null>;
  readonly hasTab: (tabId: number) => Promise<boolean>;
  readonly prepare: (tabId: number, options?: PlaybackPreparationOptions) => Promise<PlaybackPrepResult>;
  readonly prepareVisible: (
    tabId: number,
    options: VisiblePlaybackPreparation,
  ) => Promise<PlaybackPrepResult>;
}

interface ChromeTabSummary {
  readonly id?: number;
  readonly windowId?: number;
}

interface TabsApi {
  readonly get: (tabId: number) => Promise<ChromeTabSummary | null>;
  readonly update: (tabId: number, properties: chrome.tabs.UpdateProperties) => Promise<unknown>;
  readonly sendMessage: (tabId: number, message: unknown) => Promise<unknown>;
}

interface WindowsApi {
  readonly update: (windowId: number, properties: chrome.windows.UpdateInfo) => Promise<unknown>;
}

export interface PlaybackTransportOptions {
  readonly tabsApi?: TabsApi;
  readonly windowsApi?: WindowsApi;
  readonly ensureContentScriptOnTab: (tabId: number) => Promise<unknown> | unknown;
  readonly ensureManagedTab: (
    existingTabId: number | null,
    targetUrl: string,
    active: boolean,
  ) => Promise<number | null>;
  readonly waitForTabComplete: (tabId: number, timeoutMs?: number) => Promise<unknown> | unknown;
}

export function createPlaybackTransport(options: PlaybackTransportOptions): PlaybackTransport {
  const tabs = () => options.tabsApi ?? browser.tabs;
  const windows = () => options.windowsApi ?? browser.windows;

  async function focus(tabId: number): Promise<void> {
    const tab = await tabs()
      .get(tabId)
      .catch(() => null);
    if (typeof tab?.id !== 'number') return;
    if (typeof tab.windowId === 'number') {
      await windows()
        .update(tab.windowId, { focused: true })
        .catch(() => undefined);
    }
    await tabs()
      .update(tab.id, { active: true })
      .catch(() => undefined);
  }

  async function prepare(
    tabId: number,
    preparation?: PlaybackPreparationOptions,
  ): Promise<PlaybackPrepResult> {
    await options.ensureContentScriptOnTab(tabId);
    const tabUpdate: chrome.tabs.UpdateProperties = {};
    if (preparation?.activateTab) tabUpdate.active = true;
    if (preparation?.unmuteTab !== false) tabUpdate.muted = false;
    if (Object.keys(tabUpdate).length > 0) {
      await tabs()
        .update(tabId, tabUpdate)
        .catch(() => undefined);
    }
    const prepared = await tabs()
      .sendMessage(tabId, { type: 'PREPARE_STREAM_PLAYBACK' })
      .catch(() => null);
    if (preparation?.muteAfterPrep) {
      await tabs()
        .update(tabId, { muted: true })
        .catch(() => undefined);
    }
    return parsePlaybackPrepResult(prepared);
  }

  return {
    openManaged: options.ensureManagedTab,
    async hasTab(tabId) {
      const tab = await tabs()
        .get(tabId)
        .catch(() => null);
      return typeof tab?.id === 'number';
    },
    prepare,
    async prepareVisible(tabId, preparation) {
      if (preparation.focus) await focus(tabId);
      await Promise.resolve(options.waitForTabComplete(tabId, 15_000)).catch(() => undefined);
      return prepare(tabId, {
        activateTab: preparation.focus,
        unmuteTab: true,
        muteAfterPrep: preparation.muteAfterPrep,
      });
    },
  };
}
