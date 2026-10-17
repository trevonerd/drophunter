import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { SELINE } from '../src/seline.ts';

const dest = join(import.meta.dir, '..', 'public', 'sl', 'seline.js');

const response = await fetch(SELINE.scriptOrigin);
if (!response.ok) {
  throw new Error(`Failed to fetch ${SELINE.scriptOrigin}: ${response.status}`);
}

const body = await response.text();
if (!body.includes('window.seline') || !body.includes('/ennui/blase')) {
  throw new Error(`${SELINE.scriptOrigin} did not look like the Seline tracker`);
}

await mkdir(dirname(dest), { recursive: true });
await writeFile(dest, body);
console.log(`Wrote ${dest} (${body.length} bytes)`);
