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
  'src/background/telegram-notifications.ts',
  'src/background/playback-orchestrator.ts',
  'src/background/session-orchestrator.ts',
  'src/background/twitch-api/client.ts',
  'src/background/twitch-api/claimed-rewards.ts',
  'src/content/logging.ts',
  'src/popup/logging.ts',
  'src/shared/ErrorBoundary.tsx',
  'src/background/state-persistence.ts',
  'src/content/app-state.ts',
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
    const wxtConfig = readFileSync(join(repoRoot, 'wxt.config.ts'), 'utf-8');
    const backgroundLogger = readFileSync(join(repoRoot, 'src/background/logging.ts'), 'utf-8');

    expect(wxtConfig).toContain('__DROPHUNTER_DEBUG_LOGS__');
    expect(backgroundLogger).toContain('__DROPHUNTER_DEBUG_LOGS__');
    expect(backgroundLogger).not.toContain('import.meta.env.DEV');
  });

  test('does not keep per-campaign or per-drop Twitch parser logs', () => {
    const twitchClient = readFileSync(join(repoRoot, 'src/background/twitch-api/client.ts'), 'utf-8');
    const claimedRewards = readFileSync(
      join(repoRoot, 'src/background/twitch-api/claimed-rewards.ts'),
      'utf-8',
    );

    expect(twitchClient).not.toContain('[parseGameFromCampaign]');
    expect(twitchClient).not.toContain('[parseCampaignDrops]');
    expect(twitchClient).not.toContain('[parseEventBasedDrops]');
    expect(twitchClient).not.toContain('benefitIds=[');
    expect(twitchClient).not.toContain('idMatch=');
    expect(twitchClient).not.toContain('Raw inventory keys');
    expect(twitchClient).not.toContain('InProgress campaign=');
    expect(claimedRewards).not.toContain('[buildClaimedRewardLookup]');
  });
});
