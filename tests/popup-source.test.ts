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

test('popup exposes a quick audio toggle for the farming tab', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain('Turn stream audio on');
  expect(source).toContain('Mute stream audio');
  expect(source).toContain('handleMuteFarmingTabToggle');
  expect(source).toContain('<SpeakerIcon muted={state.muteFarmingTab} />');
});
