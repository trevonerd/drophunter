import { describe, expect, test } from 'bun:test';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import type { FarmingTarget, WatchHealth } from '../src/background/watch-transport.ts';
import { createWatchTransportCoordinator } from '../src/background/watch-transport-coordinator.ts';
import { createWatchTransportTransition } from '../src/background/watch-transport-transition.ts';

const healthyManaged = (checkedAt: number): WatchHealth => ({
  mode: 'managed-tab',
  isHealthy: true,
  status: 'healthy',
  reason: 'heartbeat',
  consecutiveFailures: 0,
  consecutiveStalls: 0,
  progress: 1,
  shouldFallback: false,
  checkedAt,
});

describe('watch transport handoff', () => {
  test.each(['manual', 'automatic', 'other-campaign'] as const)(
    'gesture-wait replacement respects %s campaign intent while an old watch exists',
    async (intent) => {
      const state = createServiceWorkerState();
      state.appState.isRunning = true;
      state.appState.manualQueueAuthorized = intent !== 'automatic';
      state.appState.farmingSessionOrigin = intent === 'automatic' ? 'automatic' : 'manual';
      state.appState.watchTransportPreference = 'managed-tab';
      state.appState.selectedGame = {
        id: intent === 'manual' ? 'b' : 'a',
        name: 'Selection',
        imageUrl: '',
        campaignId: intent === 'manual' ? 'campaign-b' : 'campaign-a',
      };
      const ownershipA = {
        kind: 'managed-tab' as const,
        tabId: 11,
        ownershipToken: 'a',
        expectedChannel: 'a',
      };
      const ownershipB = {
        kind: 'managed-tab' as const,
        tabId: 22,
        ownershipToken: 'b',
        expectedChannel: 'b',
      };
      const coordinator = createWatchTransportCoordinator({
        state,
        heartbeat: async () => ({ accepted: false }),
        managedTab: {
          open: async () => ({
            owner: 'drophunter',
            tabId: 22,
            ownership: ownershipB,
            health: {
              ...healthyManaged(2),
              isHealthy: false,
              status: 'degraded',
              reason: 'user-interaction-required',
            },
          }),
          probe: async () => ({
            accepted: false,
            isLive: true,
            sameChannel: true,
            sameGame: true,
            reason: 'playback-inactive',
          }),
          close: async () => {},
        },
        persist: async () => {},
        broadcast: () => {},
      });
      coordinator.adopt({
        target: { gameId: 'a', campaignId: 'campaign-a', channelName: 'a' },
        ownership: ownershipA,
        health: healthyManaged(1),
        obsolete: null,
      });
      const prepared = await coordinator.prepare({
        gameId: 'b',
        selectionId: 'b',
        campaignId: 'campaign-b',
        channelName: 'b',
      });
      expect(prepared.kind).toBe('prepared');
      expect(coordinator.currentOwnership()).toEqual(ownershipA);
      if (prepared.kind === 'prepared') {
        expect(prepared.watch.promote().kind).toBe('promoted');
        expect(coordinator.currentOwnership()).toEqual(ownershipB);
      }
    },
  );

  test('promotes B into the coordinator used by the live Farming session', async () => {
    const events: string[] = [];
    const state = createServiceWorkerState();
    state.appState.selectedGame = {
      id: 'a',
      name: 'A',
      imageUrl: '',
      campaignId: 'campaign-a',
      categorySlug: 'a',
    };
    state.appState.watchTransportPreference = 'managed-tab';
    const ownershipA = {
      kind: 'managed-tab' as const,
      tabId: 11,
      ownershipToken: 'token-a',
      expectedChannel: 'a',
    };
    const ownershipB = {
      kind: 'managed-tab' as const,
      tabId: 11,
      ownershipToken: 'token-b',
      expectedChannel: 'b',
    };
    const coordinator = createWatchTransportCoordinator({
      state,
      heartbeat: async () => ({ accepted: true }),
      managedTab: {
        open: async (target) => {
          events.push(`live-open:${target.channelName}`);
          return {
            owner: 'drophunter',
            tabId: 11,
            ownership: target.channelName === 'a' ? ownershipA : ownershipB,
          };
        },
        probe: async (_session, target) => {
          events.push(`live-probe:${target.channelName}`);
          return { accepted: true, progress: 1 };
        },
        close: async () => {
          events.push('live-close:a');
        },
      },
      persist: async () => {},
      broadcast: () => {},
    });
    await coordinator.start({ id: 'a', name: 'a', displayName: 'A', isLive: true });
    const targetB: FarmingTarget = {
      gameId: 'b',
      selectionId: 'b',
      campaignId: 'campaign-b',
      categorySlug: 'b',
      channelName: 'b',
    };
    const transition = createWatchTransportTransition({
      currentOwnership: null,
      runtime: coordinator,
      prepareManaged: async () => null,
      prepareTabless: async () => null,
      release: async (ownership) => {
        events.push(`release:${ownership.kind === 'managed-tab' ? ownership.expectedChannel : 'tabless'}`);
        return { kind: 'released', method: 'closed' };
      },
    });
    const prepared = await transition.prepare(targetB, 'managed-tab');
    if (prepared.kind !== 'prepared') throw new Error('Expected B to be prepared');

    events.push('commit-b');
    state.appState.selectedGame = {
      id: 'b',
      name: 'B',
      imageUrl: '',
      campaignId: 'campaign-b',
      categorySlug: 'b',
    };
    expect(prepared.watch.promote()).toEqual({
      kind: 'promoted',
      ownership: ownershipB,
      obsolete: ownershipA,
    });
    await coordinator.tick();

    expect(transition.currentOwnership()).toEqual(ownershipB);
    expect(events).toEqual(['live-open:a', 'live-open:b', 'commit-b', 'live-probe:b']);
  });

  test('restores committed ownership without opening B again after an MV3 recycle', async () => {
    const probes: string[] = [];
    let opens = 0;
    const state = createServiceWorkerState();
    state.appState.isRunning = true;
    state.appState.selectedGame = {
      id: 'b',
      name: 'B',
      imageUrl: '',
      campaignId: 'campaign-b',
      categorySlug: 'b',
    };
    state.appState.activeStreamer = { id: 'b', name: 'b', displayName: 'B', isLive: true };
    state.appState.watchTransportMode = 'managed-tab';
    state.appState.watchTransportPreference = 'managed-tab';
    state.appState.watchHealth = healthyManaged(3);
    const ownershipB = {
      kind: 'managed-tab' as const,
      tabId: 22,
      ownershipToken: 'token-b',
      expectedChannel: 'b',
    };
    const coordinator = createWatchTransportCoordinator({
      state,
      heartbeat: async () => ({ accepted: true }),
      managedTab: {
        open: async () => {
          opens += 1;
          return null;
        },
        probe: async (_session, target) => {
          probes.push(target.channelName);
          return { accepted: true, progress: 1 };
        },
        close: async () => {},
      },
      persist: async () => {},
      broadcast: () => {},
    });

    expect(await coordinator.restore(ownershipB)).toBe(true);
    await coordinator.tick();

    expect(coordinator.currentOwnership()).toEqual(ownershipB);
    expect({ opens, probes }).toEqual({ opens: 0, probes: ['b', 'b'] });
  });
});
