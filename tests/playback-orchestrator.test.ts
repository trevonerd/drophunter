import { describe, expect, test } from 'bun:test';
import { createPlaybackOrchestrator } from '../src/background/playback-orchestrator.ts';
import { createInitialState } from '../src/shared/utils.ts';
import type { PlaybackPrepResult, TwitchStreamer } from '../src/types';

function createState() {
  return {
    appState: createInitialState(),
    playbackAttentionWarningSent: false,
    invalidStreamChecks: 3,
    streamValidationGraceUntil: 0,
  };
}

function createTabsApi() {
  const updates: Array<{ tabId: number; properties: unknown }> = [];
  return {
    updates,
    async get(tabId: number) {
      return { id: tabId, windowId: 5 };
    },
    async update(tabId: number, properties: unknown) {
      updates.push({ tabId, properties });
      return { id: tabId, windowId: 5 };
    },
    async sendMessage() {
      return {};
    },
  };
}

const streamer: TwitchStreamer = {
  id: 'StreamerOne',
  name: 'StreamerOne',
  displayName: 'Streamer One',
  isLive: true,
  viewerCount: 12,
};

describe('playback orchestrator', () => {
  test('opening a foreground channel claims tab ownership and resets stream validation state', async () => {
    const state = createState();
    const tabsApi = createTabsApi();
    const openedUrls: string[] = [];
    const orchestrator = createPlaybackOrchestrator(state, {
      tabsApi,
      windowsApi: { update: async () => null },
      ensureContentScriptOnTab: async () => {},
      ensureManagedTab: async (_existingTabId, url) => {
        openedUrls.push(url);
        return 77;
      },
      waitForTabComplete: async () => {},
      shouldMuteManagedFarmingTab: () => true,
      needsPlaybackAttention: () => false,
      notify: async () => {},
      streamerWatchUrl: (channelName) => `https://www.twitch.tv/${channelName}`,
      now: () => 1_000,
    });

    await orchestrator.openForegroundChannel(streamer);
    await Promise.resolve();

    expect(openedUrls).toEqual(['https://www.twitch.tv/streamerone']);
    expect(state.appState.tabId).toBe(77);
    expect(state.appState.activeStreamer?.name).toBe('streamerone');
    expect(state.invalidStreamChecks).toBe(0);
    expect(state.streamValidationGraceUntil).toBeGreaterThan(1_000);
  });

  test('self-heal can send a fresh attention notification for each recovery attempt', async () => {
    const state = createState();
    const notifications: string[] = [];
    const orchestrator = createPlaybackOrchestrator(state, {
      tabsApi: createTabsApi(),
      windowsApi: { update: async () => null },
      ensureContentScriptOnTab: async () => {},
      ensureManagedTab: async () => 1,
      waitForTabComplete: async () => {},
      shouldMuteManagedFarmingTab: () => false,
      needsPlaybackAttention: (_result: PlaybackPrepResult) => true,
      notify: async (title) => {
        notifications.push(title);
      },
      streamerWatchUrl: (channelName) => `https://www.twitch.tv/${channelName}`,
      now: () => 1_000,
    });

    await orchestrator.attemptPlaybackSelfHeal(77);
    await orchestrator.attemptPlaybackSelfHeal(77);

    expect(notifications).toEqual([
      'DropHunter needs your attention',
      'DropHunter needs your attention',
    ]);
    expect(state.playbackAttentionWarningSent).toBe(true);
  });
});
