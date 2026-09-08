import type { FarmingSessionTransitionReceiptV1 } from '../../src/background/farming-automation-contracts.ts';
import type { TwitchDrop, TwitchGame } from '../../src/types/index.ts';

export function transitionReceipt(): FarmingSessionTransitionReceiptV1 {
  return {
    version: 1,
    attemptId: 'attempt-a-b',
    transition: 'preemption',
    fromCampaignKey: 'campaign-a',
    toCampaignKey: 'campaign-b',
    toStreamerName: 'streamer-b',
    committedAt: 1_750_000_000_000,
    sessionRevision: 'revision-1',
    fromWatch: { kind: 'tabless', targetKey: 'campaign-a:streamer-a' },
    toWatch: { kind: 'tabless', targetKey: 'campaign-b:streamer-b' },
    cleanup: { kind: 'not-required' },
  };
}

export function game(id: string, campaignId: string): TwitchGame {
  return { id, campaignId, name: id, imageUrl: `https://example.test/${id}.jpg` };
}

export function drop(id: string, campaignId: string): TwitchDrop {
  return {
    id,
    campaignId,
    name: id,
    gameId: id,
    gameName: id,
    imageUrl: `https://example.test/${id}.jpg`,
    progress: 0,
    currentMinutes: 0,
    claimed: false,
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
  };
}
