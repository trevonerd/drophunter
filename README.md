# DropHunter

[![CI](https://github.com/trevonerd/drophunter/actions/workflows/ci.yml/badge.svg)](https://github.com/trevonerd/drophunter/actions/workflows/ci.yml)

DropHunter is a Chrome/Brave extension for tracking and farming Twitch Drops with less manual busywork. It helps you pick a campaign, open an eligible stream, monitor progress, auto-claim rewards when possible, and move through queued campaigns with a cleaner workflow than juggling Twitch tabs by hand.

## Features

- Queue multiple campaigns and let the extension work through them in order
- Track current reward progress directly from the popup and extension badge
- Open and validate an eligible Twitch stream for the selected campaign
- Rotate to a new streamer only when the current stream becomes invalid or progress stalls
- Auto-claim rewards when Twitch marks them claimable
- Show a separate live monitor window for at-a-glance progress
- Let you choose whether the monitor opens automatically when farming starts
- Warn you when Twitch playback likely needs manual attention
- Handle duplicate game campaigns more clearly by surfacing campaign-specific choices

## Installation

### Option 1: Install from a release build

Grab the latest zip from [Releases](https://github.com/trevonerd/drophunter/releases), unzip it, then:

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the unzipped project folder

### Option 2: Build from source

```bash
bun install
bun run build
```

The production build is generated in `dist/`. Load that folder as an unpacked extension from `chrome://extensions/`.

## Usage

1. Open the Twitch [Drops campaigns](https://www.twitch.tv/drops/campaigns) page at least once so DropHunter can detect available campaigns.
2. Click the DropHunter extension icon.
3. Select a campaign from the dropdown, or add multiple campaigns to the queue.
4. Press **Start Farming**.

From there, DropHunter will:

- open a Twitch stream for the selected campaign
- keep the tab muted
- track progress and update the extension badge
- claim rewards when they become available
- switch streams only when recovery is needed
- continue through the queue when a campaign is completed

If Twitch blocks playback or needs a manual interaction, DropHunter can notify you so you can click the player and resume progress.

## Monitor Window

DropHunter includes a compact monitor popup for quick progress checks while farming is running.

- You can open or close it manually from the popup header
- You can enable or disable monitor auto-open from Settings
- When auto-open is enabled, the monitor opens shortly after farming starts so it is easier to see

## Notes

- Twitch must recognize the current stream as eligible for the selected campaign
- Some streams may require a manual click before playback is considered active by Twitch
- Campaign availability, claimability, and watch-time behavior are ultimately controlled by Twitch
- Browser autoplay rules and Twitch UI changes can affect playback behavior

## Development

### Commands

```bash
bun run dev
bun run build
bun run lint
bun test
bun run test:ts
bun run check
bun run clean
bun run deps:outdated
bun run deps:audit
bun run update
bun run update:interactive
```

### Local workflow

1. Make your changes in `src/`
2. Run `bun run build`
3. Reload the unpacked extension from `chrome://extensions/`
4. Re-test the relevant Twitch flow

## Project Structure

- `src/background/` - service worker logic, Twitch API handling, monitoring, and tab/window orchestration
- `src/content/` - content scripts for stream inspection and playback preparation
- `src/popup/` - extension popup UI
- `src/monitor/` - standalone monitor window UI
- `src/shared/` - shared utilities, matching logic, and drop helpers
- `tests/` - unit tests
- `video/` - promotional video scene/source assets

## License and Copyright

Copyright (c) DropHunter contributors and the project author.

This repository is provided for personal, educational, and evaluation purposes unless a separate written license says otherwise. No trademark rights are granted through this repository.

DropHunter is an independent project and is not affiliated with, endorsed by, sponsored by, or officially connected to Twitch Interactive, Inc., Amazon, Google, or Brave Software.

Twitch, Twitch Drops, related names, logos, product names, interface elements, and brand assets are the property of their respective owners and are used only for descriptive or compatibility purposes.

You are responsible for using this software in a way that complies with Twitch's terms, platform rules, local law, and any other policies that apply to your account or jurisdiction.
