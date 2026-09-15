# Campaign validation follow-up — 2026-09-14

## Observed installed behavior

The new screenshot was confirmed using native Chrome UI, before changing the
installed extension. Settings showed **4.0.0-beta.19**, favorite auto-start on
and desktop notifications on. The Chrome profile button showed **Work**.
No preferences, credentials, queue entries or extension installation were changed.

The popup showed four saved campaigns, zero validated campaigns and
“Twitch verification is temporarily unavailable.” Its retry countdown advanced
to five minutes and then four minutes, confirming that this was a repeated
validation failure rather than a frozen one-minute timer. The recovery controls
were below the entire queue while the session offered “Start Queue (4)”.

Using the existing **Open Twitch Drops** action opened the signed-in Twitch
campaign page without requesting a login. Reopening the popup showed 71 games
and 93 campaigns. Existing favorite discovery added Overwatch and World of
Warcraft, producing six queued campaigns. The session still showed Ready and
Start Queue; that observation alone does not establish whether a prior Stop,
automation snooze, eligibility gate or a defect prevented acquisition.

A read-only, whitelisted worker inspection subsequently confirmed
`autoStartSnoozedForBrowserSession` was absent, `lastStopReason` null,
`isRunning`/`isPaused` false, `manualQueueAuthorized` false,
`farmingSessionOrigin` null, `wasRunning` true and favorite auto-start true.
Campaign sync was idle with a successful timestamp and no error/deadline.
The inspector was closed and the popup restored. No raw storage or credentials
were exported. An explicit browser-session snooze is therefore not the cause
of this observed Ready state; campaign eligibility remains a separate check.

This is live evidence for the installed beta.19 recovery action and state
presentation. It does not establish live correctness of the subsequently
modified beta.20, nor satisfy the two-hour authenticated farming gate.

## Intended correction

- Put startup-blocking validation/recovery controls before the session and queue.
- Show whether automatic continuation is authorized, and retain Stop while waiting.
- Distinguish temporary verification failure with automatic retry from a
  confirmed need to open Twitch manually.
- Send a deduplicated notification for confirmed session intervention through
  the existing notification settings and delivery mechanism.
- Verify scheduled validation can trigger authorized acquisition without another
  Start click, while preserving explicit Stop.

## Implementation

The beta.20 changes elevate the existing CampaignSyncPanel, distinguish
authorized automatic continuation from a manual queue, and retain Stop while
waiting. Confirmed verification intervention uses different copy from expired
authentication. The optional Open Twitch Drops shortcut remains available during
transient retries without claiming that it is required.

Campaign sync publishes a notification through the existing per-destination
deduplicated notifier on needs-session when waiting work exists. The episode key
survives worker restarts. Both body click and the first notification button open
the existing Twitch Drops recovery flow. Delivery does not block state publication;
Pause/Stop and current-state identity are rechecked before dispatch. Disabled
notifications and transient failures do not trigger an alert.

The beta.19 ZIPs were preserved before rebuilding at
`/private/tmp/drophunter-beta19-before-validation-followup/`; this preserves the
previous generated artifact, not proof of the installed extension's binary hash.

The direct integrity-error path now attempts browser verification silently using
the existing refresher/coordinator. Final inventory verification is required:
an intermediate campaign batch followed by a failing final request is not success.
Transient network errors retain scheduled retry instead of becoming a false
session requirement. Expired/cancelled refresher operations release their shared
slot on the next invocation; an old completion cannot clear a newer operation.

A persisted verification-attempt marker is cleared after transient failure or an
interrupted operation. Therefore a network outage cannot make a later integrity
failure skip recovery and incorrectly require user action. Manual retry remains
available, and confirmed verification/authentication failures carry their typed
cause into the existing needs-session outcome.

Focused regressions cover automatic scheduled validation for manual/favorite
queues, foreground validation, explicit Stop, notification delivery hangs and
rejections, session/verification copy, final-vs-progressive validation, cancelled
hidden refresh followed by manual recovery, and 72-hour stale operation leases.

The six source-fixture visual states passed two independent reviews. Screenshots
and review notes: `../.omo/evidence/v4-automation/startup-recovery-20260914.md`.
The fixture server and tab were closed; no real notification message was injected.

## Beta.19 startup discrepancy (subsequently diagnosed below)

