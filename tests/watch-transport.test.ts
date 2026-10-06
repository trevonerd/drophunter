import { describe, expect, test } from 'bun:test';
import { prepareManagedProvisionalWatch } from '../src/background/managed-tab-transport.ts';
import { prepareTablessProvisionalWatch } from '../src/background/tabless-transport.ts';
import { createWatchHealth } from '../src/background/watch-health.ts';
import {
  createTablessTransport,
  type FarmingTarget,
  type ManagedTabSession,
  ManagedTabTransport,
  type TablessHeartbeat,
} from '../src/background/watch-transport.ts';

const target: FarmingTarget = {
  gameId: 'game-1',
  campaignId: 'campaign-1',
  channelName: 'channel-one',
};

const managedSession: ManagedTabSession = {
  owner: 'drophunter',
  tabId: 42,
};

describe('ManagedTabTransport', () => {
  test('keeps an explicit gesture wait without accumulating failures, then resumes on verified playback', async () => {
    let playing = false;
    const transport = new ManagedTabTransport({
      open: async () => ({
        ...managedSession,
        health: createWatchHealth('managed-tab', 'degraded', 'user-interaction-required', () => 100),
      }),
      probe: async () =>
        playing ? { accepted: true, progress: 1 } : { accepted: false, reason: 'playback-inactive' },
      close: async () => {},
    });
    expect(await transport.start(target)).toMatchObject({
      isHealthy: false,
      reason: 'user-interaction-required',
    });
    for (let attempt = 0; attempt < 7; attempt++) {
      expect(await transport.tick()).toMatchObject({
        reason: 'user-interaction-required',
        consecutiveFailures: 0,
        shouldFallback: false,
      });
    }
    playing = true;
    expect(await transport.tick()).toMatchObject({
      isHealthy: true,
      reason: 'heartbeat',
      consecutiveFailures: 0,
    });
  });

  test.each(['buffering', 'gesture', 'playing'] as const)(
    'provisional preparation reports %s using playback evidence rather than a live context alone',
    async (kind) => {
      const candidate = await prepareManagedProvisionalWatch(target, 'https://www.twitch.tv/channel-one', {
        createOwnershipToken: () => 'candidate',
        persistOwnership: async () => true,
        discardOwnership: async () => {},
        openTab: async () => ({ id: 42 }),
        waitForTabComplete: async () => {},
        preparePlayback: async () => ({
          isPlaybackReady: kind === 'playing',
          userInteractionRequired: kind === 'gesture',
        }),
        probe: async () => ({ accepted: true, isLive: true, sameChannel: true, sameGame: true }),
        release: async () => ({ kind: 'released', method: 'closed' }),
        now: () => 100,
      });
      expect(candidate?.health).toMatchObject({
        isHealthy: kind === 'playing',
        status: kind === 'playing' ? 'healthy' : kind === 'gesture' ? 'degraded' : 'failed',
        reason:
          kind === 'playing'
            ? 'heartbeat'
            : kind === 'gesture'
              ? 'user-interaction-required'
              : 'playback-inactive',
      });
    },
  );

  test('starts inactive and keeps the managed tab available after transport stop', async () => {
    const calls: string[] = [];
    const ownership = {
      kind: 'managed-tab' as const,
      tabId: managedSession.tabId,
      ownershipToken: 'managed-token',
      expectedChannel: target.channelName,
    };
    const startOptions: { current: { active: false; focus: false } | null } = { current: null };
    const transport = new ManagedTabTransport({
      open: async (_target, options) => {
        startOptions.current = options;
        calls.push('open');
        return { ...managedSession, ownership };
      },
      probe: async (session) => {
        expect(session.tabId).toBe(managedSession.tabId);
        calls.push('probe');
        return { accepted: true, progress: 12 };
      },
      close: async (session) => {
        expect(session.tabId).toBe(managedSession.tabId);
        calls.push('close');
      },
      now: () => 1_000,
    });

    const started = await transport.start(target);
    const ticked = await transport.tick();
    await transport.stop();

    expect(startOptions.current).toMatchObject({ active: false, focus: false });
    expect(calls).toEqual(['open', 'probe']);
    expect(transport.currentOwnership()).toEqual(ownership);
    expect(started).toMatchObject({
      mode: 'managed-tab',
      isHealthy: true,
      status: 'healthy',
      reason: 'started',
      shouldFallback: false,
      checkedAt: 1_000,
    });
    expect(ticked).toMatchObject({
      mode: 'managed-tab',
      isHealthy: true,
      status: 'healthy',
      reason: 'heartbeat',
      progress: 12,
    });
  });

  test('rejects an adapter session that is not explicitly DropHunter-owned', async () => {
    const transport = new ManagedTabTransport({
      open: async () => ({ owner: 'user', tabId: 99 }),
      probe: async () => ({ accepted: true }),
      close: async () => {},
    });

    const health = await transport.start(target);

    expect(health).toMatchObject({
      mode: 'managed-tab',
      isHealthy: false,
      status: 'failed',
      reason: 'managed-tab-unavailable',
      shouldFallback: true,
    });
  });

  test('returns a not-started health result without touching any tab', async () => {
    let probes = 0;
    const transport = new ManagedTabTransport({
      open: async () => managedSession,
      probe: async () => {
        probes += 1;
        return { accepted: true };
      },
      close: async () => {},
    });

    const health = await transport.tick();

    expect(probes).toBe(0);
    expect(health).toMatchObject({
      mode: 'managed-tab',
      isHealthy: false,
      status: 'not-started',
      reason: 'not-started',
    });
  });

  test('marks inactive managed playback terminal after exactly three probes', async () => {
    const transport = new ManagedTabTransport({
      open: async () => managedSession,
      probe: async () => ({ accepted: false, reason: 'playback-inactive' }),
      close: async () => {},
    });
    await transport.start(target);

    const first = await transport.tick();
    const second = await transport.tick();
    const third = await transport.tick();

    expect(first.shouldFallback).toBe(false);
    expect(second.shouldFallback).toBe(false);
    expect(third).toMatchObject({
      reason: 'playback-inactive',
      consecutiveFailures: 3,
      shouldFallback: true,
    });
  });
});

