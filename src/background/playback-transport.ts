import { browser } from '../shared/browser-api.ts';
import type { PlaybackPrepResult } from '../types/index.ts';
import { withRecoveryTimeout } from './session-recovery-lifecycle.ts';
import { parsePlaybackPrepResult } from './watch-transport.ts';

const PLAYBACK_PREPARATION_TIMEOUT_MS = 30_000;
const PLAYBACK_PREPARATION_POLL_MS = 500;

export type PlaybackPreparationOptions = {
  readonly activateTab?: boolean;
  readonly unmuteTab?: boolean;
  readonly muteAfterPrep?: boolean;
  readonly isCurrent?: () => boolean;
};

type VisiblePlaybackPreparation = {
  readonly focus: boolean;
  readonly muteAfterPrep: boolean;
  readonly isCurrent?: () => boolean;
};

export interface PlaybackTransport {
  readonly openManaged: (
    existingTabId: number | null,
    targetUrl: string,
    active: boolean,
    isCurrent?: () => boolean,
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
    isCurrent?: () => boolean,
  ) => Promise<number | null>;
  readonly waitForTabComplete: (tabId: number, timeoutMs?: number) => Promise<unknown> | unknown;
}

export function createPlaybackTransport(options: PlaybackTransportOptions): PlaybackTransport {
  const tabs = () => options.tabsApi ?? browser.tabs;
  const windows = () => options.windowsApi ?? browser.windows;

  async function focus(tabId: number, isCurrent: () => boolean): Promise<void> {
    if (!isCurrent()) return;
    const tab = await tabs()
      .get(tabId)
      .catch(() => null);
    if (!isCurrent() || typeof tab?.id !== 'number') return;
    if (typeof tab.windowId === 'number') {
      await windows()
        .update(tab.windowId, { focused: true })
        .catch(() => undefined);
    }
    if (!isCurrent()) return;
    await tabs()
      .update(tab.id, { active: true })
      .catch(() => undefined);
  }

  async function prepare(
    tabId: number,
    preparation?: PlaybackPreparationOptions,
  ): Promise<PlaybackPrepResult> {
    let expired = false;
    const isCurrent = () => !expired && (preparation?.isCurrent?.() ?? true);
    if (!isCurrent()) return {};
    const deadline = Date.now() + PLAYBACK_PREPARATION_TIMEOUT_MS;
    const maxAttempts = PLAYBACK_PREPARATION_TIMEOUT_MS / PLAYBACK_PREPARATION_POLL_MS;
    let prepared: PlaybackPrepResult = {};
    const run = async (): Promise<PlaybackPrepResult> => {
      await options.ensureContentScriptOnTab(tabId);
      if (!isCurrent()) return {};
      const tabUpdate: chrome.tabs.UpdateProperties = {};
      if (preparation?.activateTab) tabUpdate.active = true;
      if (preparation?.unmuteTab !== false) tabUpdate.muted = false;
      if (Object.keys(tabUpdate).length > 0) {
        await tabs()
          .update(tabId, tabUpdate)
          .catch(() => undefined);
      }
      // A complete document can still be mounting Twitch's player. Keep the
      // current candidate until loading settles instead of cycling streamers.
      for (let attempt = 0; attempt < maxAttempts && isCurrent(); attempt++) {
        let receiverUnavailable = false;
        prepared = parsePlaybackPrepResult(
          await tabs()
            .sendMessage(tabId, { type: 'PREPARE_STREAM_PLAYBACK' })
            .catch(() => {
              receiverUnavailable = true;
              return null;
            }),
        );
        if (
          !isCurrent() ||
          prepared.isPlaybackReady ||
          prepared.userInteractionRequired ||
          (!receiverUnavailable && !prepared.playbackPending && !prepared.gateDismissed) ||
          Date.now() >= deadline ||
          attempt === maxAttempts - 1
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, PLAYBACK_PREPARATION_POLL_MS));
        if (receiverUnavailable && isCurrent()) {
          await Promise.resolve(options.waitForTabComplete(tabId, Math.max(0, deadline - Date.now()))).catch(
            () => undefined,
          );
          if (isCurrent()) await options.ensureContentScriptOnTab(tabId);
        }
      }
      if (isCurrent() && preparation?.muteAfterPrep) {
        await tabs()
          .update(tabId, { muted: true })
          .catch(() => undefined);
      }
      return isCurrent() ? prepared : {};
    };
    const result = await withRecoveryTimeout(run(), PLAYBACK_PREPARATION_TIMEOUT_MS, () => {
      expired = true;
    });
    if (result !== null) return result;
    return preparation?.isCurrent?.() !== false && prepared.playbackPending ? prepared : {};
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
      const isCurrent = preparation.isCurrent ?? (() => true);
      if (!isCurrent()) return {};
      if (preparation.focus) await focus(tabId, isCurrent);
      if (!isCurrent()) return {};
      await Promise.resolve(options.waitForTabComplete(tabId, 15_000)).catch(() => undefined);
      if (!isCurrent()) return {};
      return prepare(tabId, {
        activateTab: preparation.focus,
        unmuteTab: true,
        muteAfterPrep: preparation.muteAfterPrep,
        isCurrent,
      });
    },
  };
}
