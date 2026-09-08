# Chrome Web Store Checklist

Use this before submitting a new DropHunter build to the Chrome Web Store.

## Release channel

- Publish `4.0.0-beta.N` builds only through GitHub prereleases or local unpacked installs.
- For the 4.0.0 beta train, confirm the manifest uses technical version `3.99.0.N` and visible `version_name` `4.0.0-beta.N`.
- Do not upload a beta package to Chrome Web Store or Microsoft Edge Add-ons.
- Upload to the stores only after the package, manifest, tag, and GitHub release all identify the stable `4.0.0` build.

## Automated checks

- Run `bun run check`.
- Run `bun run release:check`.
- Run `bun audit`.
- Run `bun audit` from the `video/` directory.
- Confirm `release:check` rebuilt both production targets and produced exactly one current Chrome ZIP and one current Edge ZIP.

## Listing accuracy

- The single-purpose description says the extension automates Twitch Drops farming and monitoring on `twitch.tv`.
- The screenshots show the current popup UI and the monitor window.
- The support URL and homepage URL point to the GitHub repository or issue tracker.
- The privacy policy URL is live and matches the current code.
- The store description does not mention open reward campaigns or non-farmable reward lists.

## Permission justifications

- `storage`: saves queue state, cached progress, and preferences locally.
- No `tabs` permission: tab creation, updates, mute state, and close operations use Chrome tab APIs without requesting access to sensitive tab URLs/titles across all sites.
- `scripting`: injects Twitch-only content scripts needed for stream context and playback handling.
- `notifications` optional permission: requested only when the user enables notifications; used for claims, sign-in issues, and playback attention.
- `optional_host_permissions` for `api.telegram.org`: requested only when the user enables Telegram alerts or saves Telegram credentials; used to send enabled reward and farming-event notifications via the user's own bot.
- `alarms`: keeps the monitoring loop alive in MV3.
- Twitch-only `host_permissions`: required to read Twitch page state, inject Twitch-only scripts, and call Twitch endpoints.
- No `cookies` permission and no `chrome.cookies` runtime fallback: session recovery uses Twitch page storage, content-script extraction, and open Twitch tabs.

## Privacy disclosures

- The listing explains that DropHunter reads Twitch session credentials already present in the browser.
- The listing explains that core data remains local to the browser and core requests go only to Twitch.
- The listing and privacy policy explain that optional Telegram alerts store the user-provided bot token and chat ID locally, then send enabled reward and farming-event notifications to api.telegram.org only after configuration and consent. Twitch credentials never enter these messages.
- The listing explicitly says there is no third-party analytics, ads, telemetry, or remote logging.
- The listing explains that Twitch credentials are not sent to developer-owned servers.

## Final QA

- Load the fresh production `.output/chrome-mv3/` build.
- Verify popup load, campaign refresh, dropdown selection, start, pause, resume, stop, queue completion, and claim flows.
- While farming, verify the current reward appears only in Running, Pending contains only future rewards, the selector is hidden, and Up next omits the current campaign.
- Verify the Campaign Sync panel shows the correct state for no data, stale data, syncing, failed sync, and fresh data.
- Verify stale campaign data remains clearly labeled as outdated until the Twitch Drops refresh succeeds.
- Verify a successful zero-campaign refresh clears old selected campaign rewards instead of showing stale pending/completed drops.
- Verify the monitor opens, updates, and closes cleanly.
- Verify notifications stay off when optional permission is denied, then turn on and fire after permission is granted.
- Verify notification denial/revocation never disables favorite auto-start or stops farming; browser and Telegram delivery remain independent.
- Verify Telegram alerts stay off until credentials are saved and optional host permission is granted, then send a test message and a claim alert.
- Verify no stale rotation reason is shown when a new farming session starts.
- Verify the extension still recovers cleanly after a service-worker restart.
- Verify reopening after days preserves the queue and preferences while validating saved campaign data.
- Verify Retry performs background recovery, Open Twitch Drops is available when useful, and an automatic-retry message has a real scheduled alarm.
- Verify expired queue entries are removed with a grouped local notice, including when browser and Telegram alerts are disabled.
- Verify a partial, cached, failed, or malformed campaign response cannot remove merely absent campaigns.
- Verify at least one real active Twitch Drops campaign accrues progress.
- Verify the icon and title are correct, and Settings shows the public version rather than the technical beta version.
- For stable 4.0.0, verify `version` is `4.0.0`, `version_name` is absent, and neither archive name contains `beta`.

## Version 4 automation acceptance

Run the [v4 automation scenarios](v4-automation-acceptance.md) against the exact production artifacts. Record deterministic checks and authenticated live observations separately. Keep the beta version until both the automated release gate and the authenticated long-run prerequisite pass; producing ZIPs alone is not release approval.
