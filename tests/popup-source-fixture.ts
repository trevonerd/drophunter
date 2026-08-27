import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '..');

export function readPopupSource(): string {
  const popupDir = join(repoRoot, 'src/popup');
  return readdirSync(popupDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name))
    .sort()
    .map((filePath) => readFileSync(filePath, 'utf-8'))
    .join('\n');
}
