# DropHunter reward-semantics soak checklist

This checklist is the human execution record for the reward-semantics change. It
covers the eleven original manual-QA cases from the implementation plan, plus
the mixed-reward continuation correction from Todo 11. A case is complete only
when its binary observable, evidence fields, and cleanup receipt are recorded.

## Validation tracks and evidence boundary

Run both tracks when preparing a release, and label every record with its track.

| Track | What it proves | What it cannot prove |
| --- | --- | --- |
| **Code-complete / deterministic fixture** | Projection, marker, recovery, queue, router, persistence, and rendered popup/monitor behavior using controlled campaign/reward fixtures and deterministic clocks. | That Twitch awarded a real badge/emote, that a live stream is eligible, or that a viewer session has a particular Twitch entitlement. |
| **Release-ready / authenticated Chrome** | The built extension on the recorded browser/profile, live Drops pages, managed farming tab, and (when a suitable campaign exists) real Twitch evidence. | Nothing beyond the observed account/campaign. Do not generalize one account’s live result. |

Unauthenticated automation, mocked API responses, and browser-render fixtures
must never be described as validating strict Twitch award evidence. A strict
positive proof is credential-dependent: it requires authenticated Twitch data
that identifies the exact benefit, game, campaign, and an acceptable timestamp
window. If a live prerequisite is unavailable, classify the blocker precisely:
missing authenticated evidence is **BLOCKED — credential-dependent**; no live
campaign/reward with the required shape is **BLOCKED — campaign prerequisite
unavailable**; a missing/unsupported browser, extension install, or screenshot
surface is **BLOCKED — environment/browser unavailable**. Retain the
deterministic result and record the exact missing prerequisite and owner; never
mark the live case passed.

## Required evidence record (one per case)

Copy this block into the attempt log (for example
`.omo/evidence/final-manual-qa.md`) before running a case. Use ISO-8601 timestamps
with timezone and keep screenshots under the same evidence directory.

```text
Case / track:
Operator / run ID:
Started / finished (ISO-8601):
Browser + version (and OS):
Extension build/version + artifact path (chrome/edge):
Profile/auth state: clean fixture | authenticated Twitch | unavailable
Game ID / campaign ID(s):
Reward ID(s) / benefit ID(s):
Reward acquisition method / kind / verification state before:
Progress and current minutes before -> after (exact integer values):
Snapshot source provenance: campaign-authoritative | inventory-partial | cached | fixture
Recovery reason and attempt sequence (including attempt number at marking):
Event order observed (for exhaustion: marker-save -> reproject -> reacquire/queue-mutation):
Queue before -> after (selected campaign and head explicitly named):
Popup/monitor status and copy:
Binary observable (PASS | FAIL | BLOCKED — credential-dependent | BLOCKED — campaign prerequisite unavailable | BLOCKED — environment/browser unavailable):
Screenshot paths (required cases only, otherwise N/A):
Console/test output artifact path:
Cleanup completed (tabs, timers, mocks, storage, temp server, credentials):
If blocked, exact missing prerequisite and owner:
Notes / deviations:
```

For every failed or blocked case, preserve the failing screenshot/log and state
the exact unmet prerequisite. Never replace a missing live observation with a
test pass.

## Code-complete gate (deterministic fixtures and rendered surfaces)

### Setup

1. Pin the source revision and record the extension build/version. Run the
   repository’s focused checks before the walkthrough; retain command output:
   `rtk bun test tests/drop-processing.test.ts tests/runtime-state.test.ts tests/state-persistence.test.ts`,
   `rtk bun test tests/queue-start.test.ts tests/queue-management.test.ts tests/service-worker.test.ts`,
   `rtk bun test tests/messages.test.ts tests/message-router.test.ts`, and
   `rtk bun run test:ts`.
