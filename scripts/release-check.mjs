import { readFile } from 'node:fs/promises';

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    fail(`Unable to read ${path}: ${error.message}`);
  }
}

function fail(message) {
  console.error(`[release:check] ${message}`);
  process.exit(1);
}

function stable(value) {
  return JSON.stringify(value ?? null);
}

function assertEqual(label, actual, expected) {
  if (stable(actual) !== stable(expected)) {
    fail(`${label} mismatch between source manifest and dist manifest`);
  }
}

function contentScriptMatches(manifest) {
  return (manifest.content_scripts ?? []).map((script) => script.matches ?? []);
}

const packageJson = await readJson('package.json');
const sourceManifest = await readJson('public/manifest.json');
const distManifest = await readJson('dist/manifest.json');

if (packageJson.version !== sourceManifest.version) {
  fail(
    `package.json version ${packageJson.version} does not match public/manifest.json ${sourceManifest.version}`,
  );
}

if (packageJson.version !== distManifest.version) {
  fail(
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

console.info('[release:check] manifest versions and permissions are fresh');
