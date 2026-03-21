import { readFileSync, writeFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    react(),
    {
      // Single source of truth: read version from package.json and write it
      // into dist/manifest.json so only package.json needs bumping on release.
      name: 'sync-manifest-version',
      closeBundle() {
        const { version } = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));
        const manifestPath = resolve(__dirname, 'dist/manifest.json');
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        manifest.version = version;
        writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      },
    },
    {
      // Wrap content scripts in IIFE with duplicate-injection guard.
      // Chrome may re-inject content scripts during SPA navigation or
      // extension reloads; bare top-level `const` would throw
      // "Identifier already declared".  The guard `return`s early from
      // the IIFE so no listeners/observers are registered twice.
      name: 'wrap-content-scripts-iife',
      generateBundle(_, bundle) {
        const guards: Record<string, string> = {
          'content.js': '__drophunter_content__',
          'integrity-interceptor.js': '__drophunter_interceptor__',
        };
        for (const [fileName, chunk] of Object.entries(bundle)) {
          const guard = guards[fileName];
          if (guard && chunk.type === 'chunk') {
            chunk.code = `(function(){if(window["${guard}"])return;window["${guard}"]=true;${chunk.code}})();\n`;
          }
        }
      },
    },
  ],
  base: './',
  build: {
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        monitor: resolve(__dirname, 'monitor.html'),
        background: resolve(__dirname, 'src/background/service-worker.ts'),
        content: resolve(__dirname, 'src/content/content-script.ts'),
        'integrity-interceptor': resolve(__dirname, 'src/content/integrity-interceptor.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') return 'background.js';
          if (chunkInfo.name === 'content') return 'content.js';
          if (chunkInfo.name === 'integrity-interceptor') return 'integrity-interceptor.js';
          return 'assets/[name]-[hash].js';
        },
        manualChunks: (id) => {
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/')) {
            return 'react-vendor';
          }
          if (id.includes('/src/shared/ErrorBoundary.tsx') || id.includes('/src/shared/drop-order.ts')) {
            return 'ui-shared';
          }
          return undefined;
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
    target: 'chrome120',
    outDir: 'dist',
    emptyOutDir: true,
  },
});
