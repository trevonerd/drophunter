import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface ManifestContentScript {
  matches?: string[];
}

interface ExtensionManifest {
  permissions?: string[];
  host_permissions?: string[];
  content_scripts?: ManifestContentScript[];
}

const manifest = JSON.parse(
  readFileSync(resolve(import.meta.dir, '../public/manifest.json'), 'utf-8'),
) as ExtensionManifest;

describe('manifest permissions', () => {
  test('does not request sensitive tab or cookie permissions', () => {
    expect(manifest.permissions ?? []).not.toContain('tabs');
    expect(manifest.permissions ?? []).not.toContain('cookies');
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
});
