import { describe, expect, test } from 'bun:test';
import type { FarmingSessionTransitionReceiptV1 } from '../src/background/farming-automation-contracts.ts';
import type { FarmingAutomationTwitchSnapshot } from '../src/background/farming-automation-twitch.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { transitionAutomaticFarmingSession } from '../src/background/session-lifecycle.ts';
import {
  createWatchTransportTransition,
  type ProvisionalWatchCandidate,
  type WatchOwnershipV1,
} from '../src/background/watch-transport-transition.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import type { TwitchDrop, TwitchGame, TwitchStreamer } from '../src/types/index.ts';

const incumbent: TwitchGame = {
  id: 'game-a',
  name: 'Game A',
  imageUrl: 'a.png',
  campaignId: 'campaign-a',
};
const candidate: TwitchGame = {
  id: 'game-b',
  name: 'Game B',
  imageUrl: 'b.png',
  campaignId: 'campaign-b',
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
const fromWatch: WatchOwnershipV1 = {
  kind: 'managed-tab',
  tabId: 11,
  ownershipToken: 'owned-a',
  expectedChannel: 'channel-a',
};

function snapshot(): FarmingAutomationTwitchSnapshot {
  return {
    games: [incumbent, candidate],
    drops: [drop],
    campaignDropsByKey: { [gameKey(candidate)]: [drop] },
    campaignChannelsMap: { 'campaign-b': null },
    updatedAt: 1_000,
  };
}

function unhealthyCandidate(
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

describe('automatic farming session tabless transition', () => {
  test('starts from idle ownership without false supersession', async () => {
    // Given: an idle Session with no incumbent watch and a viable managed candidate.
    const state = createServiceWorkerState();
    const watch = createWatchTransportTransition({
      currentOwnership: null,
      prepareTabless: async () => null,
      prepareManaged: async () => ({
        target: { gameId: 'game-b', campaignId: 'campaign-b', channelName: 'channel-b' },
        ownership: {
          kind: 'managed-tab',
          tabId: 22,
          ownershipToken: 'owned-b',
          expectedChannel: 'channel-b',
        },
        health: {
          mode: 'managed-tab',
          isHealthy: true,
          status: 'healthy',
          reason: 'heartbeat',
          consecutiveFailures: 0,
          consecutiveStalls: 0,
          progress: 0,
          shouldFallback: false,
          checkedAt: 1,
        },
        dispose: async () => undefined,
      }),
      release: async () => ({ kind: 'not-required' }),
    });

    // When: Session lifecycle starts B from the idle state.
    const result = await transitionAutomaticFarmingSession(
      state,
      {
        attemptId: 'attempt-idle',
        transition: 'start',
        fromCampaignKey: null,
        candidate,
        snapshot: snapshot(),
        watchMode: 'managed-tab',
        expectedFingerprint: 'fingerprint-a',
      },
      {
        acquireStreamer: async () => streamer,
        currentFingerprint: () => 'fingerprint-a',
        loadReceipt: async () => ({ kind: 'ready', source: 'missing', value: null }),
        commitTransition: async () => ({ kind: 'committed' }),
        watch,
        now: () => 2_000,
      },
    );

    // Then: null incumbent ownership is stable and B commits normally.
    expect(result.kind).toBe('committed');
  });

  test('records no cleanup requirement for obsolete tabless ownership', async () => {
    // Given: running tabless A and a separately healthy tabless B.
    const state = createServiceWorkerState();
    state.appState.selectedGame = incumbent;
    state.appState.isRunning = true;
    const incumbentOwnership: WatchOwnershipV1 = { kind: 'tabless', targetKey: gameKey(incumbent) };
    let receipt: FarmingSessionTransitionReceiptV1 | null = null;
    const watch = createWatchTransportTransition({
      currentOwnership: incumbentOwnership,
      prepareTabless: async () => ({
        target: { gameId: 'game-b', campaignId: 'campaign-b', channelName: 'channel-b' },
        ownership: { kind: 'tabless', targetKey: gameKey(candidate) },
        health: {
          mode: 'tabless',
          isHealthy: true,
          status: 'healthy',
          reason: 'heartbeat',
          consecutiveFailures: 0,
          consecutiveStalls: 0,
          progress: 0,
          shouldFallback: false,
          checkedAt: 1,
        },
        dispose: async () => undefined,
      }),
      prepareManaged: async () => null,
      release: async () => ({ kind: 'not-required' }),
    });

    // When: the Session transition commits and promotes B.
    const result = await transitionAutomaticFarmingSession(
      state,
      {
        attemptId: 'attempt-tabless',
        transition: 'preemption',
        fromCampaignKey: gameKey(incumbent),
        candidate,
        snapshot: snapshot(),
        watchMode: 'tabless',
        expectedFingerprint: 'fingerprint-a',
      },
      {
        acquireStreamer: async () => streamer,
        currentFingerprint: () => 'fingerprint-a',
        loadReceipt: async () => ({ kind: 'ready', source: 'missing', value: null }),
        commitTransition: async (commit) => {
          receipt = commit.receipt;
          return { kind: 'committed' };
        },
        watch,
        now: () => 2_000,
      },
    );

    // Then: obsolete tabless A is historical ownership but requires no cleanup reconciliation.
    expect({ result: result.kind, cleanup: receipt?.cleanup }).toEqual({
      result: 'committed',
      cleanup: { kind: 'not-required' },
    });
  });

  test.each([
    ['unhealthy heartbeat', true, ['tabless', 'managed-tab']],
    ['disabled heartbeat', false, ['managed-tab']],
  ])('preserves incumbent when tabless %s and managed fallback fail', async (_name, enabled, expectedDisposals) => {
    // Given: incumbent A and a tabless B whose single managed fallback is also unhealthy.
    const state = createServiceWorkerState();
    state.appState.selectedGame = incumbent;
    state.appState.isRunning = true;
    state.appState.activeStreamer = { ...streamer, name: 'channel-a' };
    state.appState.tabId = 11;
    state.appState.queue = [incumbent];
    state.invalidStreamChecks = 2;
    const before = JSON.stringify(state);
    const disposals: string[] = [];
    let commitCount = 0;
    const watch = createWatchTransportTransition({
      currentOwnership: fromWatch,
      prepareTabless: async () =>
        enabled
          ? unhealthyCandidate('tabless', { kind: 'tabless', targetKey: 'campaign:campaign-b' }, disposals)
          : null,
      prepareManaged: async () =>
        unhealthyCandidate(
          'managed-tab',
          {
            kind: 'managed-tab',
            tabId: 22,
            ownershipToken: 'owned-b',
            expectedChannel: 'channel-b',
          },
          disposals,
        ),
      release: async () => ({ kind: 'abandoned-unproven' }),
    });

    // When: Session lifecycle tries the isolated tabless preparation and its one fallback.
    const result = await transitionAutomaticFarmingSession(
      state,
      {
        attemptId: `attempt-${_name}`,
        transition: 'preemption',
        fromCampaignKey: gameKey(incumbent),
        candidate,
        snapshot: snapshot(),
        watchMode: 'tabless',
        expectedFingerprint: 'fingerprint-a',
      },
      {
        acquireStreamer: async () => streamer,
        currentFingerprint: () => 'fingerprint-a',
        loadReceipt: async () => ({ kind: 'ready', source: 'missing', value: null }),
        commitTransition: async () => {
          commitCount += 1;
          return { kind: 'committed' };
        },
        watch,
        now: () => 2_000,
      },
    );

    // Then: A remains byte-identical and only B candidates were disposed before any commit.
    expect({ result, after: JSON.stringify(state), disposals, commitCount }).toEqual({
      result: { kind: 'failed', reason: 'candidate-preparation-failed' },
      after: before,
      disposals: expectedDisposals,
      commitCount: 0,
    });
  });
});
