# Chrome Web Store Checklist

Use this before submitting a new DropHunter build to the Chrome Web Store.

## Listing accuracy

- The single-purpose description says the extension automates Twitch Drops farming and monitoring on `twitch.tv`.
- The screenshots show the current popup UI and the monitor window.
- The support URL and homepage URL point to the GitHub repository or issue tracker.
- The privacy policy URL is live and matches the current code.

## Permission justifications

- `storage`: saves queue state, cached progress, and preferences locally.
- No `tabs` permission: tab creation, updates, mute state, and close operations use Chrome tab APIs without requesting access to sensitive tab URLs/titles across all sites.
- `scripting`: injects Twitch-only content scripts needed for stream context and playback handling.
- `notifications`: alerts the user about claims, sign-in issues, and playback attention.
- `alarms`: keeps the monitoring loop alive in MV3.
- Twitch-only `host_permissions`: required to read Twitch page state, inject Twitch-only scripts, and call Twitch endpoints.
- No `cookies` permission: session recovery uses Twitch page storage/content-script extraction instead of direct browser cookie access.

## Privacy disclosures

- The listing explains that DropHunter reads Twitch session credentials already present in the browser.
- The listing explains that data remains local to the browser and requests are sent only to Twitch.
- The listing explicitly says there is no third-party analytics, ads, telemetry, or remote logging.

## Final QA

- Load the fresh production `dist/` build.
- Verify popup load, monitor load, start, pause, resume, stop, queue completion, and claim flows.
- Verify no stale rotation reason is shown when a new farming session starts.
- Verify the extension still recovers cleanly after a service-worker restart.
- Verify the icon, title, and manifest version are correct.
