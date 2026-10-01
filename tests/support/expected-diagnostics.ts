import { afterAll, afterEach, beforeEach, expect } from 'bun:test';

/** Verify diagnostic text in suites that deliberately exercise recovery and failure paths. */
export function verifyExpectedDiagnostics(expected: readonly string[]): void {
  const allowed = new Set(expected);
  const originalWarn = console.warn;
  const originalError = console.error;
  const unexpected: Array<{ level: string; arguments: unknown[] }> = [];
  const capture =
    (level: 'warn' | 'error') =>
    (...args: unknown[]) => {
      const text = args.filter((arg) => typeof arg === 'string').join(' ');
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
    } finally {
      console.warn = originalWarn;
      console.error = originalError;
    }
  });
}
