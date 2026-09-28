import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

const extensionPath = resolve(process.cwd(), '.output/chrome-mv3');

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
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
