import { describe, expect, test } from 'bun:test';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createWatchHealth } from '../src/background/watch-health.ts';
import type { FarmingTarget, ManagedTabOpenResult } from '../src/background/watch-transport.ts';
import { createWatchTransportCoordinator } from '../src/background/watch-transport-coordinator.ts';
import { createDrop } from './fixtures/queue-management.ts';

const game = { id: 'smite', campaignId: 'smite-campaign', name: 'SMITE', imageUrl: '' };
const streamer = { id: 'smite-streamer', name: 'smite-streamer', displayName: 'SMITE', isLive: true };
const candidateTarget: FarmingTarget = {
  gameId: 'r6',
  selectionId: 'r6',
  campaignId: 'r6-campaign',
  channelName: 'r6-streamer',
};

function fixture() {
  const state = createServiceWorkerState();
  state.appState.selectedGame = game;
  state.appState.watchTransportPreference = 'managed-tab';
  state.appState.isRunning = true;
  let fail = false;
  let waitingForInteraction = false;
  let disposals = 0;
  let persists = 0;
  const probes: string[] = [];
  const coordinator = createWatchTransportCoordinator({
    state,
    heartbeat: async () => ({ accepted: true }),
    managedTab: {
      open: async (target): Promise<ManagedTabOpenResult> =>
        fail
          ? null
          : {
              owner: 'drophunter',
              tabId: target.channelName === streamer.name ? 17 : 18,
              ownership: {
                kind: 'managed-tab',
                tabId: target.channelName === streamer.name ? 17 : 18,
                ownershipToken: target.channelName,
                expectedChannel: target.channelName,
              },
              ...(waitingForInteraction
                ? {
                    health: createWatchHealth(
                      'managed-tab',
                      'degraded',
                      'user-interaction-required',
                      Date.now,
                    ),
                  }
                : {}),
              dispose: async () => {
                disposals += 1;
              },
            },
      probe: async (_session, target) => {
        probes.push(target.campaignId ?? '');
        return waitingForInteraction
          ? { accepted: false, sameChannel: true, sameGame: true, reason: 'playback-inactive' }
          : { accepted: true };
      },
      close: async () => {},
    },
    persist: async () => {
      persists += 1;
    },
    broadcast: () => {},
  });
  return {
    state,
    coordinator,
    probes,
    failNext: () => {
      fail = true;
    },
    waitForInteraction: () => {
      waitingForInteraction = true;
    },
    counts: () => ({ disposals, persists }),
  };
}

