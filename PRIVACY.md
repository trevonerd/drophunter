# Privacy Policy

**DropHunter** is a browser extension that automates Twitch Drops farming. This policy explains what data the extension accesses, how it is used, and how it is stored.

## Data accessed

DropHunter accesses the following data exclusively from **twitch.tv**:

- **Twitch session credentials** (OAuth token, user ID, device ID) — read from your existing browser session on Twitch to authenticate API requests on your behalf.
- **Drop campaign data** — game names, drop names, progress percentages, reward images, and campaign metadata fetched from Twitch's API.
- **Stream metadata** — channel names, viewer counts, and category information used to select an appropriate stream for farming.

## How data is used

All data is used **solely** to operate the extension's core functionality:

1. Fetching available drop campaigns from Twitch
2. Opening and managing stream tabs for watch-time accrual
3. Tracking drop progress and claiming rewards automatically
4. Displaying status information in the extension popup and live monitor

## Data storage

All operational state (campaign queue, drop progress, cached campaign lists) is stored **locally** in your browser using `chrome.storage.local`. No data is written to external servers, databases, or cloud services.

## Data sharing

DropHunter does **not**:

- Collect, transmit, or sell any personal information
- Send data to any third-party server, analytics service, or advertising platform
- Store or log your Twitch credentials outside of your browser's existing session

The only network requests made by the extension are directed to **twitch.tv** domains, using your existing Twitch session, to perform the same actions you would perform manually (watching streams and claiming drops).

## Permissions

| Permission | Purpose |
|---|---|
| `storage` | Persist extension state (queue, progress) across browser sessions |
| `tabs` | Open, query, mute, and close Twitch stream tabs |
| `scripting` | Inject content scripts into Twitch pages to control video playback |
| `notifications` | Notify you when drops are claimed or issues arise |
| `alarms` | Keep the background farming loop running reliably |
| `host_permissions` (twitch.tv) | Access Twitch pages and API endpoints |

## Open source

DropHunter is open-source. You can inspect the complete source code at [github.com/trevonerd/drophunter](https://github.com/trevonerd/drophunter).

## Contact

For questions or concerns about this privacy policy, open an issue on the [GitHub repository](https://github.com/trevonerd/drophunter/issues) or contact the developer at [github.com/trevonerd](https://github.com/trevonerd).

## Changes

This policy may be updated to reflect changes in the extension's functionality. The latest version is always available at this URL.

*Last updated: February 2026*
