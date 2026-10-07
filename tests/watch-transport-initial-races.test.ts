import { expect, test } from 'bun:test';
import type { WatchProbeResult } from '../src/background/watch-transport.ts';
import { ManagedTabTransport, TablessTransport } from '../src/background/watch-transport.ts';

const session = { owner: 'drophunter', tabId: 7 } as const;

test('Stop during the first managed probe pauses the opened player', async () => {
  const entered = Promise.withResolvers<void>();
  const probe = Promise.withResolvers<WatchProbeResult>();
  let pauses = 0;
  const transport = new ManagedTabTransport({
    open: async () => ({
      ...session,
      health: {
        mode: 'managed-tab',
        isHealthy: true,
        status: 'healthy',
        reason: 'started',
        checkedAt: 1,
        consecutiveFailures: 0,
        consecutiveStalls: 0,
        progress: null,
        shouldFallback: false,
      },
    }),
    probe: () => {
      entered.resolve();
      return probe.promise;
    },
    pause: async () => {
      pauses++;
    },
    close: async () => {},
  });
  const start = transport.start({ gameId: 'game', channelName: 'channel' });
  await entered.promise;
  await transport.stop();
  probe.resolve({ accepted: true });
  await start;
  expect(pauses).toBe(1);
  expect(transport.currentOwnership()).toBeNull();
});

test('immediate tabless Stop cancels start before its first heartbeat', async () => {
  let calls = 0;
  const transport = new TablessTransport({
    enabled: true,
    heartbeat: async () => {
      calls++;
      return { accepted: true };
    },
  });
  const start = transport.start({ gameId: 'game', channelName: 'channel' });
  await transport.stop();
  await start;
  expect(calls).toBe(0);
  expect(transport.currentOwnership()).toBeNull();
});