describe('TablessTransport', () => {
  test('returns a typed rejected candidate when the initial hidden heartbeat throws', async () => {
    const candidate = await prepareTablessProvisionalWatch(target, {
      enabled: true,
      heartbeat: async () => {
        throw new Error('network unavailable');
      },
      now: () => 1_000,
    });

    expect(candidate?.health).toMatchObject({
      mode: 'tabless',
      status: 'failed',
      reason: 'error',
    });
  });

  test('returns a typed rejected candidate when hidden watching is disabled', async () => {
    const candidate = await prepareTablessProvisionalWatch(target, {
      enabled: false,
      heartbeat: async () => ({ accepted: true }),
      now: () => 1_000,
    });

    expect(candidate?.health).toMatchObject({
      mode: 'tabless',
      status: 'disabled',
      reason: 'transport-disabled',
    });
  });

  test('is explicitly disabled when the store build has no compliance gate', async () => {
    let heartbeats = 0;
    const transport = createTablessTransport({
      enabled: false,
      heartbeat: async (): Promise<TablessHeartbeat> => {
        heartbeats += 1;
        return { accepted: true };
      },
    });

    const started = await transport.start(target);
    const ticked = await transport.tick();

    expect(heartbeats).toBe(0);
    expect(started).toMatchObject({
      mode: 'tabless',
      isHealthy: false,
      status: 'disabled',
      reason: 'transport-disabled',
      shouldFallback: false,
    });
    expect(ticked).toEqual(started);
  });

  test('requests fallback only after ten failed heartbeats', async () => {
    let heartbeats = 0;
    let fallbacks = 0;
    const transport = createTablessTransport({
      enabled: true,
      heartbeat: async (): Promise<TablessHeartbeat> => {
        heartbeats += 1;
        return { accepted: false, reason: 'heartbeat-failed' };
      },
      onFallback: async () => {
        fallbacks += 1;
      },
      now: () => 2_000,
    });

    let health = await transport.start(target);
    for (let index = 1; index < 9; index += 1) {
      health = await transport.tick();
    }

    expect(heartbeats).toBe(9);
    expect(fallbacks).toBe(0);
    expect(health.shouldFallback).toBe(false);

    health = await transport.tick();

    expect(heartbeats).toBe(10);
    expect(fallbacks).toBe(1);
    expect(health).toMatchObject({
      mode: 'tabless',
      isHealthy: false,
      status: 'failed',
      reason: 'heartbeat-failed',
      consecutiveFailures: 10,
      shouldFallback: true,
    });

    await transport.tick();
    expect(fallbacks).toBe(1);
  });

  test('falls back when accepted heartbeats stop advancing progress', async () => {
    let heartbeatNumber = 0;
    let fallbacks = 0;
    const transport = createTablessTransport({
      enabled: true,
      heartbeat: async (): Promise<TablessHeartbeat> => {
        heartbeatNumber += 1;
        return { accepted: true, progress: heartbeatNumber === 1 ? 10 : 10 };
      },
      stalledProgressHeartbeats: 2,
      onFallback: () => {
        fallbacks += 1;
      },
    });

    await transport.start(target);
    const firstStall = await transport.tick();
    const secondStall = await transport.tick();

    expect(firstStall).toMatchObject({
      status: 'healthy',
      isHealthy: true,
      consecutiveStalls: 1,
      shouldFallback: false,
    });
    expect(secondStall).toMatchObject({
      status: 'stalled',
      isHealthy: false,
      reason: 'stalled-progress',
      consecutiveStalls: 2,
      shouldFallback: true,
    });
    expect(fallbacks).toBe(1);
  });

  test('stop resets heartbeat failure state before the next run', async () => {
    let calls = 0;
    const transport = createTablessTransport({
      enabled: true,
      heartbeat: async (): Promise<TablessHeartbeat> => {
        calls += 1;
        return calls === 1 ? { accepted: false } : { accepted: true, progress: 2 };
      },
    });

    await transport.start(target);
    await transport.stop();
    const restarted = await transport.start(target);

    expect(restarted).toMatchObject({
      status: 'healthy',
      isHealthy: true,
      consecutiveFailures: 0,
    });
  });
});
