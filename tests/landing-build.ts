import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const repoRoot = resolve(import.meta.dir, '..');
export const landingRoot = join(repoRoot, 'landing');
export const distRoot = join(landingRoot, 'dist');

const lockDir = join(landingRoot, '.build.lock');
const ownerPath = join(lockDir, 'owner');
const staleAfterMs = 60_000;

async function wait(ms: number) {
  await new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function reclaimStaleLock(): Promise<void> {
  try {
    const raw = await readFile(ownerPath, 'utf8');
    const [pidText, startedText] = raw.split('\n');
    const pid = Number(pidText);
    const startedAt = Number(startedText);
    const ownedByLiveProcess = Number.isInteger(pid) && pid > 0 && pidIsAlive(pid);
    const fresh = Number.isFinite(startedAt) && Date.now() - startedAt < staleAfterMs;
    if (ownedByLiveProcess && fresh) return;
  } catch {
    // Missing or unreadable owner file: the lock is leftover from a killed run.
  }
  await rm(lockDir, { recursive: true, force: true });
}

async function withBuildLock<T>(run: () => T | Promise<T>): Promise<T> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      await mkdir(lockDir);
      await writeFile(ownerPath, `${process.pid}\n${Date.now()}\n`);
      try {
        return await run();
      } finally {
        await rm(lockDir, { recursive: true, force: true });
      }
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (code !== 'EEXIST') throw error;
      await reclaimStaleLock();
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
