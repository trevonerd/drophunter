import { mkdir, readdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { EXTENSION_MANIFEST, TWITCH_MATCHES } from '../src/shared/extension-manifest.ts';
import { resolveReleaseVersion } from '../src/shared/release-version.ts';
import { runSteps } from './release-check-ui.mjs';

const RELEASE_ARCHIVE_PATTERN = /^drophunter-.*-(chrome|edge)\.zip$/;

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read ${path}: ${error.message}`);
  }
}

function stable(value) {
  return JSON.stringify(value ?? null);
}

function assertEqual(label, actual, expected) {
  if (stable(actual) !== stable(expected)) {
    throw new Error(`${label} mismatch in generated manifest`);
  }
}

function findContentScript(manifest, expected) {
  return (manifest.content_scripts ?? []).find((script) => {
    return (
      stable(script.matches) === stable(expected.matches) &&
      script.run_at === expected.run_at &&
      (script.world ?? 'ISOLATED') === expected.world
    );
  });
}

async function assertClassicScript(path) {
  const source = await readFile(path, 'utf8').catch((error) => {
    throw new Error(`Unable to read ${path}: ${error.message}`);
  });
  const moduleSyntax = /\bimport\s*(?:\(|["'{*])|\bexport\s+(?:\{|default|const|function|class|let|var)/;
  if (moduleSyntax.test(source)) {
    throw new Error(`${path} contains ESM syntax but is injected as a classic Chrome content script`);
  }
}

async function readPackageRelease() {
  const packageJson = await readJson('package.json');
  if (typeof packageJson.version !== 'string') {
    throw new Error('package.json version must be a string');
  }
  return {
    packageVersion: packageJson.version,
    releaseVersion: resolveReleaseVersion(packageJson.version),
  };
}

async function checkReleaseManifestForTarget(target, packageRelease) {
  const manifestPath = join('.output', target, 'manifest.json');
  const manifest = await readJson(manifestPath);

  if (packageRelease.releaseVersion.manifestVersion !== manifest.version) {
    throw new Error(
      `${target}: expected manifest version ${packageRelease.releaseVersion.manifestVersion}, got ${manifest.version}`,
    );
  }
  const expectedVersionName =
    packageRelease.releaseVersion.channel === 'beta' ? packageRelease.releaseVersion.versionName : undefined;
  assertEqual(`${target} version_name`, manifest.version_name, expectedVersionName);

  assertEqual(`${target} manifest_version`, manifest.manifest_version, 3);
  assertEqual(`${target} permissions`, manifest.permissions, EXTENSION_MANIFEST.permissions);
  assertEqual(
    `${target} optional_permissions`,
    manifest.optional_permissions,
    EXTENSION_MANIFEST.optional_permissions,
  );
  assertEqual(`${target} host_permissions`, manifest.host_permissions, EXTENSION_MANIFEST.host_permissions);
  assertEqual(
    `${target} optional_host_permissions`,
    manifest.optional_host_permissions,
    EXTENSION_MANIFEST.optional_host_permissions,
  );
  assertEqual(
    `${target} content_security_policy`,
    manifest.content_security_policy,
    EXTENSION_MANIFEST.content_security_policy,
  );

  if (manifest.background?.service_worker !== 'background.js' || manifest.background?.type !== 'module') {
    throw new Error(`${target}: expected module service worker at background.js`);
  }
  if (manifest.action?.default_popup !== 'popup.html') {
    throw new Error(`${target}: expected popup.html as the action popup`);
  }

  const integrityScript = findContentScript(manifest, {
    matches: [...TWITCH_MATCHES],
    run_at: 'document_start',
    world: 'MAIN',
  });
  const contentScript = findContentScript(manifest, {
    matches: [...TWITCH_MATCHES],
    run_at: 'document_idle',
    world: 'ISOLATED',
  });
  if (!integrityScript?.js?.[0]) {
    throw new Error(`${target}: missing MAIN world integrity content script`);
  }
  if (!contentScript?.js?.[0]) {
    throw new Error(`${target}: missing Twitch content script`);
  }

  await assertClassicScript(join('.output', target, integrityScript.js[0]));
  await assertClassicScript(join('.output', target, contentScript.js[0]));

  return { stdout: `${target} manifest, permissions, and classic content scripts are fresh\n` };
}

async function checkReleaseManifests() {
  const packageRelease = await readPackageRelease();
  await checkReleaseManifestForTarget('chrome-mv3', packageRelease);
  await checkReleaseManifestForTarget('edge-mv3', packageRelease);

  return {
    stdout: `Chrome and Edge manifests are release-ready for ${packageRelease.packageVersion}\n`,
  };
}

async function cleanReleaseArchives() {
  await mkdir('.output', { recursive: true });
  const archiveNames = (await readdir('.output')).filter((name) => RELEASE_ARCHIVE_PATTERN.test(name));
  await Promise.all(archiveNames.map((name) => unlink(join('.output', name))));
  return { stdout: 'Old DropHunter release archives removed\n' };
}

async function checkReleaseArchives() {
  const { packageVersion } = await readPackageRelease();
  const expected = [`drophunter-${packageVersion}-chrome.zip`, `drophunter-${packageVersion}-edge.zip`];
  const actual = (await readdir('.output')).filter((name) => RELEASE_ARCHIVE_PATTERN.test(name)).sort();
  assertEqual('release archives', actual, expected);
  return { stdout: `Chrome and Edge archives are release-ready for ${packageVersion}\n` };
}

const result = await runSteps([
  { name: 'TypeScript scope', command: ['bun', 'run', 'check:typescript-scope'] },
  { name: 'TypeScript', command: ['bun', 'run', 'test:ts'] },
  { name: 'Biome', command: ['bun', 'run', 'lint'] },
  { name: 'Tests', command: ['bun', 'run', 'test'] },
  { name: 'Clean release archives', run: cleanReleaseArchives },
  { name: 'Build + package Chrome + Edge', command: ['bun', 'run', 'zip:all'] },
  { name: 'Release manifests', run: checkReleaseManifests },
  { name: 'Release archives', run: checkReleaseArchives },
]);

process.exit(result.exitCode);
