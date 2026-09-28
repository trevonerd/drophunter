import { copyFile, mkdir, mkdtemp, readdir, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function matchingArchives(outputDir, archivePattern) {
  return (await readdir(outputDir)).filter((name) => archivePattern.test(name));
}

async function restoreArchives(outputDir, backupDir, backupNames, archivePattern) {
  const currentNames = await matchingArchives(outputDir, archivePattern);
  await Promise.all(currentNames.map((name) => unlink(join(outputDir, name))));
  await Promise.all(backupNames.map((name) => copyFile(join(backupDir, name), join(outputDir, name))));
}

export async function withReleaseArchiveRecovery({ outputDir, archivePattern, expectedArchiveNames }, run) {
  await mkdir(outputDir, { recursive: true });
  const backupNames = await matchingArchives(outputDir, archivePattern);
  const backupDir = await mkdtemp(join(tmpdir(), 'drophunter-release-archives-'));
  let snapshotComplete = false;

  try {
    await Promise.all(backupNames.map((name) => copyFile(join(outputDir, name), join(backupDir, name))));
    snapshotComplete = true;
    await Promise.all(backupNames.map((name) => unlink(join(outputDir, name))));
    const result = await run();
    if (result?.exitCode !== 0) {
      await restoreArchives(outputDir, backupDir, backupNames, archivePattern);
      return result;
    }

    const currentNames = await matchingArchives(outputDir, archivePattern);
    const missingExpected = expectedArchiveNames.filter((name) => !currentNames.includes(name));
    if (missingExpected.length > 0) {
      throw new Error(`Release archives are missing: ${missingExpected.join(', ')}`);
    }

    const obsoleteNames = currentNames.filter((name) => !expectedArchiveNames.includes(name));
    await Promise.all(obsoleteNames.map((name) => unlink(join(outputDir, name))));
    return result;
  } catch (error) {
    if (snapshotComplete) await restoreArchives(outputDir, backupDir, backupNames, archivePattern);
    throw error;
  } finally {
    await rm(backupDir, { recursive: true, force: true });
  }
}
