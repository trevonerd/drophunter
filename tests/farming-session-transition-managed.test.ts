import { describe, expect, test } from 'bun:test';
import type {
  FarmingSessionTransitionCommit,
  WatchOwnershipV1,
} from '../src/background/farming-automation-contracts.ts';
import type { FarmingAutomationTwitchSnapshot } from '../src/background/farming-automation-twitch.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import {
  type AutomaticFarmingSessionTransitionDependencies,
  transitionAutomaticFarmingSession,
} from '../src/background/session-lifecycle.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import type { TwitchDrop, TwitchGame, TwitchStreamer } from '../src/types/index.ts';

const incumbent: TwitchGame = {
  id: 'shared-game',
  name: 'Shared Game',
  imageUrl: 'a.png',
  campaignId: 'campaign-a',
};

const candidate: TwitchGame = {
  id: 'shared-game',
  name: 'Shared Game',
  imageUrl: 'b.png',
  campaignId: 'campaign-b',
};

const candidateDrop: TwitchDrop = {
  id: 'drop-b',
  name: 'Reward B',
  gameId: 'shared-game',
  gameName: 'Shared Game',
  imageUrl: 'drop-b.png',
  progress: 25,
  currentMinutes: 15,
  claimed: false,
  campaignId: 'campaign-b',
  acquisitionMethod: 'watch-time',
  rewardKind: 'in-game',
  verificationState: 'unassessed',
};

