import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface ManifestContentScript {
  matches?: string[];
}

interface ExtensionManifest {
  permissions?: string[];
  optional_permissions?: string[];
  host_permissions?: string[];
  content_scripts?: ManifestContentScript[];
  version?: string;
}

const manifest = JSON.parse(
  readFileSync(resolve(import.meta.dir, '../public/manifest.json'), 'utf-8'),
) as ExtensionManifest;
const packageJson = JSON.parse(
  readFileSync(resolve(import.meta.dir, '../package.json'), 'utf-8'),
) as { version?: string };

describe('manifest permissions', () => {
  test('does not request sensitive tab or cookie permissions', () => {
    expect(manifest.permissions ?? []).not.toContain('tabs');
    expect(manifest.permissions ?? []).not.toContain('cookies');
  });

  test('requests notifications only as an optional permission', () => {
    expect(manifest.permissions ?? []).not.toContain('notifications');
    expect(manifest.optional_permissions).toEqual(['notifications']);
  });

  test('does not request broad host access', () => {
    const hosts = manifest.host_permissions ?? [];
    expect(hosts).not.toContain('<all_urls>');
    expect(hosts).not.toContain('*://*/*');
    expect(hosts).not.toContain('https://*/*');
    expect(hosts).not.toContain('http://*/*');
  });

  test('uses one Twitch-only host pattern everywhere', () => {
    const expected = ['https://*.twitch.tv/*'];

    expect(manifest.host_permissions).toEqual(expected);
    for (const script of manifest.content_scripts ?? []) {
      expect(script.matches).toEqual(expected);
    }
  });

  test('keeps package and source manifest versions aligned', () => {
    expect(manifest.version).toBe(packageJson.version);
  });

  test('content script keeps runtime code self-contained for classic injection', () => {
    const source = readFileSync(
      resolve(import.meta.dir, '../src/content/content-script.ts'),
      'utf-8',
    );

    expect(source).not.toContain("from '../shared/");
    expect(source).not.toContain('from "../shared/');
  });
});
