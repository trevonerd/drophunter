import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { copyFileSync, mkdirSync } from 'fs'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-manifest-and-icons',
      closeBundle() {
        // Copia manifest.json
        copyFileSync('public/manifest.json', 'dist/manifest.json')

        // Copia cartella icons
        mkdirSync('dist/icons', { recursive: true })
        const icons = ['icon16.png', 'icon32.png', 'icon48.png', 'icon128.png']
        icons.forEach(icon => {
          copyFileSync(`public/icons/${icon}`, `dist/icons/${icon}`)
        })

        console.log('✓ Copied manifest.json and icons to dist/')
      }
    }
  ],
  base: './',
  build: {
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        monitor: resolve(__dirname, 'monitor.html'),
        background: resolve(__dirname, 'src/background/service-worker.ts'),
        content: resolve(__dirname, 'src/content/content-script.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') return 'background.js';
          if (chunkInfo.name === 'content') return 'content.js';
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
})
