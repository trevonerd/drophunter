import { spawnSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const repoRoot = resolve(import.meta.dir, '..');
export const landingRoot = join(repoRoot, 'landing');
export const distRoot = join(landingRoot, 'dist');

const lockDir = join(landingRoot, '.build.lock');

async function wait(ms: number) {
  await new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

async function withBuildLock<T>(run: () => T | Promise<T>): Promise<T> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      await mkdir(lockDir);
      try {
        return await run();
      } finally {
        await rm(lockDir, { recursive: true, force: true });
      }
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (code !== 'EEXIST') throw error;
      await wait(200);
    }
  }
  throw new Error('Timed out waiting for the landing build lock');
}

export async function ensureLandingBuilt(): Promise<void> {
  await withBuildLock(() => {
    const install = spawnSync('bun', ['install', '--frozen-lockfile'], {
      cwd: landingRoot,
      stdio: 'inherit',
    });
    if (install.status !== 0) {
      throw new Error('bun install --frozen-lockfile failed in landing/');
    }
    const build = spawnSync('bun', ['run', 'build'], { cwd: landingRoot, stdio: 'inherit' });
    if (build.status !== 0) {
      throw new Error('bun run build failed in landing/');
    }
  });
}
