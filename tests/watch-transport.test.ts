import { describe, expect, test } from 'bun:test';
import {
  createTablessTransport,
  type FarmingTarget,
  type ManagedTabSession,
  ManagedTabTransport,
  TABLESS_HEARTBEAT_FAILURE_LIMIT,
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
  test('starts inactive without focusing and delegates only to the managed tab adapter', async () => {
    const calls: string[] = [];
    let startOptions: { active: false; focus: false } | null = null;
    const transport = new ManagedTabTransport({
      open: async (_target, options) => {
        startOptions = options;
        calls.push('open');
        return managedSession;
      },
      probe: async (session) => {
        expect(session).toBe(managedSession);
        calls.push('probe');
        return { accepted: true, progress: 12 };
      },
      close: async (session) => {
        expect(session).toBe(managedSession);
        calls.push('close');
      },
      now: () => 1_000,
    });

    const started = await transport.start(target);
    const ticked = await transport.tick();
    await transport.stop();

    expect(startOptions).toEqual({ active: false, focus: false });
    expect(calls).toEqual(['open', 'probe', 'close']);
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
      shouldFallback: false,
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

  test('requests fallback exactly after five failed heartbeats', async () => {
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
    for (let index = 1; index < TABLESS_HEARTBEAT_FAILURE_LIMIT; index += 1) {
      health = await transport.tick();
    }

    expect(heartbeats).toBe(TABLESS_HEARTBEAT_FAILURE_LIMIT);
    expect(fallbacks).toBe(1);
    expect(health).toMatchObject({
      mode: 'tabless',
      isHealthy: false,
      status: 'failed',
      reason: 'heartbeat-failed',
      consecutiveFailures: TABLESS_HEARTBEAT_FAILURE_LIMIT,
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
