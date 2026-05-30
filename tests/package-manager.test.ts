import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import packageJson from '../package.json';

const repoRoot = join(import.meta.dir, '..');

describe('package manager', () => {
  test('uses Bun as the only committed package manager lockfile', () => {
    expect(packageJson.packageManager).toBe('bun@1.3.9');
    expect(packageJson.engines?.bun).toBe('>=1.3.9');
    expect(packageJson.scripts?.preinstall).toContain("startsWith('bun/')");

    expect(existsSync(join(repoRoot, 'bun.lock'))).toBe(true);
    expect(existsSync(join(repoRoot, 'bun.lockb'))).toBe(false);
    expect(existsSync(join(repoRoot, 'pnpm-lock.yaml'))).toBe(false);
    expect(existsSync(join(repoRoot, 'package-lock.json'))).toBe(false);
    expect(existsSync(join(repoRoot, 'yarn.lock'))).toBe(false);
  });
});