A further whitelisted beta.19 inspection showed all three favorites farmable
and positive fresh streamer availability: Marvel 29, Overwatch 30, WoW 27;
Skull had zero. These observations were about 17 seconds old. No corresponding
campaign suppression or manual-watch gate was recorded, and another automation
check was scheduled approximately 103 seconds ahead. Nevertheless the popup
cycled Ready → pending validation → Ready without starting.

The source integration tests successfully start after validation, so those tests
alone do not explain the installed behavior. Watch preparation/commit or another
runtime gate remains unconfirmed. A final diagnostic-ring/activity inspection
was stopped when the user resumed using Chrome. The user's newly active tab was
left intact. No beta.20 install/reload or authenticated farming success is claimed.

The stable release remains blocked on this discrepancy and the original
artifact-specific two-hour farming/worker-restart/suspension gate.

## Native startup investigation and beta.21

A subsequent authorized `EVALUATE_AUTO_START` request from the installed beta.19
popup returned `success: false`, `started: false`,
`error: candidate-preparation-failed`. The diagnostic ring contained repeated
validation/idle transitions, rather than the underlying preparation failure.

The production browser host forwarded `muted: true` to `chrome.tabs.create`.
That property is supported by `tabs.update`, not `tabs.create`. The previous
test host accepted it, masking the native contract violation. A regression
through the real host adapter and provisional watch preparation reproduced
the failure before the correction. The native beta.19 popup then confirmed
`Unexpected property: 'muted'` for this invocation; no tab was created.
Chrome Extensions Details identified the existing unpacked installation as
`~/repos/trevonerd/drophunter/.output/chrome-mv3`.
Beta.21 separates blank-tab creation from
muted navigation. Review also identified a cancellation gap between those
operations. Cancellation now reaches native creation/navigation and subsequent
preparation effects. Public Stop regressions cover pending native creation,
navigation, page loading, playback preparation and tabless fallback. A late
navigation into an owned sole tab is neutralized without closing the window,
including when Chrome automatically activates it; user navigation is preserved.

An independent real startup-path regression (`manual-queue-startup-resume`)
also reproduced a 73-hour inactivity failure: a previously running manual queue
did not restart with favorite auto-start disabled. Legacy resume settings either
discarded queue authorization or retained authorization while resetting running
intent. The intended correction preserves interrupted active intent through
inactivity reconciliation, without reviving an explicit Stop or Pause.

The update-path matrix also failed before correction for running, paused and
stopped queues through both direct and browser-backed validation, with favorite
auto-start off and either legacy resume-toggle value. Update handling must retain
the pre-cleanup intent and consume it only after successful validation, with
generation checks preventing a Stop during validation from being overwritten.

The beta.20 ZIPs were preserved in
`/private/tmp/drophunter-beta20-before-native-tab-fix/`. Beta.21 is a separate
local candidate; this section does not claim successful installation or farming.

The first beta.21 automated gate passed before the final paused-resume and
validated-continuation-timeout regressions. Its Chrome background SHA-256 was
`971060ce77f600449a823aca2cbc3e87955a0b4353311b317a3bfa7b331fa053`,
and ZIP SHA-256 `8243c88fe0272824a7847d189e94f22b05d7b73da1121fbca61a57c6f439efad`.
This baseline is used for an immediate native startup observation while final
edge-case work continues; it is distinct from the final candidate artifact.

Reloading that baseline started the prior queue autonomously: the monitor opened
without Start/Evaluate, showing Skull/Stormlash at 0%, no eligible streamer and
a 16-second retry countdown (16:36:42 Europe/Rome). This proves automatic queue
continuation began, not that Twitch credited watch time.

## Final beta.22 candidate

The final candidate also fixes paused Resume after update and a validated sync
whose subsequent continuation hangs. A pending interrupted queue defers the
successful checkpoint until continuation completes; timeout retains the existing
coordinator's persisted retry. Cases without pending work retain successful
validation semantics. Actual coordinator/handler regressions verify deadline,
wake and single resumption; late update persistence cannot overwrite public Stop.

`bun run release:check` passed for beta.22: scope, TypeScript, Biome, full tests,
Chrome/Edge builds, ZIPs and manifest/archive checks. Root/video dependency audits
were clean and `git diff --check` passed. Log:
`../.omo/evidence/v4-automation/beta22-release-check.log`.

