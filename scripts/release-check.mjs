import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EXTENSION_MANIFEST, TWITCH_MATCHES } from '../src/shared/extension-manifest.ts';
import { runSteps } from './release-check-ui.mjs';

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

async function checkReleaseManifestForTarget(target) {
  const packageJson = await readJson('package.json');
  const manifestPath = join('.output', target, 'manifest.json');
  const manifest = await readJson(manifestPath);

  if (packageJson.version !== manifest.version) {
    throw new Error(
      `${target}: package.json version ${packageJson.version} does not match generated manifest ${manifest.version}`,
    );
  }

  assertEqual(`${target} manifest_version`, manifest.manifest_version, 3);
  assertEqual(`${target} permissions`, manifest.permissions, EXTENSION_MANIFEST.permissions);
  assertEqual(
    `${target} optional_permissions`,
    manifest.optional_permissions,
    EXTENSION_MANIFEST.optional_permissions,
  );
  assertEqual(`${target} host_permissions`, manifest.host_permissions, EXTENSION_MANIFEST.host_permissions);
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
  await checkReleaseManifestForTarget('chrome-mv3');
  await checkReleaseManifestForTarget('edge-mv3');

  return { stdout: 'Chrome and Edge manifests are release-ready\n' };
}

const result = await runSteps([
  { name: 'TypeScript', command: ['bun', 'run', 'test:ts'] },
  { name: 'Biome', command: ['bun', 'run', 'lint'] },
  { name: 'Tests', command: ['bun', 'run', 'test'] },
  { name: 'Build Chrome + Edge', command: ['bun', 'run', 'build:all'] },
  { name: 'Release manifests', run: checkReleaseManifests },
]);

process.exit(result.exitCode);
