import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '..');

test('popup keeps the account-link lock indicator in the game selector', () => {
  const source = readFileSync(join(repoRoot, 'src/popup/App.tsx'), 'utf-8');

  expect(source).toContain("game.isConnected === false ? '\\u{1F512} ' : ''");
});
