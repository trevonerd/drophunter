# DropHunter marketing site

Static Astro site for **https://getdrophunter.com** — DropHunter by Trevisoft.

This package is independent of the Chrome extension build. It does not import extension runtime code.

## Commands

```bash
cd landing
bun install
bun run dev      # http://localhost:4321
bun run build    # writes dist/
bun run preview
```

Regenerate popup/monitor screenshots, OG image, and PNG favicons (requires a Chrome MV3 build in `../.output/chrome-mv3` and Playwright Chromium):

```bash
cd /path/to/drophunter
bun run build:chrome
cd landing && bun run screenshots
```

## Netlify

Create the site from this GitHub repository.

| Setting | Value |
| --- | --- |
| Base directory | `landing` |
| Build command | `bun run build` |
| Publish directory | `dist` |
| Node | 22 (set in `netlify.toml`) |
| Package manager | Bun (`packageManager` field + lockfile) |

`landing/netlify.toml` also sets `base = "landing"` so a root-level Netlify config that points here still builds the right folder. If the UI Base directory is already `landing`, keep **Publish directory** as `dist` (resolves to `landing/dist`).

Custom domain: `getdrophunter.com` (canonical URLs assume `https://getdrophunter.com`).

## Layout

```
landing/
  astro.config.mjs
  netlify.toml
  package.json
  public/          favicon, fonts, llms.txt, robots.txt, screenshots, OG image
  scripts/         Playwright capture of the real popup/monitor
  src/pages/       prerendered HTML
  src/components/
  src/styles/
```
