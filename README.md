# DropHunter

[![CI](https://github.com/trevonerd/drophunter/actions/workflows/ci.yml/badge.svg)](https://github.com/trevonerd/drophunter/actions/workflows/ci.yml)

DropHunter is a Chrome, Chromium, and Edge extension for tracking and farming Twitch Drops with less manual busywork. It helps you pick a campaign, open an eligible stream, monitor progress, auto-claim rewards when possible, and move through queued campaigns with a cleaner workflow than juggling Twitch tabs by hand.

It works only on **twitch.tv**, uses your existing Twitch session locally in the browser, and does not send data to any developer-owned servers.

## Features

- Add campaigns to a manual queue and press Start to work through them in order
- Favorite games to discover and automatically farm their campaigns by earliest expiry; urgent favorites can interrupt and later resume an authorized manual queue
- Track current reward progress directly from the popup and extension badge
- Open and validate an eligible Twitch stream for the selected campaign
- Rotate to a new streamer only when the current stream becomes invalid or progress stalls
- Auto-claim completed drops across all campaigns when Twitch marks them claimable
- Keep a local claim log so you can review recently claimed drops grouped by campaign
- Pause and resume farming without losing your place in the queue
- Optionally auto-resume farming after a browser restart instead of coming back paused
- Choose how DropHunter picks streamers: lowest viewers, random, or most viewers
- Filter streamers by preferred language (30+ languages supported)
- Automatically claim free channel points bonuses on open Twitch channel tabs
- Show desktop alerts for important farming events and claimed channel points, with a Settings toggle to mute them
- Optionally send reward and farming-event alerts through your own Telegram bot and chat
- Show a separate live monitor window for at-a-glance progress
- Let you choose whether the monitor opens automatically when farming starts
- Control whether farming tabs are muted from Settings
- Warn you when Twitch playback likely needs manual attention
- Handle duplicate game campaigns more clearly by labeling campaigns with suffixes like "Game · Campaign A" and "Game · Campaign B" at refresh time, making it easy to distinguish and select identical-game variants from the dropdown and queue

## Installation

### Option 1: Install from a release build

Grab the latest zip from [Releases](https://github.com/trevonerd/drophunter/releases), unzip it, then:

1. Open `chrome://extensions/` or `edge://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the unzipped project folder

### Option 2: Build from source

```bash
bun install
bun run build
```

The production Chrome build is generated in `.output/chrome-mv3/`. The Edge build is generated in `.output/edge-mv3/` after `bun run build:edge` or `bun run build:all`.

## Usage

1. Click the DropHunter extension icon and use the Twitch connection button to open [Drops campaigns](https://www.twitch.tv/drops/campaigns).
2. Let DropHunter detect your Twitch session and load campaigns. A new installation has no favorites and remains idle.
3. Use **Add** to prepare a manual queue, then **Start** to authorize farming in that order; or star a game to let favorite auto-start handle its campaigns.

New installations enable favorite auto-start and prefer hidden farming. Browser and Telegram notifications remain optional; neither is required for farming. Existing explicit preferences are preserved on upgrade.

From there, DropHunter will:

- use hidden farming when possible, falling back to a muted background Twitch tab if needed
- track progress and update the extension badge
- claim completed drops when they become available
- claim free channel points bonuses on open Twitch channel tabs when enabled
- switch streams only when recovery is needed
- continue through authorized campaigns when a campaign is completed; an automatic favorite does not start a manual queue you have only prepared

DropHunter checks for new campaigns every five minutes and after relevant changes, including while idle or while you watch Twitch yourself. Drop progress has its own monitoring cadence.

While favorite auto-start is enabled, **Stop** and **Pause** stop the current playback but an eligible favorite can restart at the next automatic evaluation. Disable favorite auto-start to keep farming stopped. Your personal Twitch streams take priority even in background tabs; farming resumes after all of them stop, close, or leave the channel, with a short grace period.

If a campaign stalls after recovery attempts, it remains queued but excluded until there is positive progress, a newly eligible streamer, or you explicitly press Start. Other authorized campaigns can continue; otherwise the popup explains why farming stopped.

After a prolonged browser absence, DropHunter keeps your queue and preferences
while checking saved campaign data. It attempts session recovery in the background;
if recovery fails, the popup offers **Retry** and **Open Twitch Drops**. A scheduled
retry survives a service-worker restart.

Expired campaigns are removed automatically with a queue-update notice. Campaigns
missing from a complete, verified Twitch update are removed too; failed or partial
updates do not establish that a campaign has disappeared. The remaining queue
continues only when its farming session was authorized.

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
- review and clear the local drop claim log
- enable favorite auto-start independently of notification settings
- choose hidden farming or a managed Twitch tab
- configure optional Telegram reward and farming-event alerts with your own bot and chat ID
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
2. Run `bun run dev` for Chrome, `bun run dev:edge` for Edge, or `bun run build:all` for production builds
3. Load or reload `.output/chrome-mv3/` or `.output/edge-mv3/` as the unpacked extension
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

## Release Readiness

Beta builds are GitHub prereleases for unpacked/local testing only. Do not upload a
`4.0.0-beta.N` archive to Chrome Web Store or Microsoft Edge Add-ons; the first
4.x store package is the stable `4.0.0` build.

Before publishing a beta or handing off a stable store build:

1. Run `bun run release:check`, `bun audit`, and `cd video && bun audit` when video sources changed.
2. Confirm Chrome and Edge manifests, archive names, package version, tag, and release all agree.
3. Load the freshly generated Chrome and Edge artifacts and check connection, campaign discovery, favorites, manual queue start, pause/resume/stop, hidden and managed watching, progress, auto-claim, monitor, recovery, and optional notifications.
4. Verify `PRIVACY.md`, screenshots, permission justifications, and store copy still match the shipped behavior.
5. For long-running farming changes, exercise a real eligible campaign across progress, a service-worker restart, sleep/wake, hidden-to-managed fallback, manual Twitch viewing, and recovery.

The release gate produces `.output/drophunter-<version>-chrome.zip` and
`.output/drophunter-<version>-edge.zip`.