2. Produce a deterministic marker fixture JSON with the existing Bun module
   seam (no new driver is required):

   ```sh
   rtk bun -e 'import { createServiceWorkerState } from "./src/background/runtime-state.ts"; import { markDropUnverifiable, applyUnverifiableRewardMarker } from "./src/background/drops-projection.ts"; const state=createServiceWorkerState(); const drop={id:"reward-99",name:"Badge",gameId:"game-1",gameName:"Game",imageUrl:"",campaignId:"campaign-1",progress:99,currentMinutes:59,claimed:false,acquisitionMethod:"watch-time",rewardKind:"twitch-badge",verificationState:"unassessed"}; const marked=markDropUnverifiable(state,drop,123456); const projected=applyUnverifiableRewardMarker(state,drop); console.log(JSON.stringify({marked,marker:state.unverifiableRewardsByKey,projected:{progress:projected.progress,currentMinutes:projected.currentMinutes,verificationState:projected.verificationState}}));' | tee .omo/evidence/task-15-fixture-marker.json
   ```

   PASS iff the JSON contains `marked:true`, canonical key
   `["campaign-1","reward-99"]`, exact `99/59`, and projected
   `verificationState:"unverifiable"`. Then capture the full semantic matrix:

   ```sh
   rtk bun test tests/drop-processing.test.ts tests/runtime-state.test.ts tests/state-persistence.test.ts | tee .omo/evidence/task-15-projection-suite.txt
   ```
3. Produce router request/response evidence with the real listener tests:

   ```sh
   rtk bun test tests/messages.test.ts tests/message-router.test.ts | tee .omo/evidence/task-15-router-suite.txt
   rtk jq -e '.scenario == "todo-12-correction-runtime-message-event-log" and .canonicalReject.responseReason == "farming-complete" and .malformedAllAcquired.response.success == false and .malformedFarmableCount.response.success == false' .omo/evidence/task-12-queue-router.json | tee .omo/evidence/task-15-router.json
   ```

   The first command is the executable validator (including malformed payload
   rejection); the second validates the existing real-listener JSON artifact
   produced by Todo 12. PASS iff the test command exits 0 and `jq` prints
   `true`; retain both output paths in the record.
4. Build the real UI entrypoints with `rtk bun run build:chrome`, which produces
   `.output/chrome-mv3/popup.html` and `.output/chrome-mv3/monitor.html`, then
   run:

   ```sh
   rtk bun test tests/popup-source.test.ts tests/monitor-dashboard.test.ts | tee .omo/evidence/task-15-ui-surface-suite.txt
   ```

   Open those built pages in
   the installed extension and capture the required screenshots; if the
   browser/extension context cannot be opened, use the exact build/test output
   and classify the screenshot as **BLOCKED — environment/browser unavailable**
   with the missing browser prerequisite. No current automated screenshot
   driver exists, so do not claim a screenshot from source tests alone.
5. Before each fixture, record queue and marker state. After each fixture, run
   the cleanup receipt even when the assertion fails.

### Deterministic semantic/recovery cases

The expected result in this section is a binary fixture assertion. The
corresponding release-ready/live step is in the next section.

#### 1. Fresh ordinary in-game reward at 0% (original case 1)

- Fixture: one campaign-authoritative watch-time/in-game reward at exactly
  `0% / 0m`, no marker, `verificationState=unassessed`.
- Action: open the rendered popup and invoke Start through the normal queue/start
  path.
- PASS iff Start is enabled, no gift/question indicator is shown, the reward is
  selected as current, and the session enters `RUNNING` (no marker is created).
- Record campaign/reward IDs, exact 0/0 values, queue before/after, rendered HTML,
  and cleanup of the fixture state.

#### 2. Fresh Twitch-native reward at 0% (original case 2)

- Fixture: a Twitch badge (`rewardKind=twitch-badge`) at exactly `0% / 0m`,
  `verificationState=unassessed`, with no strict award evidence. Repeat the
  same fixture with `rewardKind=twitch-emote` when exercising the equivalent
  native-reward branch.
- Action: invoke the same Start path and render popup/monitor.
- PASS iff Start remains enabled, no circled-question indicator appears, no
  marker is persisted, and the session runs the reward normally. This is the
  required fresh-0% native startability guard.
- Required screenshot: popup before Start and monitor while `RUNNING`.

#### 3. Watch rewards complete with subscription remainder (original case 3)

- Fixture: complete campaign-authoritative set containing acquired watch-time
  rewards and one subscription-gated reward (`0m`, not automatable).
