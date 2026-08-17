import type { PlaybackPrepResult, TwitchStreamer } from '../types/index.ts';
import { STREAM_VALIDATION_GRACE_MS } from './constants.ts';
import type { ManualStreamContext, ManualWatchTab } from './manual-watch-detector.ts';
import type { PlaybackAttentionPolicy } from './playback-attention-policy.ts';
import type { PlaybackPreparationOptions, PlaybackTransport } from './playback-transport.ts';

export type ManualPlaybackTab = ManualWatchTab & {
  readonly windowId?: number;
};

export type ManualPlaybackObservation = {
  readonly tab: ManualPlaybackTab;
  readonly context: ManualStreamContext | null;
};

export type ManualPlaybackObservationResult =
  | {
      readonly kind: 'observed';
      readonly tabs: readonly ManualPlaybackObservation[];
    }
  | { readonly kind: 'failed' };

export async function observeManualPlayback(
  tabsApi: {
    readonly query: (query: { readonly active: true }) => Promise<readonly ManualPlaybackTab[]>;
  },
  getStreamContext: (tabId: number) => Promise<ManualStreamContext | null>,
): Promise<ManualPlaybackObservationResult> {
  let tabs: readonly ManualPlaybackTab[];
  try {
    tabs = await tabsApi.query({ active: true });
  } catch (error) {
    if (error instanceof Error) return { kind: 'failed' };
    throw error;
  }
  const observations: ManualPlaybackObservation[] = [];
  for (const tab of tabs) {
    if (
      typeof tab.id !== 'number' ||
      tab.active !== true ||
      !tab.url ||
      !/^https?:\/\/([^/]*\.)?twitch\.tv\//i.test(tab.url)
    ) {
      continue;
    }
    let context: ManualStreamContext | null;
    try {
      context = await getStreamContext(tab.id);
    } catch (error) {
      if (error instanceof Error) return { kind: 'failed' };
      throw error;
    }
    observations.push({ tab, context });
  }
  return { kind: 'observed', tabs: observations };
}

interface PlaybackState {
  readonly appState: {
    tabId: number | null;
    activeStreamer: TwitchStreamer | null;
  };
  invalidStreamChecks: number;
  streamValidationGraceUntil: number;
}

interface PlaybackOrchestratorOptions {
  readonly transport: PlaybackTransport;
  readonly attention: PlaybackAttentionPolicy;
  readonly streamerWatchUrl: (channelName: string) => string;
  readonly now?: () => number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createPlaybackOrchestrator(state: PlaybackState, options: PlaybackOrchestratorOptions) {
  const now = () => options.now?.() ?? Date.now();

  async function prepareStreamPlayback(
    tabId: number,
    preparation?: PlaybackPreparationOptions,
  ): Promise<PlaybackPrepResult> {
    return options.transport.prepare(tabId, preparation);
  }

  async function warnIfPlaybackNeedsAttention(tabId: number, prepared: PlaybackPrepResult): Promise<void> {
    if (prepared.gateDismissed) {
      await delay(700);
      const retried = await prepareStreamPlayback(tabId, {
        unmuteTab: true,
        muteAfterPrep: options.attention.muteAfterPreparation(),
      });
      await options.attention.notifyIfNeeded(retried);
      return;
    }
    await options.attention.notifyIfNeeded(prepared);
  }

  async function attemptPlaybackSelfHeal(tabId: number): Promise<void> {
    options.attention.beginAttempt();
    const prepared = await prepareStreamPlayback(tabId, {
      unmuteTab: true,
      muteAfterPrep: options.attention.muteAfterPreparation(),
    });
    await warnIfPlaybackNeedsAttention(tabId, prepared);
  }

  async function openForegroundChannel(
    streamer: TwitchStreamer,
    openOptions?: { readonly focus?: boolean },
  ): Promise<number | null> {
    const channelName = streamer.name.toLowerCase();
    const displayName = streamer.displayName || channelName;
    const targetUrl = options.streamerWatchUrl(channelName);
    const isStreamerChange =
      !state.appState.activeStreamer || state.appState.activeStreamer.name !== channelName;
    const shouldFocus = isStreamerChange && openOptions?.focus !== false;
    const managedTabId = await options.transport.openManaged(state.appState.tabId, targetUrl, shouldFocus);
    if (managedTabId === null) return null;
    const tabId = managedTabId;

    async function prepareVisiblePlayback(): Promise<void> {
      options.attention.beginAttempt();
      const prepared = await options.transport.prepareVisible(tabId, {
        focus: shouldFocus,
        muteAfterPrep: options.attention.muteAfterPreparation(),
      });
      await warnIfPlaybackNeedsAttention(tabId, prepared);
    }

    void prepareVisiblePlayback().catch(() => undefined);
    state.appState.tabId = tabId;
    state.appState.activeStreamer = {
      id: channelName,
      name: channelName,
      displayName,
      isLive: true,
      viewerCount: streamer.viewerCount,
    };
    state.invalidStreamChecks = 0;
    state.streamValidationGraceUntil = now() + STREAM_VALIDATION_GRACE_MS;
    return tabId;
  }

  async function enforcePlaybackPolicyOnStreamTab(): Promise<void> {
    const tabId = state.appState.tabId;
    if (tabId === null || now() >= state.streamValidationGraceUntil) return;
    if (!(await options.transport.hasTab(tabId))) return;
    const prepared = await prepareStreamPlayback(tabId, {
      muteAfterPrep: options.attention.muteAfterPreparation(),
    });
    await warnIfPlaybackNeedsAttention(tabId, prepared);
  }

  return {
    attemptPlaybackSelfHeal,
    enforcePlaybackPolicyOnStreamTab,
    openForegroundChannel,
    prepareStreamPlayback,
  };
}
