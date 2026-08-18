import type { FarmingAutomationTwitchSnapshot } from '../../src/background/farming-automation-twitch.ts';
import type {
  ProvisionalWatchCandidate,
  WatchOwnershipV1,
} from '../../src/background/watch-transport-transition.ts';
import { gameKey } from '../../src/shared/game-selection.ts';
import type { TwitchDrop, TwitchGame, TwitchStreamer } from '../../src/types/index.ts';

export const incumbent: TwitchGame = {
  id: 'game-a',
  name: 'Game A',
  imageUrl: 'a.png',
  campaignId: 'campaign-a',
};
export const candidate: TwitchGame = {
  id: 'game-b',
  name: 'Game B',
  imageUrl: 'b.png',
  campaignId: 'campaign-b',
};
export const streamer: TwitchStreamer = {
  id: 'streamer-b',
  name: 'channel-b',
  displayName: 'Channel B',
  isLive: true,
};
const drop: TwitchDrop = {
  id: 'drop-b',
  name: 'Reward B',
  gameId: 'game-b',
  gameName: 'Game B',
  imageUrl: 'drop.png',
  progress: 0,
  currentMinutes: 0,
  claimed: false,
  campaignId: 'campaign-b',
  acquisitionMethod: 'watch-time',
  rewardKind: 'in-game',
  verificationState: 'unassessed',
};
export const fromWatch: WatchOwnershipV1 = {
  kind: 'managed-tab',
  tabId: 11,
  ownershipToken: 'owned-a',
  expectedChannel: 'channel-a',
};

export function snapshot(): FarmingAutomationTwitchSnapshot {
  return {
    games: [incumbent, candidate],
    drops: [drop],
    campaignDropsByKey: { [gameKey(candidate)]: [drop] },
    campaignChannelsMap: { 'campaign-b': null },
    updatedAt: 1_000,
  };
}

export function unhealthyCandidate(
  mode: 'tabless' | 'managed-tab',
  ownership: WatchOwnershipV1,
  disposals: string[],
): ProvisionalWatchCandidate {
  return {
    target: { gameId: 'game-b', campaignId: 'campaign-b', channelName: 'channel-b' },
    ownership,
    health: {
      mode,
      isHealthy: false,
      status: 'failed',
      reason: 'heartbeat-failed',
      consecutiveFailures: 1,
      consecutiveStalls: 0,
      progress: null,
      shouldFallback: true,
      checkedAt: 1,
    },
    dispose: async () => {
      disposals.push(mode);
    },
  };
}
