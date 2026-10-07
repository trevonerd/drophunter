import { afterAll, afterEach, beforeEach, expect } from 'bun:test';

/** Verify diagnostic text in suites that deliberately exercise recovery and failure paths. */
export function verifyExpectedDiagnostics(
  expected: readonly (readonly [string, number | readonly [number, number]])[],
): void {
  const allowed = new Map(expected);
  const observed = new Map<string, number>();
  const originalWarn = console.warn;
  const originalError = console.error;
  const unexpected: Array<{ level: string; arguments: unknown[] }> = [];
  const capture =
    (level: 'warn' | 'error') =>
    (...args: unknown[]) => {
      const text = args.filter((arg) => typeof arg === 'string').join(' ');
      if (level === 'warn' && allowed.has(text)) observed.set(text, (observed.get(text) ?? 0) + 1);
      // A console.error is never an expected recovery warning.
      if (level !== 'warn' || !allowed.has(text)) unexpected.push({ level, arguments: args });
    };
  const warn = capture('warn');
  const error = capture('error');
  const install = () => {
    console.warn = warn;
    console.error = error;
  };
  const verify = () => {
    const received = unexpected.splice(0);
    expect(received, 'Unexpected console diagnostics').toEqual([]);
  };
  install();
  beforeEach(install);
  afterEach(verify);
  afterAll(() => {
    try {
      verify();
      for (const [text, expectedCount] of allowed) {
        const count = observed.get(text) ?? 0;
        if (typeof expectedCount === 'number') expect(count, text).toBe(expectedCount);
        else {
          expect(count, text).toBeGreaterThanOrEqual(expectedCount[0]);
          expect(count, text).toBeLessThanOrEqual(expectedCount[1]);
        }
      }
    } finally {
      console.warn = originalWarn;
      console.error = originalError;
    }
  });
}
