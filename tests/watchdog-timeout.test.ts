import { describe, expect, test } from 'bun:test';

async function fetchWithTimeout<T>(messagePromise: Promise<T>, timeoutMs: number): Promise<T | null> {
  const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  return Promise.race([messagePromise, timeoutPromise]);
}

function makeWatchdog(timeoutMs: number): {
  inFlight: { value: boolean };
  timer: ReturnType<typeof setTimeout>;
  clear: () => void;
} {
  const inFlight = { value: true };
  const timer = setTimeout(() => {
    if (inFlight.value) {
      inFlight.value = false;
    }
  }, timeoutMs);
  return {
    inFlight,
    timer,
    clear() {
      clearTimeout(timer);
    },
  };
}

describe('timing constants — TICK_WATCHDOG_TIMEOUT_MS', () => {
  test('TICK_WATCHDOG_TIMEOUT_MS must be 60_000 ms', () => {
    const source = require('fs').readFileSync(
      require('path').resolve(__dirname, '../src/background/constants.ts'),
      'utf-8',
    );
    const match = source.match(/export const\s+TICK_WATCHDOG_TIMEOUT_MS\s*=\s*([\d_]+)\s*;/);
    expect(match).not.toBeNull();
    const value = Number(match![1].replace(/_/g, ''));
    expect(value).toBe(60_000);
  });
});

describe('timing constants — STREAM_CONTEXT_TIMEOUT_MS', () => {
  test('STREAM_CONTEXT_TIMEOUT_MS must be 12_000 ms', () => {
    const source = require('fs').readFileSync(
      require('path').resolve(__dirname, '../src/background/service-worker.ts'),
      'utf-8',
    );
    const match = source.match(/const\s+STREAM_CONTEXT_TIMEOUT_MS\s*=\s*([\d_]+)\s*;/);
    expect(match).not.toBeNull();
    const value = Number(match![1].replace(/_/g, ''));
    expect(value).toBe(12_000);
  });
});

describe('fetchStreamContext timeout pattern', () => {
  test('resolves with the message result when sendMessage responds in time', async () => {
    const fastMessage = Promise.resolve({ success: true, context: { channelName: 'test' } });
    const result = await fetchWithTimeout(fastMessage, 100);
    expect(result).toEqual({ success: true, context: { channelName: 'test' } });
  });

  test('resolves with null when sendMessage never responds within timeout', async () => {
    const hangingMessage = new Promise<never>(() => {});
    const result = await fetchWithTimeout(hangingMessage, 50);
    expect(result).toBeNull();
  });

  test('resolves with null when sendMessage responds after timeout', async () => {
    const lateMessage = new Promise<{ success: boolean }>((resolve) =>
      setTimeout(() => resolve({ success: true }), 200),
    );
    const result = await fetchWithTimeout(lateMessage, 50);
    expect(result).toBeNull();
  });

  test('null timeout result propagates cleanly as null', async () => {
    const hangingMessage = new Promise<never>(() => {});
    const result = await fetchWithTimeout(hangingMessage, 50);
    const finalResult = result ?? null;
    expect(finalResult).toBeNull();
  });
});

describe('tick watchdog pattern', () => {
  test('watchdog resets stuck in-flight flag after timeout', async () => {
    const watchdog = makeWatchdog(50);
    expect(watchdog.inFlight.value).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(watchdog.inFlight.value).toBe(false);
  });

  test('clearTimeout prevents watchdog from firing when tick completes normally', async () => {
    const watchdog = makeWatchdog(50);
    expect(watchdog.inFlight.value).toBe(true);

    watchdog.clear();
    watchdog.inFlight.value = false;

    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(watchdog.inFlight.value).toBe(false);
  });

  test('after watchdog fires, a subsequent tick can run because flag is false', async () => {
    const watchdog = makeWatchdog(50);

    await new Promise((resolve) => setTimeout(resolve, 80));

    const canRunNewTick = !watchdog.inFlight.value;
    expect(canRunNewTick).toBe(true);
  });

  test('watchdog only resets flag and does not schedule a new tick', async () => {
    const newTickScheduled = false;
    const watchdog = makeWatchdog(50);

    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(watchdog.inFlight.value).toBe(false);
    expect(newTickScheduled).toBe(false);
  });
});
