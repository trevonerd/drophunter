import { expect, test } from 'bun:test';
import { createFarmingAutomationBrowser } from '../src/background/farming-automation-browser.ts';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { transitionAutomaticFarmingSession } from '../src/background/session-lifecycle-transition.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import {
  createDrop,
  createFarmingSessionAdapters,
  createGame,
  createStreamer,
} from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { createDeferred } from './support/farming-automation-fixtures.ts';

test.each([
  'native-create',
  'native-update-sole',
  'native-update-user-changed',
  'page-load',
  'playback-prep',
  'tabless-heartbeat',
] as const)('public Stop prevents later automatic preparation effects while %s is pending', async (stage) => {
  const mocks = setupChromeMocks();
  const state = createServiceWorkerState();
  const game = createGame({
    campaignId: 'native-stop',
    rewardSummary: { completion: 'farmable', remainderReasons: [] },
  });
  const drop = createDrop({ gameId: game.id, campaignId: game.campaignId });
  state.appState.selectedGame = game;
  state.appState.queue = [game];
  state.appState.availableGames = [game];
  state.appState.allDrops = [drop];
  state.appState.pendingDrops = [drop];
  state.cachedDropsSnapshot = [drop];
  const entered = createDeferred<void>();
  const release = createDeferred<void>();
  const navigation: string[] = [];
  let currentUrl = 'about:blank';
  let playbackCalls = 0;
  let probeCalls = 0;
  let commits = 0;
  mocks.chrome.tabs.create = async (properties) => {
    if (stage === 'native-create') {
      entered.resolve(undefined);
      await release.promise;
    }
    return { id: 22, windowId: 4, url: properties.url, active: false };
  };
  mocks.chrome.tabs.update = async (tabId, properties) => {
    if (properties.url) {
      navigation.push(properties.url);
      currentUrl = properties.url;
    }
    if (stage.startsWith('native-update') && properties.url !== 'about:blank') {
      entered.resolve(undefined);
      await release.promise;
    }
    return { id: tabId, windowId: 4, url: currentUrl, active: false };
  };
  mocks.chrome.tabs.get = async () => ({
    id: 22,
    windowId: 4,
    url: currentUrl,
    active: stage === 'native-update-sole',
  });
  mocks.chrome.tabs.query = async () =>
    stage.startsWith('native-update')
      ? [{ id: 22, windowId: 4 }]
      : [
          { id: 22, windowId: 4 },
          { id: 23, windowId: 4 },
        ];
  const browser = createFarmingAutomationBrowser({
    getManualStreamContext: async () => null,
    createOwnershipToken: () => 'native-stop-owned',
    watch: {
      tablessEnabled: true,
      heartbeat: async () => {
        if (stage === 'tabless-heartbeat') {
          entered.resolve(undefined);
          await release.promise;
        }
        return { accepted: false };
      },
      waitForTabComplete: async () => {
        if (stage === 'page-load') {
          entered.resolve(undefined);
          await release.promise;
        }
      },
      preparePlayback: async () => {
        playbackCalls += 1;
        if (stage === 'playback-prep') {
          entered.resolve(undefined);
          await release.promise;
        }
        return { isPlaybackReady: true };
      },
      probeManaged: async () => {
        probeCalls += 1;
        return { accepted: true, isLive: true, sameChannel: true, sameGame: true };
      },
    },
  });
  const session = createFarmingSession(state, createFarmingSessionAdapters());
  const starting = transitionAutomaticFarmingSession(
    state,
    {
      attemptId: 'native-stop-attempt',
      transition: 'start',
      fromCampaignKey: null,
      candidate: game,
      watchMode: stage === 'tabless-heartbeat' ? 'tabless' : 'managed-tab',
      expectedFingerprint: 'current',
      snapshot: {
        games: [game],
        drops: [drop],
        updatedAt: Date.now(),
        campaignDropsByKey: { [gameKey(game)]: [drop] },
        campaignChannelsMap: {},
      },
    },
    {
      acquireStreamer: async () => createStreamer(),
      currentFingerprint: () => 'current',
      loadReceipt: async () => ({ kind: 'ready', value: null }),
      commitTransition: async () => {
        commits += 1;
        return { kind: 'committed' };
      },
      watch: browser.watch,
    },
  );
  try {
    await entered.promise;
    await session.handleStopFarming();
    if (stage === 'native-update-user-changed') currentUrl = 'https://www.twitch.tv/user-choice';
    const navigationBeforeRelease = [...navigation];
    release.resolve(undefined);
    await starting;
    if (stage === 'native-update-sole') {
      expect(currentUrl).toBe('about:blank');
      expect(navigation).toEqual([...navigationBeforeRelease, 'about:blank']);
    } else {
      expect(navigation).toEqual(navigationBeforeRelease);
      if (stage === 'native-update-user-changed')
        expect(currentUrl).toBe('https://www.twitch.tv/user-choice');
    }
    expect(playbackCalls).toBe(stage === 'playback-prep' ? 1 : 0);
    expect(probeCalls).toBe(0);
    expect(commits).toBe(0);
    expect(state.appState.isRunning).toBe(false);
  } finally {
    release.resolve(undefined);
    await starting;
    mocks.teardown();
  }
});
