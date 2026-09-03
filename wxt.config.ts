import react from '@vitejs/plugin-react';
import { defineConfig } from 'wxt';
import packageJson from './package.json' with { type: 'json' };
import { EXTENSION_MANIFEST } from './src/shared/extension-manifest';
import { resolveReleaseVersion } from './src/shared/release-version';

const releaseVersion = resolveReleaseVersion(packageJson.version);
const manifestReleaseVersion =
  releaseVersion.channel === 'beta'
    ? {
        version: releaseVersion.manifestVersion,
        version_name: releaseVersion.versionName,
      }
    : { version: releaseVersion.manifestVersion };

export default defineConfig({
  srcDir: 'src',
  browser: 'chrome',
  targetBrowsers: ['chrome', 'edge'],
  manifestVersion: 3,
  manifest: {
    ...EXTENSION_MANIFEST,
    ...manifestReleaseVersion,
  },
  vite: (configEnv) => ({
    build: {
      modulePreload: false,
    },
    define: {
      __DROPHUNTER_DEBUG_LOGS__: JSON.stringify(configEnv.mode !== 'production'),
    },
    plugins: [react()],
  }),
  zip: {
    artifactTemplate: 'drophunter-{{packageVersion}}-{{browser}}.zip',
    zipSources: false,
  },
});
