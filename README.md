# DropHunter

[![CI](https://github.com/trevonerd/drophunter/actions/workflows/ci.yml/badge.svg)](https://github.com/trevonerd/drophunter/actions/workflows/ci.yml)

DropHunter is a Chrome/Brave extension for tracking and farming Twitch Drops with less manual busywork. It helps you pick a campaign, open an eligible stream, monitor progress, auto-claim rewards when possible, and move through queued campaigns with a cleaner workflow than juggling Twitch tabs by hand.

It works only on **twitch.tv**, uses your existing Twitch session locally in the browser, and does not send data to any developer-owned servers.

## Features

- Queue multiple campaigns and let the extension work through them in order; expired or vanished campaigns are automatically removed from the queue mid-farming, advancing to the next entry transparently
- Track current reward progress directly from the popup and extension badge
- Open and validate an eligible Twitch stream for the selected campaign
- Rotate to a new streamer only when the current stream becomes invalid or progress stalls
- Auto-claim completed drops across all campaigns when Twitch marks them claimable
- Pause and resume farming without losing your place in the queue
- Optionally auto-resume farming after a browser restart instead of coming back paused
- Choose how DropHunter picks streamers: lowest viewers, random, or most viewers
- Filter streamers by preferred language (30+ languages supported)
- Automatically claim free channel points bonuses on farmed streams
- Show desktop alerts for important farming events and claimed channel points, with a Settings toggle to mute them
- Show a separate live monitor window for at-a-glance progress
- Let you choose whether the monitor opens automatically when farming starts
- Control whether farming tabs are muted from Settings
- Warn you when Twitch playback likely needs manual attention
- Handle duplicate game campaigns more clearly by labeling campaigns with suffixes like "Game · Campaign A" and "Game · Campaign B" at refresh time, making it easy to distinguish and select identical-game variants from the dropdown and queue

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
- claim completed drops when they become available
- claim free channel points bonuses on the active farmed channel when enabled
- switch streams only when recovery is needed
- continue through the queue when a campaign is completed

DropHunter refreshes the campaign list and drop statuses every 2 minutes in the background to catch new campaigns, status changes, and expirations.

If Twitch blocks playback or needs a manual interaction, DropHunter can notify you so you can click the player and resume progress. If the browser restarts mid-session, you can also choose whether DropHunter should resume automatically or stay paused until you come back.

## Monitor Window

DropHunter includes a compact monitor popup for quick progress checks while farming is running.

- You can open or close it manually from the popup header
- You can enable or disable monitor auto-open from Settings
- When auto-open is enabled, the monitor opens shortly after farming starts so it is easier to see

## Settings

DropHunter includes a few runtime controls in the popup so you can tune how aggressive or quiet the automation feels:

- enable or disable desktop notifications
- choose whether farming should auto-resume after a browser restart
- toggle auto-claim for channel points bonuses
- toggle auto-claim for completed drops
- switch between low-view, random, and top-viewer streamer selection
- prefer a specific streamer language when one is available
- choose whether the farming tab stays muted

## Notes

- Twitch must recognize the current stream as eligible for the selected campaign
- Some streams may require a manual click before playback is considered active by Twitch
- Campaign availability, claimability, and watch-time behavior are ultimately controlled by Twitch
- Browser autoplay rules and Twitch UI changes can affect playback behavior
- The extension reads Twitch session data already present in your browser so it can make authenticated Twitch requests on your behalf
- All persistence stays in Chrome extension storage on your machine; there is no analytics, ad tech, or remote telemetry pipeline

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
bun run deps:audit:all
bun run update
bun run update:interactive
```

### Local workflow

1. Make your changes in `src/`
2. Run `bun run dev` to keep `dist/` rebuilt while you work, or `bun run build` for a one-off production build
3. Load or reload `dist/` as the unpacked extension from `chrome://extensions/`
4. Re-test the relevant Twitch flow

## Project Structure

- `src/background/` - service worker logic, Twitch API handling, monitoring, and tab/window orchestration
- `src/content/` - content scripts for stream inspection and playback preparation
- `src/popup/` - extension popup UI
- `src/monitor/` - standalone monitor window UI
- `src/shared/` - shared utilities, matching logic, and drop helpers
- `tests/` - unit tests
- `video/` - promotional video scene/source assets

## Copyright and Disclaimer

© 2026 TREVISOFT. Developed by trevonerd.

DropHunter is provided as-is for personal, educational, and evaluation use. No trademark rights are granted.

DropHunter is not affiliated with, endorsed by, or sponsored by Twitch Interactive, Inc. Twitch, Twitch Drops, and related marks are property of Twitch Interactive, Inc. and are used for descriptive purposes only.

Third-party names and logos are the property of their respective owners.

You are responsible for using this software in compliance with Twitch's terms, platform rules, and applicable laws.

## Chrome Web Store Readiness

Before submitting a release, verify the privacy policy, screenshots, permission justifications, and store description all match the shipped behavior. A release checklist is available in [`docs/chrome-web-store-checklist.md`](docs/chrome-web-store-checklist.md).
