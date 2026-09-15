import type {
  FarmingSessionTransitionReceiptV1,
  WatchOwnershipV1,
} from '../../src/background/farming-automation-contracts.ts';
import type { FarmingAutomationTwitchSnapshot } from '../../src/background/farming-automation-twitch.ts';
import { createServiceWorkerState, type ServiceWorkerState } from '../../src/background/runtime-state.ts';
import type {
  AutomaticFarmingSessionTransitionDependencies,
  AutomaticFarmingSessionTransitionRequest,
} from '../../src/background/session-lifecycle.ts';
import { gameKey } from '../../src/shared/game-selection.ts';
import type { TwitchDrop, TwitchGame, TwitchStreamer } from '../../src/types/index.ts';

const incumbent: TwitchGame = {
  id: 'duplicate-game',
  name: 'Duplicate Game',
  imageUrl: 'a.png',
  campaignId: 'campaign-a',
};
const candidate: TwitchGame = {
  id: 'duplicate-game',
  name: 'Duplicate Game',
  imageUrl: 'b.png',
  campaignId: 'campaign-b',
};
export const manualWinner: TwitchGame = {
  id: 'manual-game',
  name: 'Manual Game',
  imageUrl: 'manual.png',
  campaignId: 'campaign-manual',
};
const streamer: TwitchStreamer = {
  id: 'streamer-b',
  name: 'channel-b',
  displayName: 'Channel B',
  isLive: true,
};
const drop: TwitchDrop = {
  id: 'drop-b',
  name: 'Reward B',
  gameId: 'duplicate-game',
  gameName: 'Duplicate Game',
  imageUrl: '',
  progress: 10,
  currentMinutes: 5,
  claimed: false,
  campaignId: 'campaign-b',
  acquisitionMethod: 'watch-time',
  rewardKind: 'in-game',
  verificationState: 'unassessed',
};
const fromWatch: WatchOwnershipV1 = {
  kind: 'managed-tab',
  tabId: 11,
  ownershipToken: 'owned-a',
  expectedChannel: 'channel-a',
};
const toWatch: WatchOwnershipV1 = {
  kind: 'managed-tab',
  tabId: 22,
  ownershipToken: 'owned-b',
  expectedChannel: 'channel-b',
};

export function createIncumbentState(): ServiceWorkerState {
  const state = createServiceWorkerState();
  state.appState.selectedGame = incumbent;
  state.appState.isRunning = true;
  state.appState.activeStreamer = { ...streamer, name: 'channel-a' };
  state.appState.tabId = 11;
  state.appState.queue = [incumbent];
  return state;
}

function snapshot(): FarmingAutomationTwitchSnapshot {
  return {
    games: [incumbent, candidate],
    drops: [drop],
    campaignDropsByKey: { [gameKey(candidate)]: [drop] },
    campaignChannelsMap: {},
    updatedAt: 1,
  };
}

export function request(
  overrides: Partial<AutomaticFarmingSessionTransitionRequest> = {},
): AutomaticFarmingSessionTransitionRequest {
  return {
    attemptId: 'attempt-b',
    transition: 'preemption',
    fromCampaignKey: gameKey(incumbent),
    candidate,
    snapshot: snapshot(),
    watchMode: 'managed-tab',
    expectedFingerprint: 'fingerprint-a',
    ...overrides,
  };
}

type DependencyOverrides = {
  readonly loadReceipt?: AutomaticFarmingSessionTransitionDependencies['loadReceipt'];
  readonly commitTransition?: AutomaticFarmingSessionTransitionDependencies['commitTransition'];
};

export function dependenciesFor(
  state: ServiceWorkerState,
  events: string[],
  overrides: DependencyOverrides = {},
): AutomaticFarmingSessionTransitionDependencies {
  return {
    acquireStreamer: async () => {
      events.push('acquire');
      return streamer;
    },
    currentFingerprint: () => 'fingerprint-a',
    loadReceipt: overrides.loadReceipt ?? (async () => ({ kind: 'ready', source: 'missing', value: null })),
    commitTransition:
      overrides.commitTransition ??
      (async (commit) => {
        events.push('commit');
        state.appState = structuredClone(commit.nextAppState);
        state.cachedDropsSnapshot = structuredClone(commit.nextDropsSnapshot);
        events.push('publish');
        return { kind: 'committed' };
      }),
    watch: {
      currentOwnership: () => fromWatch,
      prepare: async () => {
        events.push('prepare');
        return {
          kind: 'prepared',
          watch: {
            target: { gameId: 'duplicate-game', campaignId: 'campaign-b', channelName: 'channel-b' },
            ownership: toWatch,
            health: {
              mode: 'managed-tab',
              isHealthy: true,
              status: 'healthy',
              reason: 'heartbeat',
              consecutiveFailures: 0,
              consecutiveStalls: 0,
              progress: null,
              shouldFallback: false,
              checkedAt: 1,
            },
            promote: () => {
              events.push('promote');
              return { kind: 'promoted', ownership: toWatch, obsolete: fromWatch };
            },
            dispose: async () => {
              events.push('dispose');
            },
          },
        };
      },
      release: async () => ({ kind: 'abandoned-unproven' }),
    },
    now: () => 2_000,
  };
}

export function persistedReceipt(): FarmingSessionTransitionReceiptV1 {
  return {
    version: 1,
    attemptId: 'attempt-b',
    transition: 'preemption',
    fromCampaignKey: gameKey(incumbent),
    toCampaignKey: gameKey(candidate),
    toStreamerName: streamer.name,
    committedAt: 2_000,
    sessionRevision: '0',
    fromWatch,
    toWatch,
    cleanup: { kind: 'pending', obsolete: fromWatch },
  };
}
