import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '..');
const sourceFiles = [
  'src/background/logging.ts',
  'src/background/drops-page-refresh.ts',
  'src/background/extension-lifecycle.ts',
  'src/background/message-router.ts',
  'src/background/monitor-dashboard.ts',
  'src/background/notifications.ts',
  'src/background/playback-orchestrator.ts',
  'src/background/session-orchestrator.ts',
  'src/content/logging.ts',
  'src/popup/logging.ts',
  'src/shared/ErrorBoundary.tsx',
  'src/background/state-persistence.ts',
  'src/content/content-script.ts',
  'src/content/integrity-interceptor.ts',
  'src/popup/App.tsx',
];

const directConsoleAllowed = new Set([
  'src/background/logging.ts',
  'src/content/logging.ts',
  'src/content/integrity-interceptor.ts',
  'src/popup/logging.ts',
  'src/shared/ErrorBoundary.tsx',
]);

describe('logging hygiene', () => {
  test('does not use console.log in runtime source', () => {
    for (const file of sourceFiles) {
      const source = readFileSync(join(repoRoot, file), 'utf-8');
      expect(source).not.toContain('console.log');
    }
  });

  test('keeps direct console calls inside logger modules or the error boundary', () => {
    for (const file of sourceFiles) {
      const source = readFileSync(join(repoRoot, file), 'utf-8');
      const relativeFile = relative(repoRoot, join(repoRoot, file));
      if (directConsoleAllowed.has(relativeFile)) {
        continue;
      }

      expect(source).not.toMatch(/\bconsole\.(debug|info|warn|error)\b/);
    }
  });

  test('declares the build-time debug log flag', () => {
    const viteConfig = readFileSync(join(repoRoot, 'vite.config.ts'), 'utf-8');
    const backgroundLogger = readFileSync(join(repoRoot, 'src/background/logging.ts'), 'utf-8');

    expect(viteConfig).toContain('__DROPHUNTER_DEBUG_LOGS__');
    expect(backgroundLogger).toContain('__DROPHUNTER_DEBUG_LOGS__');
    expect(backgroundLogger).not.toContain('import.meta.env.DEV');
  });
});
