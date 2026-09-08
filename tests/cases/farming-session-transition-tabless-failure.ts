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
  test('projects the hidden-watch failure reason after promoting a managed fallback', async () => {
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

    expect(result.kind).toBe('committed');
    expect(state.appState.watchTransportPreference).toBe('tabless');
    expect(state.appState.watchTransportMode).toBe('managed-tab');
    expect(state.appState.watchFallbackReason).toBe('heartbeat-failed');
  });

  test.each([
    ['unhealthy heartbeat', true, ['tabless', 'managed-tab'], 1],
    ['disabled heartbeat', false, ['managed-tab'], 1],
  ])('preserves incumbent when tabless %s and its managed fallback both fail', async (_name, enabled, expectedDisposals, expectedManagedPreparations) => {
    // Given: incumbent A and a tabless B whose managed fallback cannot become healthy.
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

    // When: Session lifecycle attempts the requested tabless preparation and its fallback.
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
      managedPreparations: expectedManagedPreparations,
      commitCount: 0,
    });
  });
}
