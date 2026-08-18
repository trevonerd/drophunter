import { expect, test } from 'bun:test';
import type { FarmingSessionTransitionReceiptV1 } from '../../src/background/farming-automation-contracts.ts';
import { createServiceWorkerState } from '../../src/background/runtime-state.ts';
import { transitionAutomaticFarmingSession } from '../../src/background/session-lifecycle.ts';
import {
  createWatchTransportTransition,
  type WatchOwnershipV1,
} from '../../src/background/watch-transport-transition.ts';
import { gameKey } from '../../src/shared/game-selection.ts';
import { candidate, incumbent, snapshot, streamer } from '../helpers/farming-session-transition-tabless.ts';

export function registerTablessOwnershipCases() {
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
}