| Final beta.22 artifact | SHA-256 |
| --- | --- |
| Chrome ZIP | `b280094f4a65aa13c1b794d2ecc478b973978b64a2a48b55bc87bf29be213f3a` |
| Edge ZIP | `1b5234820545e3b07ce165ebfc3eb97a18835234f1c500767833f032d08b2151` |
| Chrome manifest | `27ffb5a670044fc185a455072ae372875d124f31bf80b16d25adcdbda6785e29` |
| Chrome background | `5635cbae85792a987bfb7a97fa6879ed05777ae17b6ed83e4b5bb0aef443e3e4` |

### Native beta.22 observations

The existing installation was reloaded during acquisition, without Start or
Evaluate. At 16:40:02 Europe/Rome the real monitor showed **Overwatch · OW
BlizzCon Day 2**, **RUNNING**, active channel `/ml7support`, and **BlizzCon Day 2
Drop 1** at 0%, ETA 15 minutes. This establishes automatic active-stream startup
on the final artifact; measurable Twitch credit and the long-run gate are tracked
separately.

Whitelisted storage confirmed campaign `f0706fe5-24bd-4e5b-bb36-292fcc97da91`,
reward `a34b6226-abdf-11f1-b2a7-0a58a9feac02`, `currentMinutes: 0`,
`requiredMinutes: 15`, `progress: 0`, `isRunning: true`, channel `ml7support`,
and managed-tab transport (tabless fallback reason `error`). The remaining queue
retained WoW, Marvel, Skull, LEGO and WARDOGS. No credential fields were exported.

Independent code review approved the final changes with no remaining code
blockers; its WATCH concerns artifact-specific live/long-run release prerequisites.

The subsequent native run did **not** yet establish credited farming: reward
minutes remained zero and watch health reported `wrong-game`. Four identical
`https://www.twitch.tv/ml7support` tabs were observed, with only the current one
referenced by app state. An independent migration reproduction confirmed that
clearing extension session storage on reload loses the ownership proof used to
release the prior local receipt, then migration discards that receipt. Category
verification and reload ownership are under follow-up; beta.22 is not signed off
as a successful farming or stable-release artifact.

A later read-only native AX inspection confirmed the primary stream category
link is `/directory/category/overwatch-2`, labeled Overwatch, matching the stored
slug. A rename/alias mismatch is therefore not established as the live cause.
The DOM extractor's first broad category match and inconsistent runtime checks
remain the concrete code defects being corrected. A fifth same-channel tab also
appeared without another reload, so reload ownership alone does not explain all
observed duplicate tabs.

At **17:08:22 Europe/Rome**, the authenticated Twitch inventory established
actual beta.22 credit: Drop 2 reached **73% of 30 minutes** (approximately 22
minutes), Drop 3 reached 36% of one hour, and Drop 10 reached 4% of eight hours.
The first 15-minute reward was no longer remaining, with nine rewards left.
This supersedes the earlier zero-credit observation. Six same-channel tabs were
then present without another reload; app state had a null tab ID and stopped
watch health despite running intent. Credited farming therefore does not resolve
the ownership/status defects or satisfy the exact-artifact stable release gate.

## Beta.23 follow-up under verification

The category checks now share observed-category matching across initial
preparation, managed monitoring and legacy rotation. Tests exercise the actual
DOM helper, primary-link precedence, missing slugs, changed labels and rejection
of a genuinely different category. The large content entrypoint was split into
focused modules to keep the existing TypeScript scope gate intact. These are
verified code defects/hardening; they do not by themselves establish the exact
live `wrong-game` response source.

Managed-tab ownership is retained on the owned Twitch page itself, with
exact token/URL checks, to survive extension reloads without treating arbitrary
user Twitch tabs as owned. Unavailable ownership verification prevents new-tab
acquisition and schedules a persisted retry through the existing evaluator;
successful verification releases the old proven tab before replacement. Stop
and window-preservation regressions cover pending navigation and storage writes.
Legacy unmarked tabs are preserved rather than assumed to belong to DropHunter.
Beta.22 ZIPs were preserved in
`/private/tmp/drophunter-beta22-before-live-followup/`.

The final beta.23 `release:check` passed scope, TypeScript, Biome, full tests,
Chrome/Edge builds, archive and manifest checks. Log:
`../.omo/evidence/v4-automation/beta23-release-check.log`.
Independent bounded code review approved the source, with the live gate open.
Native continuation/credit and the exact-artifact two-hour gate remain to verify.