- Action: project the set, open popup, monitor, and attempt Start/add-to-queue.
- PASS iff summary is `farming-complete` with `remainderReasons=["subscription-required"]`,
  amber gift appears, green all-acquired indicator is absent, Start/add-to-queue
  is rejected with typed `farming-complete`, and the subscription reward card
  remains visible. No reward is called “all claimed”.
- Required screenshot: popup summary/reward card and disabled action; record the
  exact rejection reason and queue unchanged.

#### 4. Strict early badge/emote award (original case 4; credential-dependent)

- Deterministic probe: feed a fixture containing strict `gameEventDrops` evidence
  for the exact benefit, game, campaign, and timestamp window; also feed a
  misleading-name/image-only fixture.
- PASS for the deterministic probe iff only the strict fixture becomes
  `verificationState=verified` and acquired/100%; the misleading fixture stays
  unverified. Green appears only when every campaign reward is acquired.
- A live PASS additionally requires authenticated Twitch evidence and the exact
  campaign/benefit IDs. Unauthenticated automation is **not** a live proof.
- Record evidence source/timestamps, before/after verification, and whether the
  live prerequisite was available. Cleanup must remove any temporary API fake.

#### 5. Twitch-native reward stalled at exactly 99% (original case 5)

- Fixture: identified badge/emote at exactly `99% / 59m` (or the recorded current
  minute value), selected campaign, `recoveryReason=stalled-progress`.
- Action: drive attempts 1, 2, then the existing exhausted attempt 3 with a
  deterministic event log. Do not jump directly to attempt 3.
- PASS iff attempts 1 and 2 perform ordinary self-heal/retry and have no marker;
  only attempt 3 creates the campaign+reward marker, saves timing before
  reprojection, and preserves exactly 99% and minutes. The event order is
  `marker-save -> reproject -> queue-mutation`; terminal copy uses
  `unverifiable-twitch`, never “all rewards claimed/acquired/complete”.
- The projected reward is `unverifiable`, the selected campaign becomes
  `farming-complete` only when no automatable remainder exists, and the queue
  advances without trapping the session.
- Required screenshot: terminal popup/monitor with question indicator and exact
  99% progress. Record every attempt timestamp and event-log artifact.

#### 6. Twitch-native reward stalled at exactly 0% (original case 6)

- Fixture: a native-only campaign with exactly one identified badge/emote at
  exactly `0% / 0m` and no other automatable reward; first prove case 2 (normal
  start), then run a real failed/recovery cycle through attempt 3.
- PASS iff no marker exists before attempt 3; exhausted recovery stores and
  projects exact `0% / 0m` as `unverifiable`, recomputes
  `farming-complete`, skips/advances the queue with terminal reason
  `unverifiable-twitch`, and emits no same-campaign continuation. No coercion
  to 100% or a positive minute value is allowed. Mixed campaigns belong only to
  the separate mixed-reward correction below.
- Record the pre-cycle marker map, full attempt sequence, exact values, queue
  before/after, and cleanup of timers/mocks.

#### 7. Restart persistence (original case 7)

- Fixture: persist a valid marker keyed by non-empty campaign+reward identity at
  99/59 and repeat with 0/0. Save timing state, simulate service-worker/browser
  restart, then load and project from storage.
- PASS iff both markers survive normalization/round-trip with exact values,
  remain campaign-specific, and the popup/monitor still show the truthful
  unverifiable state. A normal crash/restart does not clear the marker.
- Required screenshot: post-restart popup/monitor. Record storage before/after,
  restart timestamps, and storage-mock teardown.

#### 8. Approved marker clearing (original case 8)

Run each subcase independently and record the source provenance.

- **Strict proof:** exact positive Twitch evidence for the same benefit, game,
  campaign, and timestamp window clears the marker and yields verified/acquired.
- **Forward progress:** an increase in percentage or minutes is positive reward
  evidence and clears the marker whether delivered by campaign-authoritative or
  `inventory-partial` data; equal/weaker values do not.
- **Preservation controls:** cached, failed, absent, equal, or weaker data, and
  a partial snapshot that omits the reward or supplies no forward value, retain
  the marker and its exact baseline. A forward value in `inventory-partial`
  data is the explicit exception and must clear it; no marker is cleared by a
  failed fetch.
