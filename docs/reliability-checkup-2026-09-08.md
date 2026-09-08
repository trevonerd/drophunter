# DropHunter reliability checkup — 2026-09-08

Follow-up: the [native reward and integrity investigation](native-reward-checkup-2026-09-08.md)
records additional reproduced defects, authenticated browser evidence, fixes and
an updated score. This document retains the initial checkup's historical results.

This checkup addresses stuck farming, absent playback, restart/update behavior,
cancelled asynchronous work, campaign preservation, and duplicate favorite alerts.
The screenshot is a symptom report; it does not establish which live failure path
occurred on that account.

## Score

Engineering assessment: **64/100 before → 88/100 after**.
This is a judgment against the same rubric, not a
measured uptime percentage or a promise that Twitch always credits watch time.

| Area | Before /20 | After /20 | Evidence and limits |
| --- | ---: | ---: | --- |
| Startup and recovery | 10 | 18 | Initialization dependency ordering, lost managed-tab identity, missing watcher and backoff recovery |
| Concurrency and cancellation | 9 | 18 | Watchdog ownership, late open/probe/stop, cancelled validation, rotation, refresh and recovery |
| Notifications | 12 | 18 | Favorite alert coalescing, serialized receipts, independent delivery and receipt repair |
| Campaign/data compatibility | 17 | 18 | Existing campaign-aware suite plus queue retention and upgrade/downgrade preservation |
| Verification and release readiness | 16 | 16 | Broad automated checks; authenticated Twitch credit and the two-hour soak remain unverified |
| **Total** | **64** | **88** | Live-provider uncertainty prevents a perfect score |

## Confirmed defects and corrections

1. **Initialization could wait on itself.** Startup queue advancement could reach
   automation-dependent campaign handling before automation was initialized.
   Hydration and resume preparation now precede automation restoration; expired
   queue advancement and monitoring start follow automation readiness.
2. **Managed Start discarded its own tab ID.** Playback registered the opened
   tab, then the coordinator cleared the ID. It now clears tab identity only for
   tabless starts. Explicit starts and restored starts retain managed ownership.
3. **An absent watcher could remain “Running.”** A restored Hidden selection
   without a usable watcher/streamer could bypass reacquisition. Missing playback
   now enters the existing acquisition path; active API backoff becomes visible
   recovery with a retry deadline. Unfinished campaign and progress remain intact.
4. **A failed managed open lost its failure state.** Subsequent ticks returned
   `not-started` without requesting recovery. Failed opens now retain recoverable
   health. Generic playback failure reacquires rather than immediately skipping
   the unfinished campaign.
5. **Watchdog expiration did not invalidate old work.** Old checks could resume,
   release a replacement check's lock, and update heartbeat evidence despite
   being stuck. Expiration invalidates the generation; only the owning check
   clears its lock and saves timing state.
6. **API backoff bypassed monitoring guards.** Transport work ran outside the
   running/paused/in-flight checks. It now runs inside the guarded tick.
7. **Late transport effects could overwrite newer work.** Restoration, probes,
   fallback opens, and slow Stop now respect operation and caller cancellation.
   Obsolete provisional resources are released.
8. **Late validation and recovery could affect another session.** Session epoch,
   tick generation, and campaign identity guard directory failures, stream
   validation, rotation, and stalled recovery. Predicates reach refresh and
   transport callbacks; obsolete results cannot advance the replacement queue.
9. **Cancelled inventory work delayed the next refresh.** The five-minute
   throttle timestamp was committed before the request completed. It is now
   committed only after a current request returns.
10. **A newly started favorite produced discovery and start alerts.** Immediate
    starts/preemptions now use one alert per destination. Favorites that remain
    queued, and discoveries whose start fails, keep their discovery alert.
11. **Concurrent receipt writes overwrote each other.** The persistent receipt
    read/modify/write sequence is serialized, including failure recovery.
12. **Successful delivery could repeat after receipt-write failure.** Successful
    destinations are remembered in the current worker. A later notification for
    that transition repairs the receipt without resending; reconstruction then
    uses the repaired durable receipt.
