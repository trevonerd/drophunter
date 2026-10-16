import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://getdrophunter.com',
  trailingSlash: 'never',
  output: 'static',
  compressHTML: true,
  build: {
    inlineStylesheets: 'always',
    assets: '_astro',
  },
  integrations: [
    sitemap({
      changefreq: 'weekly',
      priority: 1,
      lastmod: new Date(),
    }),
  ],
  vite: {
    build: {
      cssMinify: true,
      assetsInlineLimit: 4096,
    },
  },
});