- PASS iff the marker map, verification state, current-drop selection, and
  summary transition match the rule; record before/after percentages/minutes and
  provenance for every subcase.
- Required screenshot: a cleared state (and, where useful, the preserved
  equal/weaker state). Strict-proof live subcase is credential-dependent.

#### 9. Sibling campaign isolation (original case 9)

- Fixture: two campaigns for the same game with reused benefit IDs and ambiguous
  timestamps. Include delimiter-bearing identities (for example campaign `c::b`
  with reward `a`, and campaign `c` with reward `b::a`) plus a malformed/blank ID.
- Action: mark/prove/refresh only one campaign, then project both campaigns and
  reload timing state.
- PASS iff canonical identity keeps the sibling `unassessed`/unmarked, no
  reward or summary crosses campaigns, malformed keys are rejected, and missing
  campaign identity never creates a durable marker. Record canonical key output,
  both campaign IDs, and before/after marker maps.
- Required screenshot: sibling campaign cards/queue showing isolated status.

#### 10. Combined subscription + unverifiable remainders (original case 10)

- Fixture: complete campaign-authoritative set with no automatable watch-time
  reward, one subscription-gated remainder, and one marked Twitch-native
  remainder.
- PASS iff summary is `farming-complete` with ordered reasons
  `["subscription-required", "unverifiable-twitch"]`; exactly two restrained
  indicators (gift and question) render independently, two concise explanation
  lines are visible, green is absent, and Start/add-to-queue is rejected with
  `farming-complete`.
- Required screenshot: popup and monitor combined state. Record reward IDs,
  reasons/order, queue unchanged, and HTML/screenshot paths.

#### 11. Farming-complete queue/router terminal behavior (original case 11)

- Fixture: queue head is farming-complete, followed by a farmable campaign;
  exercise direct Start, add-to-queue, both queue advancement paths, and the
  runtime router with valid and malformed payloads.
- PASS iff direct Start rejects before refresh/session/queue mutation; add-to-
  queue returns typed `farming-complete` (all-acquired retains its legacy
  `already-completed` reason); queue loops skip the terminal head and select the
  next farmable campaign; malformed requests fail closed; popup/monitor terminal
  copy is verification-specific and never says all rewards were acquired.
- Record router request/response JSON, queue before/after, event ordering, and
  cleanup of mocks/listeners.

#### Mixed-reward continuation correction (Todo 11)

- Fixture: selected campaign contains a marked Twitch-native reward plus a second
  automatable watch-time reward. Exhaust the native reward at attempt 3.
- PASS iff event order is `marker-save -> reproject -> reacquire`, the selected
  campaign and queue head remain unchanged, `currentDrop` becomes the next
  automatable reward, the native reward remains unverifiable, the session stays
  `RUNNING`, and no terminal stop reason is emitted. This is distinct from the
  farming-complete queue-advance case above.
- Record selected/next reward IDs, exact native progress/minutes, queue state,
  event log, and streamer reacquisition result; cleanup timers and fakes.

### Additional required recovery/clear probes

These probes are controls required by Todo 10/11 even when not a separate
original manual case.

| Probe | Action | Binary PASS observable |
| --- | --- | --- |
| No pre-third marker | Run native reward through attempts 1 and 2 only. | Marker map remains empty; ordinary recovery continues. |
| Missing campaign ID | Exhaust an otherwise native reward with blank/missing campaign ID. | No durable marker; ordinary `stall-skipped` path/copy; no sibling impact. |
| In-game/unknown exhausted stall | Exhaust each at attempt 3. | No native marker; existing ordinary stall behavior remains unchanged. |
| Expiry clear | Project an expired marked reward from authoritative data. | Marker and unverifiable state clear; expiry is recorded as source. |
| Authoritative disappearance | Complete authoritative campaign snapshot omits the marked reward. | Marker clears only for that campaign/reward; partial/cached omission preserves it. |
| Authoritative empty | Successful authoritative zero-reward response (`dropCount=0`) with stale cached data. | Marker, cached reward, and volatile projection clear; failed fetch does not. |
| Remainder ordering | Run subscription-only, unverifiable-only, and combined complete sets. | Reasons are respectively `[subscription-required]`, `[unverifiable-twitch]`, and the ordered pair; `allDropsCompleted` is true only for all-acquired. |

