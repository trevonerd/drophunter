import { expect, test } from 'bun:test';
import { createServiceWorkerState } from '../../src/background/runtime-state.ts';
import { transitionAutomaticFarmingSession } from '../../src/background/session-lifecycle.ts';
import { createWatchTransportTransition } from '../../src/background/watch-transport-transition.ts';
import { gameKey } from '../../src/shared/game-selection.ts';
import {
  candidate,
  fromWatch,
  incumbent,
  snapshot,
  streamer,
  unhealthyCandidate,
} from '../helpers/farming-session-transition-tabless.ts';

export function registerTablessFailureCases() {
  test('keeps tabless failure without preparing a managed fallback', async () => {
    const state = createServiceWorkerState();
    state.appState.selectedGame = incumbent;
    state.appState.isRunning = true;
    state.appState.activeStreamer = { ...streamer, name: 'channel-a' };
    state.appState.tabId = 11;
    state.appState.queue = [incumbent];
    const watch = createWatchTransportTransition({
      currentOwnership: fromWatch,
      prepareTabless: async () =>
        unhealthyCandidate('tabless', { kind: 'tabless', targetKey: 'campaign:campaign-b' }, []),
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
          progress: null,
          shouldFallback: false,
          checkedAt: 1,
        },
        dispose: async () => {},
      }),
      release: async () => ({ kind: 'abandoned-unproven' }),
    });

    const result = await transitionAutomaticFarmingSession(
      state,
      {
        attemptId: 'attempt-hidden-fallback',
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
        commitTransition: async () => ({ kind: 'committed' }),
        watch,
        now: () => 2_000,
      },
    );

    expect(result).toEqual({ kind: 'failed', reason: 'candidate-preparation-failed' });
    expect(state.appState.watchTransportPreference).toBe('tabless');
    expect(state.appState.watchTransportMode).toBe('tabless');
    expect(state.appState.watchFallbackReason).toBeNull();
  });

  test.each([
    ['unhealthy heartbeat', true, ['tabless']],
    ['disabled heartbeat', false, []],
  ])('preserves incumbent when tabless %s fails without a managed fallback', async (_name, enabled, expectedDisposals) => {
    // Given: incumbent A and a tabless B whose candidate cannot become healthy.
    const state = createServiceWorkerState();
    state.appState.selectedGame = incumbent;
    state.appState.isRunning = true;
    state.appState.activeStreamer = { ...streamer, name: 'channel-a' };
    state.appState.tabId = 11;
    state.appState.queue = [incumbent];
    state.invalidStreamChecks = 2;
    const before = JSON.stringify(state);
    const disposals: string[] = [];
    let managedPreparations = 0;
    let commitCount = 0;
    const watch = createWatchTransportTransition({
      currentOwnership: fromWatch,
      prepareTabless: async () =>
        enabled
          ? unhealthyCandidate('tabless', { kind: 'tabless', targetKey: 'campaign:campaign-b' }, disposals)
          : null,
      prepareManaged: async () => {
        managedPreparations += 1;
        return unhealthyCandidate(
          'managed-tab',
          {
            kind: 'managed-tab',
            tabId: 22,
            ownershipToken: 'owned-b',
            expectedChannel: 'channel-b',
          },
          disposals,
        );
      },
      release: async () => ({ kind: 'abandoned-unproven' }),
    });

    // When: Session lifecycle attempts the requested tabless preparation.
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

    // Then: A remains byte-identical; rejected B candidates are disposed before any commit.
    expect({ result, after: JSON.stringify(state), disposals, managedPreparations, commitCount }).toEqual({
      result: { kind: 'failed', reason: 'candidate-preparation-failed' },
      after: before,
      disposals: expectedDisposals,
      managedPreparations: 0,
      commitCount: 0,
    });
  });
}
