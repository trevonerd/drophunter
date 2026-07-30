# Privacy Policy

**DropHunter** is a browser extension that automates Twitch Drops farming. This policy explains what data the extension accesses, how it is used, and how it is stored.

## Data accessed

DropHunter accesses the following data from **twitch.tv**:

- **Twitch session credentials** (OAuth token, user ID, device ID) — read from your existing browser session on Twitch to authenticate API requests on your behalf.
- **Drop campaign data** — game names, drop names, progress percentages, reward images, and campaign metadata fetched from Twitch's API.
- **Stream metadata** — channel names, viewer counts, and category information used to select an appropriate stream for farming.

If you configure and enable **Telegram alerts**, DropHunter also accesses:

- **Telegram bot token and chat ID** — supplied by you to authenticate with the Telegram Bot API and select the chat that receives claim alerts.

## How data is used

All data is used **solely** to operate the extension's core functionality:

1. Fetching available drop campaigns from Twitch
2. Opening and managing stream tabs for watch-time accrual
3. Tracking drop progress and claiming rewards automatically
4. Displaying status information in the extension popup and live monitor
5. Sending an optional claim notification through Telegram only after you configure the feature, grant its optional host permission, and enable alerts

## Data storage

All operational state is stored **locally** in your browser:

- `chrome.storage.local` stores extension state such as your campaign queue, cached drop progress, monitor preferences, and the last known Twitch session snapshot needed for recovery.
- `chrome.storage.local` also stores runtime recovery metadata such as backoff windows, progress polling state, and integrity fallback state so the extension can recover after Chrome suspends or restarts its service worker.
- If you configure Telegram alerts, `chrome.storage.local` stores your bot token and chat ID locally so the extension can send the alerts you enabled.

No data is written to external servers, databases, analytics tools, or cloud services controlled by the developer.

## Data sharing

DropHunter does not sell user data, use it for advertising or analytics, or send it to developer-owned servers. It does not store or log your Twitch credentials outside your browser's existing Twitch session.

Core network requests are directed to **twitch.tv** domains, using your existing Twitch session to perform the same actions you would perform manually: checking campaigns, watching eligible streams, and claiming Drops.

If you explicitly configure and enable **Telegram alerts**, DropHunter sends a claim notification to **api.telegram.org** through the bot and chat ID you provide. Telegram receives the bot token and chat ID needed to deliver the alert, plus the claimed Drop name, benefit name when available, campaign or game label, claim time, selected farming campaign, active streamer name, and reward image URL when available. This data is sent only to the Telegram chat you specify. Telegram alerts are disabled by default and require optional host permission.

DropHunter does **not** include:

- remote logging
- telemetry
- crash reporting
- advertising SDKs
- analytics beacons
- third-party trackers

## Permissions

| Permission | Purpose |
|---|---|
| `storage` | Persist extension state (queue, progress) across browser sessions |
| `scripting` | Inject content scripts into Twitch pages to control video playback |
| `notifications` (optional) | Notify you when drops are claimed or issues arise, only after you enable notifications |
| `optional host access` to `api.telegram.org` (optional) | Send Telegram claim alerts only after you enable Telegram alerts and grant the permission |
| `alarms` | Keep the background farming loop running reliably |
| `host_permissions` (twitch.tv) | Access Twitch pages and API endpoints |

DropHunter does not request the `tabs` or `cookies` permissions and does not use the `chrome.cookies` API. Session recovery relies on Twitch page storage and content scripts running only on Twitch pages.

## Open source

DropHunter is open-source. You can inspect the complete source code at [github.com/trevonerd/drophunter](https://github.com/trevonerd/drophunter).

## Contact

For questions or concerns about this privacy policy, open an issue on the [GitHub repository](https://github.com/trevonerd/drophunter/issues) or contact the developer at [github.com/trevonerd](https://github.com/trevonerd).

## Changes

This policy may be updated to reflect changes in the extension's functionality. The latest version is always available at this URL.