The store checklist's additional `bun run check` passed, as did root/video
dependency audits (no vulnerabilities) and `git diff --check`. Its rebuild
produced the same Chrome background and manifest hashes below. The existing
extension was reloaded to beta.23 at **17:15:43 Europe/Rome**, without Start or
Evaluate. Automatic reconciliation and live progression are under observation.
The immediate pre-update beta.22 baseline was Drop 2 at 22/30 minutes (73%);
`manualWatch` was null, so a manual-viewing pause did not explain that sample.

The first beta.23 runtime observation confirmed automatic running intent and
**tabless** transport, with no managed tab ID and no manual-watch gate. Drop 2
was still at the 22/30-minute baseline. No Start/Evaluate was sent. A managed-page
marker/context check is not applicable while this transport remains tabless;
old beta.22 tabs remain separate from this observation. Continued credit and
worker restart still require subsequent measurements.

Live recovery executed without user intervention: at **17:17:16** the monitor
reported a Twitch connection failure, preserved queue and a 45-second retry;
at **17:18:16** it truthfully showed waiting for the scheduled retry; at
**17:18:47** it returned to **RUNNING** on mL7support. Reward progress was still
73%. This verifies the observed retry executed on a subsequent heartbeat,
without asserting new credit or attributing old playing tabs to beta.23.

The recovered transport was tabless. The nine pre-existing mL7 tabs did not
increase during the short beta.23 observation; this is not a two-hour stability
claim. At **17:21:03 Europe/Rome**, Chrome's service-worker-internals Stop action
stopped only the extension worker (registration 2832, version 4745), without
revoking DropHunter's running intent. Chrome subsequently showed the same worker
**RUNNING** with a new thread (13 instead of 12), after the stopped state showed
thread -1. No Start/Evaluate or DropHunter Stop was used.

The Mac locked during test-tab cleanup and CUA could not unlock it. Therefore
post-restart monitor/inventory verification and the final two-hour authenticated
run remain **environment/browser unavailable**, not passed. The inspector was
closed before this; the service-worker-internals test tab may remain open.
No user stream tabs were closed. A real laptop suspension/resume is also still
required; a locked screen does not establish suspension. The beta.23 packages
remain local beta artifacts and are not approved as stable 4.0.0 store packages.

| Final beta.23 artifact | SHA-256 |
| --- | --- |
| Chrome ZIP | `9370c2d44f429a6b72d13c510ef188cd51b1450b8d28865dc75fd9c01335b22f` |
| Edge ZIP | `d8d81e7d9121e37ca1bde2a19dbc36826e4e6f2154f9be030dab2717d556f784` |
| Chrome manifest | `75bb3b739cc0523ea2c84bf200475d9486559d45025de69e1ff336acc790297c` |
| Chrome background | `81915640cc142c797d5c8933dcf0f480614222d855fb2498fb9c1f1a5ce2f75f` |

## Earlier beta.20 automated gate and artifacts

`bun run release:check` passed after the final changes: TypeScript scope,
TypeScript, Biome, the full test suite, Chrome/Edge builds and ZIPs, generated
manifests and archive validation. Both root and video `bun audit` returned no
vulnerabilities. `git diff --check` was clean. No commit or publication was made.

Release log: `../.omo/evidence/v4-automation/beta20-release-check.log`.
Independent code review approved the examined changes with a WATCH on the live
discrepancy: `../.omo/evidence/drophunter-recovery-code-review.md`.

| Beta.20 artifact | SHA-256 |
| --- | --- |
| `.output/drophunter-4.0.0-beta.20-chrome.zip` | `eef8d29b75572c8f14518c6cd588b629400b0deb040a07b44d80a978da41b588` |
| `.output/drophunter-4.0.0-beta.20-edge.zip` | `a39b7f789c363856fb53a746bd8510d09e659ee46cc3708b8fd57263d1d1915a` |
| `.output/chrome-mv3/manifest.json` | `80c0d2b53b614ccb3198870af95a4a3757e7d09ecb51570ea5f32becf25e26ab` |
| `.output/chrome-mv3/background.js` | `511f334e77153702be0e3c672a5985f3339d8ba5d3e7fe318cc4acebb7fdeb9b` |
