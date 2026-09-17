import { expect, test } from 'bun:test';
import { createFarmingSession } from '../../src/background/farming-session.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';
import { createFarmingSessionManualWatchFixture } from '../support/farming-session-manual-watch.ts';
import {
  createWatchHealth,
  createWatchTransportAdapters,
  createWatchTransportState,
  watchTransportGame as game,
  watchTransportStreamer as streamer,
} from '../support/farming-session-watch-transport.ts';

export function registerManualWatchTransportCases(getChromeMocks: () => ChromeMocks) {
  test('suspends, preserves suspension on observation failure, and resumes after playback ends', async () => {
    const chromeMocks = getChromeMocks();
    const state = createWatchTransportState();
    state.appState.selectedGame = game;
    state.appState.isRunning = true;
    state.appState.activeStreamer = streamer;
    state.appState.tabId = 7;
    let manualPlayback = true;
    let observationFails = false;
    let currentTime = 1_000;
    let starts = 0;
    let ticks = 0;
    let stops = 0;
    let refreshes = 0;
    const automationEvents: Array<{ event: string; transitionId: string }> = [];
    const health = createWatchHealth('managed-tab');
    const watchTransport = {
      start: async () => {
        starts += 1;
        state.appState.tabId = 7;
        return health;
      },
      tick: async () => {
        ticks += 1;
        return health;
      },
      stop: async () => {
        stops += 1;
        state.appState.tabId = null;
      },
      setPreference: async () => {},
    };
    chromeMocks.tabs.setTabsQueryResult([{ id: 4, active: true, url: 'https://www.twitch.tv/manual' }]);
    chromeMocks.tabs.setTabsGetResult({ id: 7, url: 'https://www.twitch.tv/channel-1' });
    const manualWatchController = createFarmingSessionManualWatchFixture(
      state,
      async () => {
        if (observationFails) return { kind: 'failed' };
        return {
          kind: 'observed',
          tabs: manualPlayback
            ? [
                {
                  tab: { id: 4, active: false, url: 'https://www.twitch.tv/manual' },
                  context: {
                    channelName: 'manual',
                    categorySlug: 'game',
                    isLive: true,
                    isPlaybackReady: true,
                    hasDropsEnabled: true,
                  },
                },
              ]
            : [],
        };
      },
      () => currentTime,
    );
    const session = createFarmingSession(
      state,
      createWatchTransportAdapters({
        fetchDropsSnapshotFromApi: async () => {
          refreshes += 1;
          return null;
        },
        fetchInventorySnapshotFromApi: async () => {
          refreshes += 1;
          return null;
        },
        fetchDirectoryStreamersFromApi: async () =>
          Object.assign([streamer], { languageFilterApplied: true }),
        fetchStreamContext: async () => {
          if (observationFails) throw new DOMException('Injected observation failure', 'ObservationError');
          return manualPlayback
            ? {
                channelName: 'manual',
                categorySlug: 'game',
                categoryLabel: 'Game',
                streamTitle: 'Drops enabled',
                titleContainsDrops: true,
                hasDropsSignal: true,
                isLive: true,
                videoCount: 1,
                playingVideoCount: 1,
                isPlaybackReady: true,
                pageUrl: 'https://www.twitch.tv/manual',
              }
            : null;
        },
        manualWatchController,
        watchTransport,
        automationNotify: async (notification) => {
          automationEvents.push({ event: notification.event, transitionId: notification.transitionId });
        },
      }),
    );

    await watchTransport.start(streamer);
    await session.checkDropProgress();
    expect(state.appState.manualWatchState).toBe('eligible-manual');
    expect({ starts, stops, ticks }).toEqual({ starts: 1, stops: 1, ticks: 0 });
    expect(automationEvents).toEqual([
      { event: 'manual-suspended', transitionId: 'manual-suspended:campaign-1:1000' },
    ]);
    const refreshesDuringManualPlayback = refreshes;
    expect(refreshesDuringManualPlayback).toBeGreaterThan(0);

    await session.checkDropProgress();
    expect({ starts, stops, ticks }).toEqual({ starts: 1, stops: 1, ticks: 0 });
    observationFails = true;
    await session.checkDropProgress();
    expect(state.appState.manualWatchState).toBe('eligible-manual');
    expect({ starts, stops, ticks }).toEqual({ starts: 1, stops: 1, ticks: 0 });

    observationFails = false;
    manualPlayback = false;
    chromeMocks.tabs.setTabsQueryResult([]);
    currentTime = 5_000;
    await session.checkDropProgress();
    expect(state.appState.manualWatchState).toBe('inactive');
    expect({ starts, stops, ticks, refreshes }).toEqual({
      starts: 2,
      stops: 1,
      ticks: 0,
      refreshes: refreshesDuringManualPlayback,
    });
    expect(automationEvents).toEqual([
      { event: 'manual-suspended', transitionId: 'manual-suspended:campaign-1:1000' },
      { event: 'manual-resumed', transitionId: 'manual-resumed:campaign-1:5000' },
    ]);
    await session.checkDropProgress();
    expect(ticks).toBe(1);
    await session.handleStopFarming();
    chromeMocks.tabs.setTabsQueryResult([]);
  });
}