describe('staged watch transport preparation', () => {
  test('prepares an explicit campaign without publishing it, then promotes its real transport', async () => {
    const subject = fixture();
    expect(await subject.coordinator.start(streamer)).toMatchObject({ kind: 'started' });
    const incumbent = subject.coordinator.currentOwnership();
    const appStateBefore = structuredClone(subject.state.appState);
    const countsBefore = subject.counts();

    const prepared = await subject.coordinator.prepare(candidateTarget);
    if (prepared.kind !== 'prepared') throw new Error('Expected a prepared R6 watch');

    expect(subject.state.appState).toEqual(appStateBefore);
    expect(subject.coordinator.currentOwnership()).toEqual(incumbent);
    expect(subject.counts()).toEqual(countsBefore);
    expect(prepared.watch.target).toEqual(candidateTarget);
    expect(prepared.watch.promote()).toMatchObject({
      kind: 'promoted',
      ownership: { expectedChannel: 'r6-streamer' },
      obsolete: incumbent,
    });
    expect(subject.counts()).toEqual(countsBefore);
    await subject.coordinator.tick();
    expect(subject.probes).toEqual(['r6-campaign']);
  });

  test('disposes an uncommitted candidate once while retaining the incumbent', async () => {
    const subject = fixture();
    await subject.coordinator.start(streamer);
    const incumbent = subject.coordinator.currentOwnership();
    const prepared = await subject.coordinator.prepare(candidateTarget);
    if (prepared.kind !== 'prepared') throw new Error('Expected a prepared R6 watch');
    await prepared.watch.dispose();
    await prepared.watch.dispose();
    expect(prepared.watch.promote()).toMatchObject({ kind: 'discarded' });
    expect(subject.coordinator.currentOwnership()).toEqual(incumbent);
    expect(subject.counts().disposals).toBe(1);
  });

  test('a newer start supersedes a prepared candidate before promotion', async () => {
    const subject = fixture();
    await subject.coordinator.start(streamer);
    const prepared = await subject.coordinator.prepare(candidateTarget);
    if (prepared.kind !== 'prepared') throw new Error('Expected a prepared R6 watch');
    await subject.coordinator.start(streamer);
    expect(prepared.watch.promote()).toMatchObject({ kind: 'discarded' });
    await prepared.watch.dispose();
    expect(subject.coordinator.currentTarget()?.campaignId).toBe(game.campaignId);
    expect(subject.coordinator.currentOwnership()).toMatchObject({ expectedChannel: streamer.name });
    expect(subject.counts().disposals).toBe(1);
  });

  test('initial failed preparation never publishes a streamer or healthy watch', async () => {
    const subject = fixture();
    subject.failNext();
    expect(await subject.coordinator.start(streamer)).toMatchObject({
      kind: 'failed',
      health: { status: 'failed', reason: 'managed-tab-unavailable' },
    });
    expect(subject.state.appState.activeStreamer).toBeNull();
    expect(subject.coordinator.currentOwnership()).toBeNull();
  });

  test('returns cancelled before preparing a superseded start', async () => {
    const subject = fixture();
    expect(await subject.coordinator.start(streamer, () => false)).toEqual({ kind: 'cancelled' });
    expect(subject.counts()).toEqual({ disposals: 0, persists: 0 });
  });

  test('retains an initial managed watch that needs explicit player interaction', async () => {
    const subject = fixture();
    subject.waitForInteraction();
    expect(await subject.coordinator.start(streamer)).toMatchObject({
      kind: 'started',
      health: { isHealthy: false, status: 'degraded', reason: 'user-interaction-required' },
    });
    expect(subject.state.appState.activeStreamer?.name).toBe(streamer.name);
    expect(subject.coordinator.currentTarget()?.campaignId).toBe(game.campaignId);
    expect(subject.counts().disposals).toBe(0);
  });

  test('promotes a candidate awaiting player interaction and observes its progress normally', async () => {
    const subject = fixture();
    await subject.coordinator.start(streamer);
    subject.waitForInteraction();
    expect(await subject.coordinator.start({ ...streamer, name: 'r6-streamer' })).toMatchObject({
      kind: 'started',
      health: { reason: 'user-interaction-required' },
    });
    expect(subject.state.appState.watchHealth?.reason).toBe('user-interaction-required');
    expect(subject.coordinator.currentOwnership()).toMatchObject({ expectedChannel: 'r6-streamer' });
    expect(subject.state.appState.activeStreamer?.name).toBe('r6-streamer');
    expect(subject.counts().disposals).toBe(0);
  });

  test('worker recycle retains an initial watch still waiting for player interaction', async () => {
    const subject = fixture();
    subject.waitForInteraction();
    expect(await subject.coordinator.start(streamer)).toMatchObject({ kind: 'started' });
    const ownership = subject.coordinator.currentOwnership();
    if (!ownership) throw new Error('Expected the retained interaction watch');
    expect(await subject.coordinator.restore(ownership)).toBe(true);
    expect(subject.coordinator.currentTarget()?.campaignId).toBe(game.campaignId);
    expect(subject.state.appState.watchHealth).toMatchObject({
      isHealthy: false,
      reason: 'user-interaction-required',
      status: 'degraded',
    });
    expect(subject.coordinator.currentOwnership()).toEqual(ownership);
  });

  test.each(['completed', 'progressing', 'stalled'] as const)(
    'gesture-blocked successor remains observable for every incumbent reward state: %s',
    async (status) => {
      const subject = fixture();
      await subject.coordinator.start(streamer);
      const drop = createDrop({
        gameId: game.id,
        campaignId: game.campaignId,
        progress: status === 'completed' ? 100 : 25,
        currentMinutes: status === 'completed' ? 60 : 15,
        requiredMinutes: 60,
        remainingMinutes: status === 'completed' ? 0 : 45,
        claimed: status === 'completed',
      });
      subject.state.appState.allDrops = [drop];
      subject.state.appState.currentDrop = status === 'completed' ? null : drop;
      subject.state.appState.pendingDrops = status === 'completed' ? [] : [drop];
      if (status === 'stalled') subject.state.appState.recoveryReason = 'stalled-progress';
      const incumbent = subject.coordinator.currentOwnership();
      subject.waitForInteraction();
      const preparation = await subject.coordinator.prepare(candidateTarget);
      expect(preparation.kind).toBe('prepared');
      expect(subject.coordinator.currentOwnership()).toEqual(incumbent);
      if (preparation.kind === 'prepared') {
        expect(preparation.watch.health.reason).toBe('user-interaction-required');
        expect(preparation.watch.promote().kind).toBe('promoted');
        expect(subject.coordinator.currentTarget()).toEqual(candidateTarget);
        expect(subject.counts().disposals).toBe(0);
      } else {
        expect(subject.counts().disposals).toBe(1);
      }
    },
  );

  test('retains dormant ownership without restoring an absent active campaign watch', async () => {
    const subject = fixture();
    expect(
      await subject.coordinator.restore({
        kind: 'managed-tab',
        tabId: 17,
        ownershipToken: 'old-watch',
        expectedChannel: 'smite-streamer',
      }),
    ).toBe(false);
    expect(subject.coordinator.currentOwnership()).toMatchObject({ tabId: 17, ownershipToken: 'old-watch' });
    expect(subject.coordinator.currentTarget()).toBeNull();
    expect(subject.counts().persists).toBe(0);
  });

  test('retains dormant ownership without restoring a mismatched persisted streamer', async () => {
    const subject = fixture();
    subject.state.appState.activeStreamer = { ...streamer, name: 'r6-streamer' };
    expect(
      await subject.coordinator.restore({
        kind: 'managed-tab',
        tabId: 17,
        ownershipToken: 'old-watch',
        expectedChannel: 'smite-streamer',
      }),
    ).toBe(false);
    expect(subject.coordinator.currentOwnership()).toMatchObject({ tabId: 17, ownershipToken: 'old-watch' });
    expect(subject.coordinator.currentTarget()).toBeNull();
  });

  test('rejects tabless ownership belonging to another persisted campaign', async () => {
    const subject = fixture();
    subject.state.appState.activeStreamer = streamer;
    expect(await subject.coordinator.restore({ kind: 'tabless', targetKey: 'campaign:r6-campaign' })).toBe(
      false,
    );
    expect(subject.coordinator.currentOwnership()).toBeNull();
  });

  test('rechecks a legacy managed channel before restoring its campaign health', async () => {
    const subject = fixture();
    subject.state.appState.activeStreamer = streamer;
    const coordinator = createWatchTransportCoordinator({
      state: subject.state,
      heartbeat: async () => ({ accepted: true }),
      managedTab: {
        open: async () => null,
        probe: async () => ({ accepted: false, sameChannel: true, sameGame: false, reason: 'wrong-game' }),
        close: async () => {},
      },
      persist: async () => {},
      broadcast: () => {},
    });
    expect(
      await coordinator.restore({
        kind: 'managed-tab',
        tabId: 17,
        ownershipToken: 'old-watch',
        expectedChannel: streamer.name,
      }),
    ).toBe(false);
    expect(coordinator.currentOwnership()).toMatchObject({ tabId: 17, ownershipToken: 'old-watch' });
    expect(coordinator.currentTarget()).toBeNull();
  });

  test('retains stopped tab ownership without inventing an active campaign watch', async () => {
    const subject = fixture();
    subject.state.appState.isRunning = false;
    const ownership = {
      kind: 'managed-tab' as const,
      tabId: 17,
      ownershipToken: 'old-watch',
      expectedChannel: streamer.name,
    };
    expect(await subject.coordinator.restore(ownership)).toBe(true);
    expect(subject.coordinator.currentOwnership()).toEqual(ownership);
    expect(subject.coordinator.currentTarget()).toBeNull();
    expect(subject.state.appState.activeStreamer).toBeNull();
    expect(subject.counts().persists).toBe(0);
  });
});
