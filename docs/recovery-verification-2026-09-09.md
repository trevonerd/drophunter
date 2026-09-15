# Recovery verification — 9 September 2026

Build: local `4.0.0-beta.16`, Chrome unpacked from `.output/chrome-mv3`.
No stable release or store submission was performed.

## Live observations

- Twitch marked **R6S S2 2026 2** closed at **06:58 CEST**, while DropHunter
  still displayed a positive remaining duration and a multi-minute streamer retry.
  After rebuilding/reloading, that campaign no longer appeared as available.
- **GTA V · nopixel V** resumed and displayed **1%** progress after reload.
  Both manually queued Albion campaigns remained present with corrected countdowns.
  On the final build reload, initialization briefly showed Ready, then farming resumed
  automatically at **16%**, up from **15%** before reload. No Start action was needed.
- **LEGO Batman · Mayhem Collection – DC** was still active, ending
  **20 September, 08:59 CEST**. Twitch restricted its watch rewards to **DCofficial**,
  which was not shown live; its next listed Drops broadcast was **20:00–22:00 CEST**.
  BloodNNights was not an eligible channel for that exact campaign.
  Twitch also displayed the publisher-account connection requirement.
  The exact original LEGO campaign, removed earlier by the old build, was restored
  using Add to queue. Both Albion entries remained ahead of it and GTA stayed active.
- The old validation banner cleared after reload. Historical error details were
  no longer retained, so the exact cause of that earlier request is unverified.

## Confirmed defects and corrections

1. Cached `expiresInMs` overrode absolute `endsAt`. Background expiry and popup
   countdowns now share absolute-deadline precedence.
2. Global API backoff blocked queue recovery. A campaign gets a 30-second retry
   deadline, serviced by the normal heartbeat, while Twitch's network cooldown
   remains intact. Restored legacy acquisition timers are capped at 60 seconds.
3. Exhausted streamer acquisition deleted valid queued campaigns. They now remain
   queued with a persisted 60-second retry deadline and original provenance.
   Ending-soonest continuation considers campaign deadlines; explicit priority-list
   order remains respected. An entirely unavailable queue waits without claiming
   completion or revoking its existing manual authorization.
4. A failed successor start could announce “Now farming”. That announcement now
   requires a successful start of the same selected campaign.
5. During integration, a successor inherited the previous campaign's vanished-drop
   counter. A failing regression caught this; clearing a selected projection now
   also clears that counter.
6. Slow downstream farming discovery could time out an activation whose fresh,
   inventory-verified catalog had already succeeded. Validation is now published
   at that verified boundary; downstream failure does not falsify catalog freshness.
   Cached and inventory-only results do not qualify.
   Checkpoints also require successful publication and the current request generation;
   storage failure or timeout cannot falsely report validation success.
7. Validation feedback now distinguishes network, integrity, rate-limit, incomplete
   response and session failures, and displays the automatic retry timing.

## Verification and remaining release work

- Failing-first regressions cover expiry after sleep, queue retention and deadlines,
  all-unavailable queues, manual authorization, stale counters, cooldown suppression,
  persisted timers, truthful notifications and activation timeout/cancellation.
- `bun run release:check` covers TypeScript scope, TypeScript, Biome, the full test
  suite, Chrome/Edge builds and generated manifest/archive checks.
  The final run passed every stage after all corrections.
- Live Chrome reload and popup were checked. Network/integrity/auth feedback was
  additionally rendered with real components and built CSS in isolated fixtures;
  text and controls remained readable at popup width.
- `bun audit` reports one moderate build-tool dependency advisory in
  `wxt → web-ext-run → firefox-profile → adm-zip` (0.6.0):
  [GHSA-vwc7-r8mq-g2x9](https://github.com/advisories/GHSA-vwc7-r8mq-g2x9).
  The advisory listed no patched version when checked. This audit is separate from
  the passing release-check script; it has not been waived or hidden.
- The authenticated two-hour soak and full Chrome/Edge store acceptance matrix in
  [the soak checklist](soak-test-checklist.md) remain prerequisites for stable release.
  The short live check does not establish all campaign eligibility or reward claims.
