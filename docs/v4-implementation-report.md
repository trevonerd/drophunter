# DropHunter v4 implementation and verification

Date: 2026-09-07. Build line: `4.0.0-beta.14` (`3.99.0.14` in browser manifests).

## Implemented behavior

- New installations enable favorite auto-start and hidden playback. Browser
  notifications remain optional, independently of automation and Telegram.
- Manual queue authorization and session origin are durable, separate from
  queue-entry provenance. Automatic favorite completion does not authorize an
  untouched manual queue, including campaigns added manually before starring.
- Favorite discovery considers distinct campaigns for each favorite game,
  orders them by expiry, and preserves the active campaign until a strictly
  earlier known deadline justifies preemption. Manual queue order survives.
- Stop/Pause and the notification Pause action share the auto-start policy.
  Discovery continues through the five-minute scheduler and personal viewing.
- Personal streams in background tabs suspend farming. Unknown observations
  preserve protection; the final confirmed stop has a 30-second grace period.
- Hidden transport failures can recover through a muted managed tab while
  retaining the hidden preference and exposing a fallback explanation.
- Adaptive stall recovery requires authoritative progress evidence. Exhausted
  campaigns retain their rewards and a persistent block; worker restart and
  unchanged cache do not reset attempts or unblock campaigns.
- Common automation events deliver independently to enabled notification
  channels, with persistent transition receipts and isolated delivery failures.
- Popup and monitor use consistent campaign identity and pause indicators.
  Existing settings, queue intent, and stall evidence survive version updates.

## Verification boundaries

The final `bun run release:check` completed successfully on the working tree:

| Check | Result |
| --- | --- |
| TypeScript change-scope rules | PASS |
| TypeScript | PASS |
| Biome lint | PASS |
| Full test suite | PASS |
| Chrome and Edge builds and ZIP packaging | PASS |
| Generated manifest and archive validation | PASS |
| Extension and video dependency audits | PASS — no known vulnerabilities |
| Whitespace/diff check | PASS |

The local gate log is `.omo/evidence/v4-automation/release-check.log`.
Generated beta artifacts and SHA-256 digests:

| Artifact in `.output/` | SHA-256 |
| --- | --- |
| `drophunter-4.0.0-beta.14-chrome.zip` | `1cfc730a4445b4dce3941faaf23c260866b4431cad0140fa53274331b053c54d` |
| `drophunter-4.0.0-beta.14-edge.zip` | `85a13d05c5852c93af1a3a0ec0e82fd466ea21019b0a8ee0f5a0ef98188f1091` |

These are local beta artifacts, not stable store-submission packages.

Deterministic tests exercise mocked browser/Twitch boundaries. They verify state
transitions and contracts, not real Twitch watch-time credit. The acceptance
matrix is in [v4-automation-acceptance.md](v4-automation-acceptance.md).

Two independent final visual reviews passed all six rendered component scenes:
first connection, idle manual queue, running favorite, personal-view pause,
settings, and monitor. Reviews used browser screenshots and accessibility trees.
They found and verified fixes for an unrelated reward in the monitor and a
stale Running badge during pause. The fixture uses real components with
deterministic state and no-op farming callbacks; it is not an installed-extension
or authenticated Twitch test. Screenshots were inspected in the session and
are not represented as saved store assets.

Dependency audits for the extension and video project reported no known
vulnerabilities. Video dependency overrides were patched, and the existing CTA
still rendered successfully.

The vexp completion tool returned paths belonging to another project. Its
result is not evidence about DropHunter; repository-local checks are used here.

## Stable-release prerequisites still open

- Load the exact packaged extension in Chrome and Edge and exercise both clean
  installation and upgrade in the browser. Storage tests cover the deterministic
  migration behavior but do not replace these installed-extension checks.
- Run authenticated Twitch farming for at least two hours, recording actual
  reward progress, recovery, and a worker restart using the
  [soak checklist](soak-test-checklist.md). The Twitch profile to use has not
  been confirmed, and no authenticated soak result is claimed.
- Capture final store screenshots from the validated installed build, then
  perform the stable version and package handoff described in the
  [store checklist](chrome-web-store-checklist.md).

The stable version has not been assigned and nothing has been published.
