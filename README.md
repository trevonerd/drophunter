# DropHunter

Chrome/Brave extension that farms Twitch drops for you. Pick a game, hit start, and it does the rest — finds a streamer with drops enabled, watches in a muted tab, tracks progress, auto-claims rewards, and moves to the next game in queue when done.

## Install

Grab the latest zip from [Releases](https://github.com/trevonerd/twitch-extension/releases), unzip it, then:

1. Go to `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select the unzipped folder

## How it works

1. Open the Twitch [Drops campaigns](https://www.twitch.tv/drops/campaigns) page at least once so the extension can pick up available campaigns
2. Click the extension icon in the toolbar
3. Select a game from the dropdown (or queue up multiple games)
4. Hit **Start Farming**

The extension opens a muted stream tab in the background and tracks everything. You'll see progress right in the popup, and the extension badge shows the current percentage. When a drop is ready it gets claimed automatically and you get a notification.

## Build from source

```bash
npm install
npm run build
```

The compiled extension ends up in `dist/`. Load that folder as unpacked extension.

## Dev

```bash
npm run dev       # vite dev server
npm run build     # tsc + vite build
npm run lint      # biome lint
npm run test      # run tests
```

Edit code in `src/`, rebuild, then hit the reload button on `chrome://extensions/`.

## License

For personal/educational use. Twitch is a trademark of Twitch Interactive, Inc.