const streamer: TwitchStreamer = {
  id: 'streamer-b',
  name: 'channel-b',
  displayName: 'Channel B',
  isLive: true,
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

function provisionalSnapshot(): FarmingAutomationTwitchSnapshot {
  return {
    games: [incumbent, candidate],
    drops: [candidateDrop],
    campaignDropsByKey: { [gameKey(candidate)]: [candidateDrop] },
    campaignChannelsMap: { 'campaign-b': ['channel-b'] },
    updatedAt: 4_000,
  };
}

describe('automatic farming session managed transition', () => {
  test('persists B and receipt before promoting or releasing A', async () => {
    // Given: running campaign A and a viable separately prepared managed watch for campaign B.
    const state = createServiceWorkerState();
    state.appState.selectedGame = incumbent;
    state.appState.isRunning = true;
    state.appState.activeStreamer = { ...streamer, id: 'streamer-a', name: 'channel-a' };
    state.appState.tabId = 11;
    state.appState.queue = [incumbent];
    const events: string[] = [];
    const writes: FarmingSessionTransitionCommit[] = [];
    let ownership: WatchOwnershipV1 | null = fromWatch;
    const dependencies: AutomaticFarmingSessionTransitionDependencies = {
      acquireStreamer: async () => streamer,
      currentFingerprint: () => 'fingerprint-a',
      loadReceipt: async () => ({ kind: 'ready', source: 'missing', value: null }),
      commitTransition: async (commit) => {
        events.push('commit');
        writes.push(structuredClone(commit));
        state.appState = structuredClone(commit.nextAppState);
        state.cachedDropsSnapshot = structuredClone(commit.nextDropsSnapshot);
        events.push('publish');
        return { kind: 'committed' };
      },
      watch: {
        currentOwnership: () => ownership,
        prepare: async (_target, mode) => {
          events.push(`prepare:${mode}`);
          events.push('probe:campaign-b');
          return {
            kind: 'prepared',
            watch: {
              target: {
                gameId: 'shared-game',
                campaignId: 'campaign-b',
                channelName: 'channel-b',
              },
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
                checkedAt: 4_500,
              },
              promote: () => {
                events.push('promote');
                const obsolete = ownership;
                ownership = toWatch;
                return { kind: 'promoted', ownership: toWatch, obsolete };
              },
              dispose: async () => {
                events.push('dispose-b');
              },
            },
          };
        },
        release: async () => {
          events.push('release-a');
          return { kind: 'released', method: 'closed' };
        },
      },
      now: () => 5_000,
    };

    // When: Session lifecycle automatically preempts A with B.
    const result = await transitionAutomaticFarmingSession(
      state,
      {
        attemptId: 'attempt-b',
        transition: 'preemption',
        fromCampaignKey: gameKey(incumbent),
        candidate,
        snapshot: provisionalSnapshot(),
        watchMode: 'managed-tab',
        expectedFingerprint: 'fingerprint-a',
      },
      dependencies,
    );

    // Then: one atomic write publishes B before promotion and keeps A immediately after B.
    expect({
      events,
      queue: JSON.stringify(state.appState.queue),
      selectedCampaign: state.appState.selectedGame?.campaignId,
      tabId: state.appState.tabId,
      resultKind: result.kind,
      obsolete: result.kind === 'committed' ? result.obsolete : null,
      writeCount: writes.length,
      receipt: writes[0]?.receipt,
    }).toEqual({
      events: ['prepare:managed-tab', 'probe:campaign-b', 'commit', 'publish', 'promote'],
      queue: JSON.stringify([candidate, incumbent]),
      selectedCampaign: 'campaign-b',
      tabId: 22,
      resultKind: 'committed',
      obsolete: fromWatch,
      writeCount: 1,
      receipt: {
        version: 1,
        attemptId: 'attempt-b',
        transition: 'preemption',
        fromCampaignKey: 'campaign:campaign-a',
        toCampaignKey: 'campaign:campaign-b',
        toStreamerName: 'channel-b',
        committedAt: 5_000,
        sessionRevision: '0',
        fromWatch,
        toWatch,
        cleanup: { kind: 'pending', obsolete: fromWatch },
      },
    });
  });

  test.each([
    ['streamer lookup', 0, 'candidate-preparation-failed'],
    ['managed open', 0, 'candidate-preparation-failed'],
    ['playback prep', 1, 'candidate-preparation-failed'],
    ['candidate probe', 1, 'candidate-preparation-failed'],
    ['revision after streamer', 0, 'superseded-by-state-change'],
    ['revision after prepare', 1, 'superseded-by-state-change'],
    ['storage commit', 1, 'transition-commit-failed'],
  ])('preserves incumbent when %s fails', async (failure, expectedDisposals, expectedReason) => {
    // Given: protected incumbent bytes and one injected managed-transition failpoint.
    const state = createServiceWorkerState();
    state.appState.selectedGame = incumbent;
    state.appState.isRunning = true;
    state.appState.activeStreamer = { ...streamer, name: 'channel-a' };
    state.appState.tabId = 11;
    state.appState.queue = [incumbent];
    state.lastTrackedProgress = 77;
    state.recoveryBackoffUntil = 9_000;
    const before = JSON.stringify(state);
    let fingerprint = 'fingerprint-a';
    let disposals = 0;
    const dependencies: AutomaticFarmingSessionTransitionDependencies = {
      acquireStreamer: async () => {
        if (failure === 'streamer lookup') throw new DOMException('injected streamer failure');
        if (failure === 'revision after streamer') fingerprint = 'fingerprint-b';
        return streamer;
      },
      currentFingerprint: () => fingerprint,
      loadReceipt: async () => ({ kind: 'ready', source: 'missing', value: null }),
      commitTransition: async () => ({ kind: 'failed', reason: 'transition-commit-failed' }),
      watch: {
        currentOwnership: () => fromWatch,
        prepare: async () => {
          if (failure === 'managed open') return { kind: 'failed', reason: 'candidate-unavailable' };
          if (failure === 'playback prep' || failure === 'candidate probe') {
            disposals += 1;
            return { kind: 'failed', reason: 'candidate-unavailable' };
          }
          if (failure === 'revision after prepare') fingerprint = 'fingerprint-b';
          return {
            kind: 'prepared',
            watch: {
              target: { gameId: 'shared-game', campaignId: 'campaign-b', channelName: 'channel-b' },
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
              promote: () => ({ kind: 'promoted', ownership: toWatch, obsolete: fromWatch }),
              dispose: async () => {
                disposals += 1;
              },
            },
          };
        },
        release: async () => ({ kind: 'abandoned-unproven' }),
      },
      now: () => 5_000,
    };

    // When: the automatic preemption reaches the injected failure.
    const result = await transitionAutomaticFarmingSession(
      state,
      {
        attemptId: `attempt-${failure}`,
        transition: 'preemption',
        fromCampaignKey: gameKey(incumbent),
        candidate,
        snapshot: provisionalSnapshot(),
        watchMode: 'managed-tab',
        expectedFingerprint: 'fingerprint-a',
      },
      dependencies,
    );

    // Then: every protected A byte is unchanged and only provisional B is disposed.
    expect({
      after: JSON.stringify(state),
      resultReason: result.kind === 'failed' || result.kind === 'unchanged' ? result.reason : result.kind,
      disposals,
    }).toEqual({ after: before, resultReason: expectedReason, disposals: expectedDisposals });
  });
});
