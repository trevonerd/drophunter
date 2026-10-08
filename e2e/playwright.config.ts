import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

const extensionPath = resolve(process.cwd(), '.output/chrome-mv3');

// Playwright sets FORCE_COLOR for workers. Do not forward a conflicting NO_COLOR.
delete process.env.NO_COLOR;

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  // Each test owns its Chrome profile, so files and cases run in parallel. Heavy parallel load can
  // rarely stall the first managed playback commit; a retry reports it as flaky instead of hiding it.
  fullyParallel: true,
  retries: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: 'list',
  outputDir: resolve(process.cwd(), '.output/playwright-e2e-results'),
  use: {
    launchOptions: {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--disable-background-networking',
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
      ],
    },
  },
});
