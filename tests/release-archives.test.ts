import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withReleaseArchiveRecovery } from '../scripts/release-archives.mjs';

const archivePattern = /^drophunter-.*-(chrome|edge)\.zip$/;
const expectedChromeArchive = 'drophunter-4.0.0-chrome.zip';
const expectedEdgeArchive = 'drophunter-4.0.0-edge.zip';
const expectedArchiveNames = [expectedChromeArchive, expectedEdgeArchive];
let outputDir: string;

async function setupOutput() {
  outputDir = await mkdtemp(join(tmpdir(), 'drophunter-release-test-'));
}

afterEach(async () => {
  if (outputDir) await rm(outputDir, { recursive: true, force: true });
});

describe('release archive recovery', () => {
  test('restores every previous archive and removes partial output after a failed release step', async () => {
    await setupOutput();
    const previousChrome = 'previous chrome archive';
    const previousEdge = 'previous edge archive';
    await writeFile(join(outputDir, 'drophunter-3.99.0-chrome.zip'), previousChrome);
    await writeFile(join(outputDir, 'drophunter-3.99.0-edge.zip'), previousEdge);

    const result = await withReleaseArchiveRecovery(
      { outputDir, archivePattern, expectedArchiveNames },
      async () => {
        expect(await readdir(outputDir)).toEqual([]);
        await writeFile(join(outputDir, expectedChromeArchive), 'new partial archive');
        return { exitCode: 2 };
      },
    );

    expect(result.exitCode).toBe(2);
    expect(await readFile(join(outputDir, 'drophunter-3.99.0-chrome.zip'), 'utf8')).toBe(previousChrome);
    expect(await readFile(join(outputDir, 'drophunter-3.99.0-edge.zip'), 'utf8')).toBe(previousEdge);
    expect((await readdir(outputDir)).sort()).toEqual([
      'drophunter-3.99.0-chrome.zip',
      'drophunter-3.99.0-edge.zip',
    ]);
  });

  test('removes previous versions only after the new Chrome and Edge pair is complete', async () => {
    await setupOutput();
    await writeFile(join(outputDir, 'drophunter-3.99.0-chrome.zip'), 'old chrome');
    await writeFile(join(outputDir, 'drophunter-3.99.0-edge.zip'), 'old edge');

    const result = await withReleaseArchiveRecovery(
      { outputDir, archivePattern, expectedArchiveNames },
      async () => {
        expect(await readdir(outputDir)).toEqual([]);
        await writeFile(join(outputDir, expectedChromeArchive), 'new chrome');
        await writeFile(join(outputDir, expectedEdgeArchive), 'new edge');
        return { exitCode: 0 };
      },
    );

    expect(result.exitCode).toBe(0);
    expect((await readdir(outputDir)).sort()).toEqual(expectedArchiveNames);
  });

  test('restores previous archives when a successful command fails archive validation', async () => {
    await setupOutput();
    await writeFile(join(outputDir, 'drophunter-3.99.0-chrome.zip'), 'old chrome');

    await expect(
      withReleaseArchiveRecovery({ outputDir, archivePattern, expectedArchiveNames }, async () => {
        await writeFile(join(outputDir, expectedChromeArchive), 'new chrome only');
        return { exitCode: 0 };
      }),
    ).rejects.toThrow('Release archives are missing');

    expect(await readFile(join(outputDir, 'drophunter-3.99.0-chrome.zip'), 'utf8')).toBe('old chrome');
    expect((await readdir(outputDir)).sort()).toEqual(['drophunter-3.99.0-chrome.zip']);
  });
});
