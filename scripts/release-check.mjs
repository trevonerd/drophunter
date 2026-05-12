import { readFile } from 'node:fs/promises';
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
    throw new Error(`${label} mismatch between source manifest and dist manifest`);
  }
}

function contentScriptMatches(manifest) {
  return (manifest.content_scripts ?? []).map((script) => script.matches ?? []);
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

async function checkReleaseManifest() {
  const packageJson = await readJson('package.json');
  const sourceManifest = await readJson('public/manifest.json');
  const distManifest = await readJson('dist/manifest.json');

  if (packageJson.version !== sourceManifest.version) {
    throw new Error(
      `package.json version ${packageJson.version} does not match public/manifest.json ${sourceManifest.version}`,
    );
  }

  if (packageJson.version !== distManifest.version) {
    throw new Error(
      `package.json version ${packageJson.version} does not match dist/manifest.json ${distManifest.version}`,
    );
  }

  assertEqual('permissions', distManifest.permissions, sourceManifest.permissions);
  assertEqual('optional_permissions', distManifest.optional_permissions, sourceManifest.optional_permissions);
  assertEqual('host_permissions', distManifest.host_permissions, sourceManifest.host_permissions);
  assertEqual(
    'content script matches',
    contentScriptMatches(distManifest),
    contentScriptMatches(sourceManifest),
  );
  await assertClassicScript('dist/content.js');
  await assertClassicScript('dist/integrity-interceptor.js');

  return { stdout: 'manifest, permissions, and classic content scripts are fresh\n' };
}

const result = await runSteps([
  { name: 'TypeScript', command: ['bun', 'run', 'test:ts'] },
  { name: 'Biome', command: ['bun', 'run', 'lint'] },
  { name: 'Tests', command: ['bun', 'run', 'test'] },
  { name: 'Build', command: ['bun', 'run', 'build'] },
  { name: 'Release manifest', run: checkReleaseManifest },
]);

process.exit(result.exitCode);
