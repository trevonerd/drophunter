import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  workspaces: {
    '.': {
      // WXT's HTML pages load the UI modules outside the TypeScript import graph.
      entry: ['src/entrypoints/**/*.ts', 'src/{popup,monitor}/main.tsx'],
      project: ['src/**/*.{ts,tsx,css}', 'tests/**/*.{ts,tsx,mjs}', 'e2e/**/*.ts', 'scripts/**/*.{ts,mjs}'],
      playwright: { config: ['e2e/playwright.config.ts'] },
    },
    video: {
      entry: ['src/index.ts', 'remotion.config.ts'],
      project: ['src/**/*.{ts,tsx}'],
    },
  },
};

export default config;
