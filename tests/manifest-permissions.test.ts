import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import packageJson from '../package.json' with { type: 'json' };
import { EXTENSION_MANIFEST, TWITCH_MATCHES } from '../src/shared/extension-manifest.ts';
import { resolveReleaseVersion } from '../src/shared/release-version.ts';

function runtimeSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = resolve(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      return runtimeSourceFiles(path);
    }
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

describe('manifest permissions', () => {
  test('does not request sensitive tab or cookie permissions', () => {
    expect(EXTENSION_MANIFEST.permissions).not.toContain('tabs');
    expect(EXTENSION_MANIFEST.permissions).not.toContain('cookies');
  });

  test('requests notifications only as an optional permission', () => {
    expect(EXTENSION_MANIFEST.permissions).not.toContain('notifications');
    expect(EXTENSION_MANIFEST.optional_permissions).toEqual(['notifications']);
  });

  test('requests Telegram host access only as an optional host permission', () => {
    expect(EXTENSION_MANIFEST.host_permissions).not.toContain('https://api.telegram.org/*');
    expect(EXTENSION_MANIFEST.optional_host_permissions).toEqual(['https://api.telegram.org/*']);
  });

  test('does not request broad host access', () => {
    const hosts = EXTENSION_MANIFEST.host_permissions;
    expect(hosts).not.toContain('<all_urls>');
    expect(hosts).not.toContain('*://*/*');
    expect(hosts).not.toContain('https://*/*');
    expect(hosts).not.toContain('http://*/*');
  });

  test('declares a strict extension-page content security policy', () => {
    expect(EXTENSION_MANIFEST.content_security_policy.extension_pages).toBe(
      "script-src 'self'; object-src 'self';",
    );
  });

  test('uses one Twitch-only host pattern everywhere', () => {
    const expected = ['https://*.twitch.tv/*'];

    expect(EXTENSION_MANIFEST.host_permissions).toEqual(expected);
    expect(TWITCH_MATCHES).toEqual(expected);
  });

  test('maps the package version to Chrome-compatible WXT manifest metadata', () => {
    const releaseVersion = resolveReleaseVersion(packageJson.version);

    expect(releaseVersion).toEqual({
      channel: 'beta',
      manifestVersion: '3.99.0.13',
      versionName: '4.0.0-beta.13',
    });
  });

  test('declares WXT entrypoints for both Twitch content scripts', () => {
    const contentEntrypoint = readFileSync(
      resolve(import.meta.dir, '../src/entrypoints/content.ts'),
      'utf-8',
    );
    const integrityEntrypoint = readFileSync(
      resolve(import.meta.dir, '../src/entrypoints/integrity-interceptor.content.ts'),
      'utf-8',
    );

    expect(contentEntrypoint).toContain("runAt: 'document_idle'");
    expect(integrityEntrypoint).toContain("runAt: 'document_start'");
    expect(integrityEntrypoint).toContain("world: 'MAIN'");
  });

  test('runtime source does not use the chrome.cookies API', () => {
    const files = runtimeSourceFiles(resolve(import.meta.dir, '../src'));
    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      expect(source).not.toContain('chrome.cookies');
    }
  });
});
