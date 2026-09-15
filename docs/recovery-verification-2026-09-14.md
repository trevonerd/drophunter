# Queue and recovery verification — 2026-09-14

## Release status

Implementation and deterministic verification target **4.0.0-beta.19**
(manifest technical version **3.99.0.19**). Stable 4.0.0 is not approved for
publication until the authenticated artifact-specific checks below pass.
Existing working-tree changes were preserved and integrated; no release was published.

## Incident evidence and limits

The supplied screenshots show repeated directory recovery, campaign rotation
and Marvel remaining queued. They do not identify the original Twitch response
or prove which extension build was installed.

Before rebuilding, both generated manifests identified beta.18. The Chrome
generated build was preserved at
`/private/tmp/drophunter-before-recovery-chrome-20260914`.
Its manifest SHA-256 was
`6a6901d0ec053ce64bd0e1055259df21044926ff6b2022dcfd97dc964dfb3093`;
its background script SHA-256 was
`0017ce57f43a0c2114963aa5594bd216ec3cdf669965873d3cf96803913ccc3a`.
These identify generated files, not the installed extension.

The initial browser inspection reached only Chrome's Work/Your Chrome profile
picker. A later CUA inventory reported the Mac locked and automatic unlock
unavailable. No extension reload, storage cleanup or live farming test was
performed. The incident profile and installed version remain unverified.

## Reproduced failures and changes

- The original exported queue functions produced Skull → LEGO → WARDOGS →
  Skull repeatedly with four campaigns and elapsed cooldowns. The assertion
  `STARVATION: Marvel must receive a turn before any campaign is retried`
  failed. The original 60 focused tests passed because they lacked a complete
  round scenario.
- Acquisition rounds now persist campaign keys and a next-round deadline.
  Configured priority ranks untried eligible campaigns; cooldown expiry cannot
  make an already-tried campaign overtake them. A successful acquisition ends
  the round. Empty rounds wait with the authorized queue intact.
- Successful empty directory responses use an initial attempt and one retry
  after 30 seconds, then park the campaign. Typed authentication, integrity,
  network, invalid-response and rate-limit failures enter global recovery;
  they do not consume campaign attempts or rotate the queue. Rate limits retain
  the complete deadline across persistence.
- Startup validates before automation acquisition. Acquisition, monitoring and
  activation operations verify wall-clock deadlines on later events as well as
  in-memory timers. Tests jump 72 hours without firing timers and reject stale
  results. Expired operations cannot retain an immortal lock.
- Stop invalidates pending work immediately, detaches a blocked mutation and
  snoozes automatic favorite evaluation. Generation guards prevent late
  transport acquisition, queue commits, session sync and API snapshots from
  restoring a stopped session. Pending storage writes are compensated by the
  existing guarded persistence mechanism. Authentication-required stops retain
  the queue round and authorization for subsequent recovery.
- Popup and monitor distinguish global recovery causes and retain truthful
  overdue-retry copy. A local sanitized diagnostic history stores at most 200
  events; no credentials or raw transport errors are included.

## Deterministic acceptance coverage

| Area | Evidence |
| --- | --- |
| Fairness | `queue-acquisition-round.test.ts`: four screenshot campaigns, one/four/ten entries, cooldown expiry during a round, all unavailable, queue changes and persisted restoration |
| Configured priority | `queue-round-automation-policy.test.ts`, `farming-automation-parked-queue.test.ts`: favorites and manual campaigns respect configured ordering |
| Global recovery | `streamer-global-recovery.test.ts`, `streamer-directory-wire-failures.test.ts`: typed failures, no local budget/selection mutation, complete rate-limit deadline, singleflight acquisition |
| Wake and startup | `monitoring-sleep-watchdog.test.ts`, `activation-sync-wake-deadline.test.ts`, `startup-validation-order.test.ts`, `campaign-expiry-after-sleep.test.ts` |
| Cancellation | `farming-stop-pending-acquisition.test.ts`, `auth-resume-stop-interleavings.test.ts`, `farming-transition-stop-durability.test.ts`, acquisition/queue cancellation tests |
| Intent persistence | `queue-auth-recovery-persistence.test.ts`, runtime/storage/crash-recovery suites |
| Status and diagnostics | `runtime-diagnostics.test.ts`, runtime-status and popup tests; local rendered popup/monitor fixtures |

Failures were reproduced before the watchdog, wake-deadline, startup-order,
Stop, stale-commit and late-auth fixes. Integration tests invoke real session,
startup, monitoring, API wrapper and persistence boundaries with controlled
dependencies. This proves deterministic behavior, not live Twitch watch credit.

Two independent visual reviews passed three current-source rendered fixtures:
popup rate-limit, popup overdue retry and monitor overdue retry. Evidence is in
`../.omo/evidence/v4-automation/recovery-20260914.md`. Fixtures used controlled
state and no-op actions; they do not count as installed-extension QA.

## Automated gates and artifacts

The final `bun run release:check` passed: TypeScript scope, TypeScript, Biome,
the full test suite, both production builds, packaging, manifests and archive
validation. Log: `../.omo/evidence/v4-automation/recovery-release-20260914.log`.
Independent code review approved the final fixes with no remaining code blockers;
report: `../.omo/evidence/drophunter-recovery-code-review.md`.

Artifacts from that exact final gate:

| File | SHA-256 |
| --- | --- |
| `.output/drophunter-4.0.0-beta.19-chrome.zip` | `02b995d58fb6556a8b2d9383fbdffe725481d757495756a251b3446131627fc9` |
| `.output/drophunter-4.0.0-beta.19-edge.zip` | `23ca12a2d64c656af4ee10e470383c5fd8590b27ed8820408b812102faf88bc3` |
| Both generated manifests | `1f6106586d7d09f2489a8578abf889514b68387f8b88f60638cb40ca7a1e208b` |
| Chrome generated background script | `b64b303053b7ef94647d53784c454b78ab392c65ed1a539a7a41f3105724dd13` |

Root adm-zip was updated to 0.6.1 and video js-yaml to 4.3.2 using minimal
overrides and lock updates. Both dependency audits returned no vulnerabilities,
including a final check after packaging. Network access was required; sandbox
connection failures were retried with the permitted network escalation.
The video CTA still-render smoke test passed after allowing the local Chromium
launch that the filesystem sandbox initially prevented.

The vexp verification tool returned an unrelated Faceit workspace. Its output
was excluded from evidence; the repository's own scope, type, lint, test and
build commands provide the relevant verification.

## Required live checks — not executed

| Requirement | Status / missing prerequisite |
| --- | --- |
| Installed incident build and retained diagnostic events | Environment/browser unavailable: unlock Mac and identify Chrome profile |
| Clean install and upgrade of exact Chrome and Edge artifacts | Environment/browser unavailable |
| Real browser restart, worker restart and laptop suspension/resume | Environment/browser unavailable |
| Two hours authenticated farming with beginning/intermediate/end Twitch progress | Credential-dependent; no authenticated observations recorded |
| Final stable 4.0.0 manifests and store packages | Pending all required artifact-specific live checks |

Follow `soak-test-checklist.md` and `chrome-web-store-checklist.md`.
Record unavailable campaign/account prerequisites explicitly. Keep beta versioning
until both automated and authenticated gates pass; do not infer success from ZIP
creation or simulated time. Temporary UI fixture server and test tab were closed.
