import type { PlaybackPrepResult, TwitchStreamer } from '../types';
import { STREAM_VALIDATION_GRACE_MS } from './constants.ts';

interface PlaybackState {
  appState: {
    tabId: number | null;
    activeStreamer: TwitchStreamer | null;
  };
  playbackAttentionWarningSent: boolean;
  invalidStreamChecks: number;
  streamValidationGraceUntil: number;
}

interface ChromeTabSummary {
  id?: number;
  windowId?: number;
}

interface TabsApi {
  get(tabId: number): Promise<ChromeTabSummary | null>;
  update(tabId: number, properties: chrome.tabs.UpdateProperties): Promise<unknown>;
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
}

interface WindowsApi {
  update(windowId: number, properties: chrome.windows.UpdateInfo): Promise<unknown>;
}

interface PlaybackOrchestratorOptions {
  tabsApi?: TabsApi;
  windowsApi?: WindowsApi;
  ensureContentScriptOnTab: (tabId: number) => Promise<unknown> | unknown;
  ensureManagedTab: (
    existingTabId: number | null,
    targetUrl: string,
    active: boolean,
  ) => Promise<number | null>;
  waitForTabComplete: (tabId: number, timeoutMs?: number) => Promise<unknown> | unknown;
  shouldMuteManagedFarmingTab: () => boolean;
  needsPlaybackAttention: (result: PlaybackPrepResult | null | undefined) => boolean;
  notify: (title: string, message: string, priority?: number) => Promise<unknown> | unknown;
  streamerWatchUrl: (channelName: string) => string;
  now?: () => number;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createPlaybackOrchestrator(state: PlaybackState, options: PlaybackOrchestratorOptions) {
  const getTabsApi = () => options.tabsApi ?? chrome.tabs;
  const getWindowsApi = () => options.windowsApi ?? chrome.windows;
  const now = () => options.now?.() ?? Date.now();

  const focusManagedTab = async (tabId: number) => {
    const tab = await getTabsApi()
      .get(tabId)
      .catch(() => null);
    if (!tab?.id) {
      return;
    }
    if (typeof tab.windowId === 'number') {
      await getWindowsApi()
        .update(tab.windowId, { focused: true })
        .catch(() => undefined);
    }
    await getTabsApi()
      .update(tab.id, { active: true })
      .catch(() => undefined);
  };

  const sendPlaybackAttentionWarning = async () => {
    if (state.playbackAttentionWarningSent) {
      return;
    }
    state.playbackAttentionWarningSent = true;
    await options.notify(
      'DropHunter needs your attention',
      "Keep Twitch in front and click the video if playback didn't start.",
      2,
    );
  };

  const prepareStreamPlayback = async (
    tabId: number,
    prepOptions?: { activateTab?: boolean; unmuteTab?: boolean; muteAfterPrep?: boolean },
  ): Promise<PlaybackPrepResult> => {
    await options.ensureContentScriptOnTab(tabId);
    const tabUpdate: chrome.tabs.UpdateProperties = {};
    if (prepOptions?.activateTab) {
      tabUpdate.active = true;
    }
    if (prepOptions?.unmuteTab !== false) {
      tabUpdate.muted = false;
    }
    if (Object.keys(tabUpdate).length > 0) {
      await getTabsApi()
        .update(tabId, tabUpdate)
        .catch(() => undefined);
    }
    const prepared = await getTabsApi()
      .sendMessage(tabId, {
        type: 'PREPARE_STREAM_PLAYBACK',
      })
      .catch(() => null);
    if (prepOptions?.muteAfterPrep) {
      await getTabsApi()
        .update(tabId, { muted: true })
        .catch(() => undefined);
    }
    return (prepared ?? {}) as PlaybackPrepResult;
  };

  const warnIfPlaybackNeedsAttention = async (tabId: number, prepared: PlaybackPrepResult) => {
    if (prepared?.gateDismissed) {
      await delay(700);
      const retried = await prepareStreamPlayback(tabId, {
        muteAfterPrep: options.shouldMuteManagedFarmingTab(),
      });
      if (options.needsPlaybackAttention(retried)) {
        await sendPlaybackAttentionWarning();
      }
      return;
    }
    if (options.needsPlaybackAttention(prepared)) {
      await sendPlaybackAttentionWarning();
    }
  };

  const attemptPlaybackSelfHeal = async (tabId: number): Promise<void> => {
    state.playbackAttentionWarningSent = false;
    // Self-heal targets the same already-open streamer; focusing here would steal user focus.
    const prepared = await prepareStreamPlayback(tabId, {
      unmuteTab: true,
      muteAfterPrep: options.shouldMuteManagedFarmingTab(),
    });
    if (prepared?.gateDismissed) {
      await delay(700);
      const retried = await prepareStreamPlayback(tabId, {
        unmuteTab: true,
        muteAfterPrep: options.shouldMuteManagedFarmingTab(),
      });
      if (options.needsPlaybackAttention(retried)) {
        await sendPlaybackAttentionWarning();
      }
      return;
    }
    if (options.needsPlaybackAttention(prepared)) {
      await sendPlaybackAttentionWarning();
    }
  };

  const openForegroundChannel = async (streamer: TwitchStreamer) => {
    const channelName = streamer.name.toLowerCase();
    const displayName = streamer.displayName || channelName;
    const targetUrl = options.streamerWatchUrl(channelName);
    const isStreamerChange =
      !state.appState.activeStreamer || state.appState.activeStreamer.name !== channelName;
    const managedTabId = await options.ensureManagedTab(state.appState.tabId, targetUrl, isStreamerChange);
    if (!managedTabId) {
      return;
    }

    const prepareVisiblePlayback = async () => {
      state.playbackAttentionWarningSent = false;
      if (isStreamerChange) {
        await focusManagedTab(managedTabId);
      }
      await Promise.resolve(options.waitForTabComplete(managedTabId, 15_000)).catch(() => undefined);
      const prepared = await prepareStreamPlayback(managedTabId, {
        activateTab: isStreamerChange,
        unmuteTab: true,
        muteAfterPrep: options.shouldMuteManagedFarmingTab(),
      });
      if (prepared?.gateDismissed) {
        await delay(700);
        const retried = await prepareStreamPlayback(managedTabId, {
          muteAfterPrep: options.shouldMuteManagedFarmingTab(),
        });
        if (options.needsPlaybackAttention(retried)) {
          await sendPlaybackAttentionWarning();
        }
        return;
      }
      if (options.needsPlaybackAttention(prepared)) {
        await sendPlaybackAttentionWarning();
      }
    };

    void prepareVisiblePlayback().catch(() => undefined);
    state.appState.tabId = managedTabId;
    state.appState.activeStreamer = {
      id: channelName,
      name: channelName,
      displayName,
      isLive: true,
      viewerCount: streamer.viewerCount,
    };
    state.invalidStreamChecks = 0;
    state.streamValidationGraceUntil = now() + STREAM_VALIDATION_GRACE_MS;
  };

  const enforcePlaybackPolicyOnStreamTab = async () => {
    if (!state.appState.tabId) {
      return;
    }
    if (now() >= state.streamValidationGraceUntil) {
      return;
    }
    const tab = await getTabsApi()
      .get(state.appState.tabId)
      .catch(() => null);
    if (!tab?.id) {
      return;
    }
    const prepared = await prepareStreamPlayback(tab.id, {
      muteAfterPrep: options.shouldMuteManagedFarmingTab(),
    });
    await warnIfPlaybackNeedsAttention(tab.id, prepared);
  };

  return {
    attemptPlaybackSelfHeal,
    enforcePlaybackPolicyOnStreamTab,
    openForegroundChannel,
    prepareStreamPlayback,
  };
}
