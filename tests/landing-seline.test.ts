import { beforeAll, describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { distRoot, ensureLandingBuilt, landingRoot, repoRoot } from './landing-build';

const forbidden = [
  'visitortracking',
  'init-tracer',
  'init_tracer',
  'addEventTrace',
  'app.visitortracking.com',
];

async function walkFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.astro') {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(path)));
    } else {
      files.push(path);
    }
  }
  return files;
}

function collectTags(html: string, tag: 'a' | 'button'): string[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'gi'))].map((match) => match[0]);
}

function attr(tag: string, name: string): string | undefined {
  const quoted = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return quoted?.[2] ?? quoted?.[3];
}

describe('landing Seline analytics', () => {
  beforeAll(async () => {
    await ensureLandingBuilt();
  }, 120_000);

  test('every built <a> and <button> has data-sln-event', async () => {
    const htmlFiles = (await walkFiles(distRoot)).filter((path) => path.endsWith('.html'));
    expect(htmlFiles.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const file of htmlFiles) {
      const html = await readFile(file, 'utf8');
      const rel = relative(distRoot, file);
      for (const tagName of ['a', 'button'] as const) {
        for (const tag of collectTags(html, tagName)) {
          if (!attr(tag, 'data-sln-event')) {
            missing.push(`${rel}: ${tag}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test('installs Seline from the official first-party proxy without outbound double-count', async () => {
    const html = await readFile(join(distRoot, 'index.html'), 'utf8');
    const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map((match) => match[0]);
    const seline = scripts.find((tag) => attr(tag, 'src') === 'https://sln.getdrophunter.com/ennui.js');
    expect(seline).toBeDefined();
    if (!seline) return;
    expect(attr(seline, 'data-token')).toBe('3d5e8c67a801c30');
    expect(attr(seline, 'data-api-host')).toBe('https://sln.getdrophunter.com');
    expect(/\basync\b/i.test(seline)).toBe(true);
    expect(attr(seline, 'data-outbound')).toBeUndefined();
    expect(html.indexOf('<head>')).toBeGreaterThan(-1);
    expect(html.indexOf(seline)).toBeLessThan(html.indexOf('</head>'));
    expect(html).not.toContain('/sl/seline.js');
    expect(html).not.toContain('/sl/api');
  });

  test('drops Visitor Tracking from the landing package and built HTML', async () => {
    const sourceFiles = await walkFiles(join(landingRoot, 'src'));
    const publicFiles = await walkFiles(join(landingRoot, 'public'));
    const distFiles = await walkFiles(distRoot);
    const configFiles = [join(landingRoot, 'netlify.toml')];
    const needle = forbidden.join('|');
    const pattern = new RegExp(needle, 'i');
    const hits: string[] = [];
    for (const file of [...sourceFiles, ...publicFiles, ...distFiles, ...configFiles]) {
      if (!/\.(astro|css|html|js|mjs|toml|ts|txt|xml)$/i.test(file)) continue;
      const text = await readFile(file, 'utf8');
      if (pattern.test(text)) {
        hits.push(relative(repoRoot, file));
      }
    }
    expect(hits).toEqual([]);
  });

  test('allows only the official Seline proxy in CSP and has no /sl rewrite', async () => {
    const toml = await readFile(join(landingRoot, 'netlify.toml'), 'utf8');
    expect(toml).not.toContain('/sl/seline.js');
    expect(toml).not.toContain('/sl/api');
    expect(toml).not.toContain('cdn.seline.com');
    expect(toml).not.toContain('api.seline.com');
    const csp = toml.match(/Content-Security-Policy = "([^"]+)"/)?.[1] ?? '';
    expect(csp).toMatch(/script-src 'self' https:\/\/sln\.getdrophunter\.com(;|$)/);
    expect(csp).toMatch(/connect-src 'self' https:\/\/sln\.getdrophunter\.com(;|$)/);
    expect(csp).not.toContain('visitortracking');
  });
});
