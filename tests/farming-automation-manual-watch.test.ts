import { describe, expect, test } from 'bun:test';
import './cases/farming-automation-manual-watch-02.ts';
import { createInitialFarmingAutomationFacts } from '../src/background/farming-automation-facts.ts';
import { createFarmingAutomationManualWatch } from '../src/background/farming-automation-manual-watch.ts';
import {
  createInMemoryFarmingAutomationPersistence,
  createInMemoryFarmingAutomationStorage,
} from '../src/background/farming-automation-persistence.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import type { TwitchGame } from '../src/types/index.ts';

const target: TwitchGame = {
  id: 'game-1',
  name: 'Game 1',
  imageUrl: '',
  campaignId: 'campaign-1',
  categorySlug: 'game-1',
  allowedChannels: ['manual-channel'],
};

describe('Farming automation manual watch', () => {
  test('serializes concurrent fact evaluations', async () => {
    // Given: the first browser observation is held open.
    let releaseFirstObservation: (() => void) | null = null;
    const firstObservation = new Promise<void>((resolve) => {
      releaseFirstObservation = resolve;
    });
    let observationCalls = 0;
    const controller = createFarmingAutomationManualWatch({
      persistence: {
        loadFacts: async () => ({
          kind: 'ready',
          source: 'missing',
          value: createInitialFarmingAutomationFacts(),
        }),
        saveFacts: async () => ({ kind: 'written' }),
      },
      observeManualTabs: async () => {
        observationCalls += 1;
        if (observationCalls === 1) await firstObservation;
        return { kind: 'observed', tabs: [] };
      },
      replaceDeadline: async () => 'cleared',
      now: () => 1_000,
    });

    // When: two owners evaluate through the same controller concurrently.
    const first = controller.evaluate({
      target,
      managedTabId: null,
      automationActive: true,
    });
    await Promise.resolve();
    await Promise.resolve();
    const second = controller.evaluate({
      target,
      managedTabId: null,
      automationActive: true,
    });
    await Promise.resolve();
    await Promise.resolve();
    const concurrentCalls = observationCalls;
    releaseFirstObservation?.();
    await Promise.all([first, second]);

    // Then: the second compare-and-update starts only after the first completes.
    expect(concurrentCalls).toBe(1);
    expect(observationCalls).toBe(2);
  });

  test('persists an active observation before replacing its deadline', async () => {
    // Given: durable persistence and an eligible active Twitch observation.
    const state = createServiceWorkerState();
    const projectedStates: (typeof state.appState.manualWatchState)[] = [];
    const persistence = createInMemoryFarmingAutomationPersistence({
      state,
      storage: createInMemoryFarmingAutomationStorage(),
      getSessionRevision: () => 'session-1',
      broadcast: (appState) => projectedStates.push(appState.manualWatchState),
    });
    const events: string[] = [];
    const controller = createFarmingAutomationManualWatch({
      persistence: {
        loadFacts: () => persistence.loadFacts(),
        async saveFacts(facts) {
          const saved = await persistence.saveFacts(facts);
          events.push('persist');
          return saved;
        },
      },
      observeManualTabs: async () => ({
        kind: 'observed',
        tabs: [
          {
            tab: { id: 4, active: true, url: 'https://www.twitch.tv/manual-channel' },
            context: {
              channelName: 'manual-channel',
              categorySlug: 'game-1',
              isLive: true,
              isPlaybackReady: true,
              hasDropsEnabled: true,
            },
          },
        ],
      }),
      async replaceDeadline(at) {
        events.push(`wake:${String(at)}`);
        return 'scheduled';
      },
      now: () => 1_000,
    });

    // When: Farming automation evaluates manual viewing.
    const result = await controller.evaluate({
      target,
      managedTabId: null,
      automationActive: true,
    });

    // Then: the durable fact and UI projection exist before the deadline is replaced.
    expect(result).toEqual({
      kind: 'active',
      watch: {
        kind: 'eligible-manual',
        observedAt: 1_000,
        stoppedAt: null,
        expiresAt: 31_000,
        recheckAt: 31_000,
      },
    });
    expect(state.appState.manualWatchState).toBe('eligible-manual');
    expect(state.appState.nextAutomationCheckAt).toBe(31_000);
    expect(projectedStates).toEqual(['eligible-manual']);
    expect(events).toEqual(['persist', 'wake:31000']);
  });

  test('reconstructs and expires from durable facts', async () => {
    // Given: one active fact persisted by a first controller instance.
    const state = createServiceWorkerState();
    const storage = createInMemoryFarmingAutomationStorage();
    const persistence = createInMemoryFarmingAutomationPersistence({
      state,
      storage,
      getSessionRevision: () => 'session-1',
      broadcast: () => undefined,
    });
    let currentTime = 1_000;
    let manualPlaybackActive = true;
    let observations = 0;
    const deadlines: (number | null)[] = [];
    const createController = () =>
      createFarmingAutomationManualWatch({
        persistence,
        observeManualTabs: async () => {
          observations += 1;
          return {
            kind: 'observed',
            tabs: manualPlaybackActive
              ? [
                  {
                    tab: { id: 4, active: true, url: 'https://www.twitch.tv/manual-channel' },
                    context: {
                      channelName: 'manual-channel',
                      categorySlug: 'game-1',
                      isLive: true,
                      isPlaybackReady: true,
                      hasDropsEnabled: true,
                    },
                  },
                ]
              : [],
          };
        },
        async replaceDeadline(at) {
          deadlines.push(at);
          return at === null ? 'cleared' : 'scheduled';
        },
        now: () => currentTime,
      });
    await createController().evaluate({ target, managedTabId: null, automationActive: true });

    // When: a reconstructed controller observes the stopped stream and its 30-second grace ends.
    const reconstructed = createController();
    currentTime = 30_000;
    const beforeExpiry = await reconstructed.evaluate({
      target,
      managedTabId: null,
      automationActive: true,
    });
    currentTime = 31_000;
    manualPlaybackActive = false;
    const atConfirmedStop = await reconstructed.evaluate({
      target,
      managedTabId: null,
      automationActive: true,
    });
    currentTime = 61_000;
    const afterStopGrace = await reconstructed.evaluate({
      target,
      managedTabId: null,
      automationActive: true,
    });

    // Then: the durable fact survives reconstruction and applies grace from the confirmed stop.
    expect(beforeExpiry.kind).toBe('active');
    expect(atConfirmedStop.kind).toBe('active');
    expect(afterStopGrace).toEqual({ kind: 'inactive', stoppedAt: 31_000 });
    expect(observations).toBe(3);
    expect(state.appState.manualWatchState).toBe('inactive');
    expect(state.appState.nextAutomationCheckAt).toBeNull();
    expect(deadlines).toEqual([31_000, 31_000, 61_000, null]);
  });

  test('maps candidate preparation failure and preserves suspension on observation failure', async () => {
    // Given: a browser observation boundary that reports failure.
    const controller = createFarmingAutomationManualWatch({
      persistence: {
        loadFacts: async () => ({
          kind: 'ready',
          source: 'missing',
          value: createInitialFarmingAutomationFacts(),
        }),
        saveFacts: async () => ({ kind: 'written' }),
      },
      observeManualTabs: async () => ({ kind: 'failed' }),
      replaceDeadline: async () => 'cleared',
      now: () => 1_000,
    });

    // When: the automation controller evaluates manual viewing.
    const result = await controller.evaluate({
      target,
      managedTabId: null,
      automationActive: true,
    });

    // Then: the operational failure remains distinct from an inactive observation.
    expect(result).toEqual({
      kind: 'failed',
      reason: 'candidate-preparation-failed',
    });
  });
});
