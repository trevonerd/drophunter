import { expect, test } from 'bun:test';
import { buildRuntimeDiagnosticReport } from '../src/shared/runtime-diagnostic-report.ts';

test('copied diagnostics contain only allowed local fields', () => {
  const report = buildRuntimeDiagnosticReport([
    {
      build: '3.99.0.43',
      campaign: 'campaign:smite2',
      phase: 'recovering',
      failureKind: 'open-failed',
      attempt: 2,
      deadline: 123,
      timestamp: 100,
      operation: 'directory',
      httpStatus: 503,
      outcome: 'failed',
      oauthToken: 'secret',
      error: 'Bearer secret',
    },
  ]);
  expect(report).toContain('open-failed');
  expect(report).toContain('503');
  expect(report).not.toContain('secret');
  expect(report).not.toContain('Bearer');
});
