# DropHunter reward and recovery soak checklist

Use this checklist together with [v4 automation acceptance](v4-automation-acceptance.md).
The release build must pass deterministic checks and an authenticated live run.
A fixture result does not establish that Twitch credited watch time or awarded a reward.

## Evidence tracks

| Track | Proves | Does not prove |
| --- | --- | --- |
| Deterministic fixtures | Campaign projection, ordering, recovery decisions, persistence and rendered status with controlled clocks/data | Real Twitch eligibility, watch-time credit or reward ownership |
| Authenticated browser | Behavior of the exact built extension on the recorded account and campaigns | Availability or behavior of unobserved campaigns/accounts |

Record PASS, FAIL, or one of these explicit unavailable prerequisites:
**credential-dependent**, **campaign prerequisite unavailable**, or
**environment/browser unavailable**. Never relabel an unavailable live case as passed.

## Record for each case

Record the case and track, operator/run identifier, start/end timestamps with
timezone, browser/version/OS, extension version and artifact path, clean-install
or upgrade state, game/campaign/reward IDs, source provenance, exact minutes and
percentage before/after, queue before/after, visible popup/monitor state, result,
log/screenshot paths, and cleanup. Never record credentials, tokens or full
browser storage dumps.

## Reward semantics

| Case | Required observation |
| --- | --- |
| Ordinary watch-time reward | Current reward progresses; pending excludes current; claimed/acquired state requires actual evidence |
| Fresh Twitch-native badge/emote at 0% | Starts like any eligible watch-time reward; it is not marked unverifiable merely because it is new |
| Subscription-only remainder | Farming-complete with subscription-required reason; no automatic subscription purchase and no all-acquired claim |
| Mixed reward campaign | Finishing one reward continues an automatable remainder in the same campaign before advancing the queue |
| Strict native ownership proof | Positive evidence identifies the exact benefit, game, campaign and acceptable timestamp window; ambiguous ownership cannot prove acquisition |
| Duplicate campaigns/benefits | Progress and ownership never cross campaign identity, including delimiter-bearing IDs and reused benefit IDs |
| Authoritative empty campaign | Successful complete response clears stale projection; failed, cached or partial responses cannot prove disappearance |
| Completed vs farming-complete | Popup and monitor distinguish acquired rewards from remainders automation cannot obtain; terminal copy is truthful |

Retain compatibility checks for already-stored unverifiable markers: preserve
exact progress (including 0% and 99%) across normalization/restart, isolate
campaign identities, clear only on the established authoritative evidence, and
never coerce a marker to 100%. A partial snapshot omission cannot clear a marker.

## Version 4 exhausted-stall behavior

Exhausting recovery now excludes the campaign; it does **not** create a new
unverifiable reward marker or claim that the reward was acquired. This replaces
the older third-attempt reward-marking behavior.

1. Start an eligible campaign with a known reward, testing both 0% and 99%.
2. Confirm no progress through the duration-aware observation window and
   authoritative refresh. Missing DOM Drops labels alone are insufficient.
3. Verify the bounded self-heal/alternative-streamer attempts. A failed
   campaign or inventory refresh consumes no stall attempt and cannot create
   an exclusion.
4. On exhaustion, verify exact progress is unchanged, the exact campaign moves
   to the queue tail and its exclusion is persisted. No acquired, complete or
   new unverifiable marker is fabricated.
5. With another authorized campaign, advance to it. With only excluded or
   never-started manual work, stop with an explanatory message.
6. Refresh identical data and restart the worker: the excluded campaign must
   not restart. A new campaign for the same favorite game remains independent.
7. Provide positive authoritative progress or a newly eligible streamer absent
   from the persisted baseline, or explicitly press Start: only the appropriate
   exclusion is cleared.
8. Repeat with mixed native/in-game rewards: exhaustion blocks the campaign
   without cycling endlessly through its remaining rewards or changing their
   acquisition status.

## Authenticated production run

1. Run the release gate and dependency audits from the store checklist. Load
   the exact produced Chrome and Edge artifacts; record the build identifier.
2. Verify clean-install connection, campaign loading, manual Add/Start,
   favorite auto-start, expiry preemption and continuation, pause/stop,
   settings, claim flow and monitor. Verify an upgrade preserves explicit
   preferences and authorized queue intent.
3. Observe a real active campaign for **at least two hours** with measurable
   reward progress. Record starting/ending minutes and percentages and at
   least one intermediate observation.
4. Restart the service worker during the run. Verify monitoring resumes as
   allowed, progress does not regress, queue authorization/exclusion survives,
   and no duplicate managed tab or notification is produced.
5. Exercise hidden fallback, offline/wrong-channel conditions, an interrupted
   refresh and recovery. Keep the user's Chrome window open when releasing the
   only managed tab in that window.
6. Play personal Twitch streams in foreground and background tabs, then stop
   or close them. Verify automated playback suspends while any remain playing
   and resumes only after the final stop and 30-second grace. Repeat across a
   worker restart; detection errors must not count as a confirmed stop.
7. Check independent browser/Telegram settings and optional permissions.
   Distinct real transitions notify again; duplicate evaluations of the same
   transition do not. Delivery failure never stops farming.
8. Verify real invalid OAuth gets one silent browser-session resync before
   sign-in-required; integrity/network failures remain recoverable and retain
   the queue. Do not invalidate the user's credentials merely to manufacture
   a live failure; use controlled deterministic failure coverage when needed.

Capture the real popup and monitor for initial connection, running hidden,
managed fallback, personal-view suspension, recovery/exclusion, and terminal
completion/attention. Record live campaign prerequisites separately when a
specific reward shape cannot be exercised.

## Sign-off and cleanup

Close only test-owned tabs/windows, stop temporary servers, remove test mocks,
and record cleanup. Keep logs and redacted captures with the artifact identifier.
Do not publish stable 4.0.0 until required automated checks and the authenticated
long-run prerequisite pass. A blocked case records its missing prerequisite and
owner; it is not a successful observation.
