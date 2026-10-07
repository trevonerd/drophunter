import { getFarmableTwitchChannelNameFromUrl } from '../shared/twitch-url.ts';
import type { PlaybackPrepResult, TwitchStreamer } from '../types/index.ts';
import { STREAM_VALIDATION_GRACE_MS } from './constants.ts';
import { currentFarmingSessionEpoch } from './farming-session-revision.ts';
import type { ManualStreamContext, ManualWatchTab } from './manual-watch-detector.ts';
import type { PlaybackPreparationOptions, PlaybackTransport } from './playback-transport.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

export type ManualPlaybackTab = ManualWatchTab & {
  readonly windowId?: number;
};

export type ManualPlaybackObservation = {
  readonly tab: ManualPlaybackTab;
  readonly context: ManualStreamContext;
};

export type ManualPlaybackObservationResult =
  | {
      readonly kind: 'observed';
      readonly tabs: readonly ManualPlaybackObservation[];
    }
  | { readonly kind: 'failed' };

export async function observeManualPlayback(
  tabsApi: {
    readonly query: (query: { readonly active?: boolean }) => Promise<readonly ManualPlaybackTab[]>;
  },
  getStreamContext: (tabId: number) => Promise<ManualStreamContext | null>,
  managedTabId: number | null = null,
  resolveManagedTabIds?: () => Promise<readonly number[] | null>,
): Promise<ManualPlaybackObservationResult> {
  let tabs: readonly ManualPlaybackTab[];
  let managedTabIds: readonly number[];
  try {
    tabs = await tabsApi.query({});
    const resolved = resolveManagedTabIds ? await resolveManagedTabIds() : [];
    if (resolved === null) return { kind: 'failed' };
    managedTabIds = resolved;
  } catch (error) {
    if (error instanceof Error) return { kind: 'failed' };
    throw error;
  }
  const observations: ManualPlaybackObservation[] = [];
  for (const tab of tabs) {
    if (
      typeof tab.id !== 'number' ||
      tab.id === managedTabId ||
      managedTabIds.includes(tab.id) ||
      getFarmableTwitchChannelNameFromUrl(tab.url) === null
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
    if (context === null) return { kind: 'failed' };
    observations.push({ tab, context });
  }
  return {
    kind: 'observed',
    tabs: observations.sort((left, right) => {
      const recency = (right.tab.lastAccessed ?? 0) - (left.tab.lastAccessed ?? 0);
      if (recency !== 0) return recency;
      return Number(right.tab.active === true) - Number(left.tab.active === true);
    }),
  };
}

interface PlaybackOrchestratorOptions {
  readonly transport: PlaybackTransport;
  readonly shouldMuteManagedFarmingTab: () => boolean;
  readonly streamerWatchUrl: (channelName: string) => string;
  readonly now?: () => number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createPlaybackOrchestrator(state: ServiceWorkerState, options: PlaybackOrchestratorOptions) {
  const now = () => options.now?.() ?? Date.now();

  function farmingPlaybackGuard(externalIsCurrent: () => boolean = () => true): () => boolean {
    const epoch = currentFarmingSessionEpoch(state);
    const tick = state.tickGeneration;
    return () =>
      externalIsCurrent() &&
      currentFarmingSessionEpoch(state) === epoch &&
      state.tickGeneration === tick &&
      state.appState.isRunning &&
      !state.appState.isPaused &&
      state.appState.lastStopReason !== 'user-stop';
  }

  async function prepareStreamPlayback(
    tabId: number,
    preparation?: PlaybackPreparationOptions,
  ): Promise<PlaybackPrepResult> {
    return options.transport.prepare(tabId, preparation);
  }

  async function warnIfPlaybackNeedsAttention(
    tabId: number,
    prepared: PlaybackPrepResult,
    isCurrent: () => boolean = () => true,
  ): Promise<void> {
    if (!isCurrent()) return;
    if (prepared.gateDismissed) {
      await delay(700);
      if (!isCurrent()) return;
      await prepareStreamPlayback(tabId, {
        unmuteTab: false,
        muteAfterPrep: options.shouldMuteManagedFarmingTab(),
        isCurrent,
      });
      return;
    }
  }

  async function attemptPlaybackSelfHeal(
    tabId: number,
    externalIsCurrent: () => boolean = () => true,
  ): Promise<void> {
    const isCurrent = farmingPlaybackGuard(externalIsCurrent);
    if (!isCurrent()) return;
    const prepared = await prepareStreamPlayback(tabId, {
      unmuteTab: false,
      muteAfterPrep: options.shouldMuteManagedFarmingTab(),
      isCurrent,
    });
    await warnIfPlaybackNeedsAttention(tabId, prepared, isCurrent);
  }

  async function openForegroundChannel(
    streamer: TwitchStreamer,
    openOptions?: { readonly focus?: boolean },
  ): Promise<number | null> {
    const isCurrent = farmingPlaybackGuard();
    if (!isCurrent()) return null;
    const channelName = streamer.name.toLowerCase();
    const displayName = streamer.displayName || channelName;
    const targetUrl = options.streamerWatchUrl(channelName);
    const isStreamerChange =
      !state.appState.activeStreamer || state.appState.activeStreamer.name !== channelName;
    const shouldFocus = isStreamerChange && openOptions?.focus !== false;
    const managedTabId = await options.transport.openManaged(
      state.appState.tabId,
      targetUrl,
      shouldFocus,
      isCurrent,
    );
    if (managedTabId === null || !isCurrent()) return null;
    const tabId = managedTabId;

    async function prepareVisiblePlayback(): Promise<void> {
      const prepared = await options.transport.prepareVisible(tabId, {
        focus: shouldFocus,
        muteAfterPrep: options.shouldMuteManagedFarmingTab(),
        isCurrent,
      });
      await warnIfPlaybackNeedsAttention(tabId, prepared, isCurrent);
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
    const isCurrent = farmingPlaybackGuard(() => state.appState.tabId === tabId);
    if (!isCurrent() || tabId === null || now() >= state.streamValidationGraceUntil) return;
    if (!(await options.transport.hasTab(tabId)) || !isCurrent()) return;
    const prepared = await prepareStreamPlayback(tabId, {
      muteAfterPrep: options.shouldMuteManagedFarmingTab(),
      isCurrent,
    });
    await warnIfPlaybackNeedsAttention(tabId, prepared, isCurrent);
  }

  return {
    attemptPlaybackSelfHeal,
    enforcePlaybackPolicyOnStreamTab,
    openForegroundChannel,
    prepareStreamPlayback,
  };
}
