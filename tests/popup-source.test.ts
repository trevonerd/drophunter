import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '..');

test('popup keeps the account-link lock indicator in the game selector', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain("game.isConnected === false ? '\\u{1F512} ' : ''");
});

test('popup does not duplicate refresh loading state under the game selector', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).not.toContain("setQueueMessage('Refreshing campaigns from Twitch...')");
});

test('popup applies returned app state after drops page refresh', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain('response?.appState ??');
  expect(source).not.toContain('prev.dropsPageRefreshInProgress ? { ...prev, dropsPageRefreshInProgress: false }');
});

test('popup uses a single campaign sync panel for empty, stale, syncing, failed, and fresh states', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain("type CampaignSyncStatus = 'empty' | 'fresh' | 'stale' | 'syncing' | 'failed'");
  expect(source).toContain('function CampaignSyncPanel');
  expect(source).toContain('aria-live="polite"');
  expect(source).toContain('Opening Twitch Drops and updating campaigns…');
  expect(source).toContain('Could not update. Old data is still shown.');
});

test('popup splits the main campaign UI into focused components', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain('function PopupHeader');
  expect(source).toContain('function CampaignSelector');
  expect(source).toContain('function QueueChips');
  expect(source).toContain('function RewardList');
});

test('popup async copy uses ellipsis glyphs instead of three-dot loading text', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).not.toContain('Loading...');
  expect(source).not.toContain('Refreshing...');
  expect(source).not.toContain('Starting...');
  expect(source).toContain('Loading…');
  expect(source).toContain('Refreshing…');
  expect(source).toContain('Starting…');
});

test('popup exposes a quick audio toggle for the farming tab', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain('Turn stream audio on');
  expect(source).toContain('Mute stream audio');
  expect(source).toContain('handleMuteFarmingTabToggle');
  expect(source).toContain('<SpeakerIcon muted={state.muteFarmingTab} />');
});
