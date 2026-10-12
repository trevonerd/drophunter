import { expect, test } from 'bun:test';
import type { WatchOwnershipV1 } from '../src/background/farming-automation-contracts.ts';
import { ManagedTabTransport } from '../src/background/managed-tab-transport.ts';
import { createWatchHealth } from '../src/background/watch-health.ts';

const target = { gameId: 'g', channelName: 'w0n23' };
const ownership = { kind: 'managed-tab', tabId: 5 } as unknown as WatchOwnershipV1;

function transport(probes: Array<{ accepted: boolean; sameGame?: boolean }>) {
  let calls = 0;
  let paused = 0;
  const instance = new ManagedTabTransport({
    probeSettleMs: 0,
    open: async () => ({
      owner: 'drophunter',
      tabId: 5,
      ownership,
      health: createWatchHealth('managed-tab', 'healthy', 'started', Date.now),
    }),
    probe: async () => {
      const next = probes[Math.min(calls++, probes.length - 1)] ?? { accepted: false };
      return { ...next, isLive: true, sameChannel: true };
    },
    pause: async () => {
      paused++;
    },
  } as never);
  return { instance, calls: () => calls, paused: () => paused };
}

test('a started player survives a channel header that renders after playback', async () => {
  const { instance, calls, paused } = transport([
    { accepted: false },
    { accepted: false },
    { accepted: true, sameGame: true },
  ]);

  const health = await instance.start(target);

  expect(health.status).toBe('healthy');
  expect(calls()).toBe(3);
  expect(paused()).toBe(0);
});

test('an explicitly wrong category is rejected without waiting', async () => {
  const { instance, calls, paused } = transport([{ accepted: false, sameGame: false }]);

  const health = await instance.start(target);

  expect(health.status).toBe('failed');
  expect(calls()).toBe(1);
  expect(paused()).toBe(1);
});

test('a video Chrome paused in the background asks for one click instead of rotating', async () => {
  let paused = 0;
  const instance = new ManagedTabTransport({
    probeSettleMs: 0,
    open: async () => ({
      owner: 'drophunter',
      tabId: 5,
      ownership,
      health: createWatchHealth('managed-tab', 'healthy', 'started', Date.now),
    }),
    probe: async () => ({
      accepted: false,
      isLive: true,
      sameChannel: true,
      sameGame: true,
      reason: 'playback-inactive',
    }),
    pause: async () => {
      paused++;
    },
  } as never);

  const health = await instance.start(target);

  expect(health.status).toBe('degraded');
  expect(health.reason).toBe('user-interaction-required');
  expect(paused).toBe(0);
});
