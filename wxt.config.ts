import react from '@vitejs/plugin-react';
import { defineConfig } from 'wxt';
import { EXTENSION_MANIFEST } from './src/shared/extension-manifest';

export default defineConfig({
  srcDir: 'src',
  browser: 'chrome',
  targetBrowsers: ['chrome', 'edge'],
  manifestVersion: 3,
  manifest: EXTENSION_MANIFEST,
  vite: (configEnv) => ({
    define: {
      __DROPHUNTER_DEBUG_LOGS__: JSON.stringify(configEnv.mode !== 'production'),
    },
    plugins: [react()],
  }),
  zip: {
    artifactTemplate: 'drophunter-{{version}}-{{browser}}.zip',
    zipSources: false,
  },
});
