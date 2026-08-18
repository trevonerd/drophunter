import { describe, expect, test } from 'bun:test';
import type { FarmingTarget, WatchHealth } from '../src/background/watch-transport.ts';
import {
  createWatchTransportTransition,
  type ProvisionalWatchCandidate,
  type WatchOwnershipV1,
} from '../src/background/watch-transport-transition.ts';

const incumbent: WatchOwnershipV1 = {
  kind: 'managed-tab',
  tabId: 11,
  ownershipToken: 'incumbent-token',
  expectedChannel: 'channel-a',
};

const target: FarmingTarget = {
  gameId: 'game-b',
  campaignId: 'campaign-b',
  channelName: 'channel-b',
};

function healthyManagedWatch(): WatchHealth {
  return {
    mode: 'managed-tab',
    isHealthy: true,
    status: 'healthy',
    reason: 'heartbeat',
    consecutiveFailures: 0,
    consecutiveStalls: 0,
    progress: null,
    shouldFallback: false,
    checkedAt: 1_000,
  };
}

describe('watch transport transition', () => {
  test('keeps A active until forced-muted B is promoted', async () => {
    // Given: an incumbent ownership and a viable provisional candidate.
    const candidate: ProvisionalWatchCandidate = {
      target,
      ownership: {
        kind: 'managed-tab',
        tabId: 22,
        ownershipToken: 'candidate-token',
        expectedChannel: 'channel-b',
      },
      health: healthyManagedWatch(),
      dispose: async () => {},
    };
    const transition = createWatchTransportTransition({
      currentOwnership: incumbent,
      prepareManaged: async () => candidate,
      prepareTabless: async () => null,
      release: async () => ({ kind: 'abandoned-unproven' }),
    });

    // When: B is prepared but the durable commit has not promoted it yet.
    const preparation = await transition.prepare(target, 'managed-tab');

    // Then: A remains current; promotion swaps ownership synchronously afterwards.
    expect(preparation.kind).toBe('prepared');
    expect(transition.currentOwnership()).toEqual(incumbent);
    if (preparation.kind !== 'prepared') throw new Error('Expected a prepared candidate watch');
    const promotion = preparation.watch.promote();
    expect(promotion).toEqual({
      kind: 'promoted',
      ownership: candidate.ownership,
      obsolete: incumbent,
    });
    expect(transition.currentOwnership()).toEqual(candidate.ownership);
  });

  test('never prepares a managed fallback for a strict tabless transition', async () => {
    // Given: tabless B is unhealthy while a managed candidate would be viable.
    const disposals: string[] = [];
    let managedPreparations = 0;
    const unhealthyCandidate = (
      mode: WatchHealth['mode'],
      ownership: WatchOwnershipV1,
    ): ProvisionalWatchCandidate => ({
      target,
      ownership,
      health: { ...healthyManagedWatch(), mode, isHealthy: false, status: 'failed' },
      dispose: async () => {
        disposals.push(mode);
      },
    });
    const transition = createWatchTransportTransition({
      currentOwnership: incumbent,
      prepareTabless: async () =>
        unhealthyCandidate('tabless', { kind: 'tabless', targetKey: 'campaign:campaign-b' }),
      prepareManaged: async () => {
        managedPreparations += 1;
        return unhealthyCandidate('managed-tab', {
          kind: 'managed-tab',
          tabId: 22,
          ownershipToken: 'candidate-token',
          expectedChannel: 'channel-b',
        });
      },
      release: async () => ({ kind: 'abandoned-unproven' }),
    });

    // When: tabless preparation cannot establish a healthy watch.
    const preparation = await transition.prepare(target, 'tabless');

    // Then: the tabless candidate is disposed and managed transport is never prepared.
    expect(preparation).toEqual({ kind: 'failed', reason: 'candidate-unavailable' });
    expect(disposals).toEqual(['tabless']);
    expect(managedPreparations).toBe(0);
    expect(transition.currentOwnership()).toEqual(incumbent);
  });

  test('disposes a provisional watch idempotently', async () => {
    // Given: one viable B candidate with an observable disposal boundary.
    let disposalCount = 0;
    const candidate: ProvisionalWatchCandidate = {
      target,
      ownership: { kind: 'tabless', targetKey: 'campaign:campaign-b' },
      health: { ...healthyManagedWatch(), mode: 'tabless' },
      dispose: async () => {
        disposalCount += 1;
      },
    };
    const transition = createWatchTransportTransition({
      currentOwnership: incumbent,
      prepareTabless: async () => candidate,
      prepareManaged: async () => null,
      release: async () => ({ kind: 'not-required' }),
    });
    const preparation = await transition.prepare(target, 'tabless');
    expect(preparation.kind).toBe('prepared');
    if (preparation.kind !== 'prepared') throw new Error('Expected a prepared candidate watch');

    // When: two callers dispose the same provisional handle.
    await Promise.all([preparation.watch.dispose(), preparation.watch.dispose()]);

    // Then: B is disposed once and a later promotion cannot replace A.
    expect(disposalCount).toBe(1);
    expect(preparation.watch.promote()).toEqual({
      kind: 'discarded',
      ownership: candidate.ownership,
    });
    expect(transition.currentOwnership()).toEqual(incumbent);
  });
});