13. **Cancelled playback repair could still warn or retry.** The production
    playback adapter ignored its caller's cancellation predicate. It now checks
    before preparation, delayed retry, and attention notification. Four regression
    cases failed before the fix and pass with the predicate preserved.

The recovery wrapper was moved into a focused module to preserve the repository's
250-line limit. No user setting, runtime message, permission, dependency, store
version, or campaign identity contract was added or removed.

## Verification record

Baseline: clean working tree; Bun 1.3.14; **1,800 passing tests**, zero failures,
180 test files. New regression tests were run failing before their corresponding
fixes. Review found additional failures after the original suite passed; those
were reproduced and fixed too.

Covered deterministic scenarios include:

- Fresh, paused, active, failed and expired-campaign startup; crash/inactivity
  restoration; update and downgrade preference/queue preservation.
- Stop, same-campaign restart, campaign replacement and watchdog cancellation
  during tab open, probe, lookup, directory failure, refresh and recovery.
- Managed-open failure, missing watcher, API backoff, cancelled inventory
  refresh, manual-watch suspension and existing stalled-progress behavior.
- Favorite/manual queue authorization, duplicate campaign identity, completed,
  expired, vanished and unfinished rewards through the existing regression suite.
- Concurrent notification receipts, failed destination delivery, receipt storage
  failure/recovery and notifier reconstruction without real messages being sent.

The full integration suite caught an intermediate recovery regression: treating
every `not-started` transport as missing skipped claims and queue advancement,
including when an existing managed tab was valid. Missing detection now respects
managed tab identity, and inventory/claim/completion work precedes the recovery
retry exit. Regression coverage verifies this ordering.

An intermittent timeout-test failure was separately reproduced in isolation.
Its one-millisecond deadline sometimes elapsed before tab creation; asserting
that a tab was removed was then incorrect. The test now synchronizes with
readiness and removal, rather than relying on a five-millisecond sleep.

Final results:

- `bun test tests/`: **1,888 passed, zero failed, 193 files** (baseline: 1,800).
  The stabilized timeout scenarios also passed 200 repeated executions.
- `bun run release:check`: passed TypeScript scope, TypeScript, Biome, tests,
  Chrome/Edge builds and packaging, generated manifests and ZIP validation.
- `bun audit`: no vulnerabilities found.
- Chromium with the built MV3 extension: clean offline install renders an empty
  campaign state; a restored unfinished campaign with no watcher enters visible
  `directory-unavailable` recovery and an automatic retry deadline while retaining
  its queue entry and 92/120 minutes. Stop clears running/recovery state and keeps
  the queued campaign for a future explicit start.
- Independent code review found and verified the additional cancellation fixes.
  The remaining notification delivery limits are stated below.

Browser evidence: [clean install](evidence/reliability-checkup-2026-09-08/clean-install.png),
[restored recovery](evidence/reliability-checkup-2026-09-08/restored-recovery.png),
[completed Stop](evidence/reliability-checkup-2026-09-08/stopped.png), and
[recorded state and text](evidence/reliability-checkup-2026-09-08/observations.json).

## Practical limits

- No finite test suite proves every browser/Twitch/account/timing combination.
- Authenticated Twitch watch-time accrual, real reward claiming, and the required
  two-hour live soak were not performed. Follow `docs/soak-test-checklist.md` for
  those checks; controlled fixtures do not establish Twitch credit.
- Browser QA uses a disposable Chromium profile and synthetic campaign data.
  Existing browser profiles, credentials, and real Telegram destinations are not
  used. Edge is built and validated; a separate interactive Edge run is not claimed.
- A worker killed after remote delivery but before its receipt becomes durable
  can still permit redelivery. Receipt-read failure suppresses delivery rather
  than risking an unverified duplicate. These are not exactly-once guarantees.
- vexp was invoked at task start and for `verify_done`; both returned a different
  repository (`faceit-new-frontend`). Its findings were excluded. DropHunter's
  context index, actual source, compiler and tests supplied the evidence.

The output remains **4.0.0-beta.15** for local/GitHub beta use. Source changes and
rebuilt archives do not automatically reload an already-installed extension.