## Release-ready gate (authenticated Chrome and live soak)

1. Run `rtk bun run release:check`; for store handoff also run
   `rtk bun run release:zip`. Record the extension version/hash and Chrome/Edge zip path,
   then install the produced artifact in a clean profile.
2. Record Chrome version, OS, profile/auth state, campaign/game/reward/benefit
   IDs, and the exact live Drops source. Keep DevTools service-worker console
   open; do not export cookies, tokens, or personal data.
3. Repeat cases 1–3 and 5–11 when live campaigns permit. Use the deterministic
   fixture result as the code-complete control, but mark unavailable live
   prerequisites explicitly as campaign-prerequisite, credential-dependent, or
   environment/browser blockers, naming the exact missing prerequisite and
   owner. Attempt case 4 (strict award evidence) only with
   authenticated Twitch data identifying the exact benefit, game, campaign, and
   timestamp window; it is **credential-dependent** and cannot be replaced by
   an unauthenticated fixture.
4. Run the long-run portion: start a valid live stream, observe at least two
   hours, force one service-worker restart, and verify `RUNNING`/`RECOVERING`,
   progress movement, preserved backoff/integrity state, and no unexpected
   `IDLE`. Record heartbeat/restart timestamps and popup/monitor screenshots.
5. Exercise ordinary recovery controls: player stall (self-heal then rotate or
   backoff), offline/wrong-game/wrong-channel/drops-inactive, and closing the
   managed tab when it is the only tab in its window. PASS iff recovery reason
   and retry labels are visible, the Chrome window remains open, and ownership
   is released safely.
6. Exercise terminal controls: manual stop, natural queue completion, and
   invalidated Twitch session. PASS iff stop reasons are respectively visible,
   `queue-complete` stops monitoring, and `sign-in-required` is terminal without
   a hidden recovery loop.
7. Required release screenshots are the popup/monitor views for original cases
   **2, 3, 5, 7, 8, and 10**. Name files with case, campaign ID, timestamp, and
   track (for example `case-05-camp-abc-2026-07-27T120000+0200-live.png`).
8. At the end, verify queue, marker, tab, timer, storage-mock, and temporary
   server cleanup. Revoke/close any test credentials according to the test
   account policy and record the cleanup receipt.

## Final sign-off matrix

| Requirement | Code-complete artifact | Release-ready artifact / disposition |
| --- | --- | --- |
| Exact 99% and 0% exhausted recovery | Fixture event/state log and test output | Live screenshot/log, or campaign-prerequisite/environment blocker with exact owner |
| No pre-third marker | Attempt 1/2 marker-map assertion | Live recovery attempt log, or campaign-prerequisite/environment blocker |
| Mixed same-campaign continuation | `marker-save -> reproject -> reacquire` event log | Live queue/session observation, or campaign-prerequisite/environment blocker |
| Restart persistence | Storage round-trip JSON and screenshot | Browser restart screenshot/log, or environment/browser blocker |
| Strict proof and forward clearing | Strict fixture + provenance matrix | Authenticated Twitch proof, or credential-dependent blocker for missing auth/evidence |
| Expiry/disappearance/empty clearing | Authoritative/partial/failed fixture outputs | Live Drops refresh evidence, or campaign-prerequisite blocker |
| Sibling and delimiter-safe isolation | Canonical key/marker map JSON | Live sibling campaigns, or campaign-prerequisite blocker |
| Missing-ID ordinary stall | Stall fixture output | Live malformed/missing campaign observation, or environment blocker |
| Subscription/unverifiable/combined remainders | Summary/reason JSON + rendered HTML | Popup/monitor screenshots, or environment/browser blocker |
| Fresh 0% native startability | Start/queue fixture output | Live fresh campaign screenshot, or campaign-prerequisite blocker |
| Queue/router reason behavior | Request/response and queue event logs | Popup/monitor terminal screenshot, or environment/browser blocker |

Sign off only when every row has PASS or an explicit
**BLOCKED — credential-dependent**, **BLOCKED — campaign prerequisite
unavailable**, or **BLOCKED — environment/browser unavailable** disposition
with the exact missing prerequisite and owner. Do not use a credential block for
a missing campaign or browser surface.
