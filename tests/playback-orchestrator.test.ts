import { describe, expect, test } from 'bun:test';
import { createPlaybackAttentionPolicy } from '../src/background/playback-attention-policy.ts';
import {
  createPlaybackOrchestrator,
  observeManualPlayback,
} from '../src/background/playback-orchestrator.ts';
import { createPlaybackTransport } from '../src/background/playback-transport.ts';
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
  test('treats an unavailable stream context as an observation failure', async () => {
    // Given: Twitch has a tab, but its content telemetry is unavailable.
    const result = await observeManualPlayback(
      {
        query: async () => [{ id: 4, active: false, url: 'https://www.twitch.tv/manual-channel' }],
      },
      async () => null,
    );

    // When: manual viewing is observed.
    // Then: automation retains its existing transport state instead of inferring a stopped stream.
    expect(result).toEqual({ kind: 'failed' });
  });

  test('ignores Drops and managed Twitch tabs before requesting manual stream telemetry', async () => {
    // Given: first-run Drops and managed farming tabs coexist with a personal channel.
    const observedTabIds: number[] = [];
    const result = await observeManualPlayback(
      {
        query: async () => [
          { id: 2, active: true, url: 'https://www.twitch.tv/drops/campaigns' },
          { id: 7, active: false, url: 'https://www.twitch.tv/farming-channel' },
          { id: 8, active: false, url: 'https://www.twitch.tv/personal-channel' },
        ],
      },
      async (tabId) => {
        observedTabIds.push(tabId);
        return {
          channelName: 'personal-channel',
          isLive: true,
          isPlaybackReady: true,
        };
      },
      7,
    );

    // When: manual playback is observed.
    // Then: only the plausible unmanaged channel is probed and retained.
    expect(observedTabIds).toEqual([8]);
    expect(result).toEqual({
      kind: 'observed',
      tabs: [
        {
          tab: { id: 8, active: false, url: 'https://www.twitch.tv/personal-channel' },
          context: { channelName: 'personal-channel', isLive: true, isPlaybackReady: true },
        },
      ],
    });
  });

  test('coordinates recovery through the transport and attention seams', async () => {
    const events: string[] = [];
    const orchestrator = createPlaybackOrchestrator(createState(), {
      transport: {
        async openManaged() {
          return 77;
        },
        async hasTab() {
          return true;
        },
        async prepare(tabId) {
          events.push(`prepare:${tabId}`);
          return { isPlaybackReady: false, gateDismissed: false };
        },
        async prepareVisible() {
          return { isPlaybackReady: true, gateDismissed: false };
        },
      },
      attention: {
        beginAttempt() {
          events.push('attention:begin');
        },
        muteAfterPreparation() {
          return false;
        },
        async notifyIfNeeded(prepared) {
          events.push(`attention:${prepared.isPlaybackReady ? 'ready' : 'needed'}`);
        },
      },
      streamerWatchUrl: (channelName) => `https://www.twitch.tv/${channelName}`,
      now: () => 1_000,
    });

    await orchestrator.attemptPlaybackSelfHeal(77);

    expect(events).toEqual(['attention:begin', 'prepare:77', 'attention:needed']);
  });

  test('opening a foreground channel claims tab ownership and resets stream validation state', async () => {
    const state = createState();
    const tabsApi = createTabsApi();
    const openedUrls: string[] = [];
    const orchestrator = createPlaybackOrchestrator(state, {
      transport: createPlaybackTransport({
        tabsApi,
        windowsApi: { update: async () => null },
        ensureContentScriptOnTab: async () => {},
        ensureManagedTab: async (_existingTabId, url) => {
          openedUrls.push(url);
          return 77;
        },
        waitForTabComplete: async () => {},
      }),
      attention: createPlaybackAttentionPolicy(state, {
        shouldMuteManagedFarmingTab: () => true,
        needsPlaybackAttention: () => false,
        notify: async () => {},
      }),
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
      transport: createPlaybackTransport({
        tabsApi: createTabsApi(),
        windowsApi: { update: async () => null },
        ensureContentScriptOnTab: async () => {},
        ensureManagedTab: async () => 1,
        waitForTabComplete: async () => {},
      }),
      attention: createPlaybackAttentionPolicy(state, {
        shouldMuteManagedFarmingTab: () => false,
        needsPlaybackAttention: (_result: PlaybackPrepResult) => true,
        notify: async (title) => {
          notifications.push(title);
        },
      }),
      streamerWatchUrl: (channelName) => `https://www.twitch.tv/${channelName}`,
      now: () => 1_000,
    });

    await orchestrator.attemptPlaybackSelfHeal(77);
    await orchestrator.attemptPlaybackSelfHeal(77);

    expect(notifications).toEqual(['DropHunter needs your attention', 'DropHunter needs your attention']);
    expect(state.playbackAttentionWarningSent).toBe(true);
  });
});
