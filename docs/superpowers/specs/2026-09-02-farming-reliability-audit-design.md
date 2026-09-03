# Farming reliability audit design

## Goal

Make DropHunter maximize unattended Twitch Drops farming while keeping the current feature set and modular architecture. The extension should recover from transient failures without exposing errors, rotate streamers only after confirmed lack of progress, prioritize eligible expiring favorites, and resume safely after browser, computer, or network interruptions.

## Scope

Audit the current uncommitted work across Twitch session synchronization, campaign refresh, farming recovery, queue automation, popup state, notifications, persistence, and tests. Preserve the existing focused modules and remove complexity only where the audit proves duplication, dead behavior, or an incorrect policy.

## Campaign and queue policy

- A newly discovered favorite campaign may preempt the active campaign only when it has a known, strictly earlier expiry and a proven eligible streamer.
- Preemption keeps the interrupted campaign as the next queue entry.
- An authoritative campaign refresh is a successful, complete Twitch refresh. Network failures, timeouts, partial responses, and cached data cannot prove that a campaign disappeared.
- The first authoritative refresh that proves the active campaign is absent, or has no obtainable watch-time reward, marks it unfarmable immediately.
- An unfarmable campaign is removed, a warning is published, and farming advances immediately to the next eligible queue entry.
- A still-valid campaign with no working streamer is parked rather than removed. DropHunter advances to other work and re-evaluates parked campaigns every five minutes.
- A recovered parked favorite re-enters the queue according to expiry and may preempt under the same strict eligibility rule.

## Progress and streamer policy

- The lightweight farming heartbeat runs every minute, inventory progress refreshes every five minutes, and the complete campaign catalog refreshes every thirty minutes.
- Streamer metadata never causes rotation while authoritative Drop progress continues.
- A confirmed progress stall requires at least five minutes without authoritative progress. For long rewards whose progress is visible only as coarse percentages, the window expands enough to observe two percentage increments.
- After a confirmed stall, DropHunter refreshes authoritative progress and campaign state before diagnosing the stream.
- If the campaign remains farmable, DropHunter tries other eligible streamers in the same transport mode.
- After exhausting useful streamers, the campaign is parked and the next eligible campaign starts.

## Watch transport policy

- Hidden mode never creates or falls back to a DropHunter-managed Twitch tab.
- A Hidden stall is recovered with other Hidden streamer attempts, then campaign parking.
- Managed-tab mode continues to create, verify, mute, repair, and release only tabs owned by DropHunter.
- Eligible Twitch tabs opened manually by the user remain observed without becoming DropHunter-owned tabs.
- The user must explicitly select managed-tab mode when they want DropHunter to create a Twitch viewing tab.

## Authentication and transient failure policy

- A real authentication failure is an explicit invalid-OAuth response that remains unresolved after one silent resynchronization attempt from an existing Twitch tab.
- Only a real authentication failure suspends farming and shows the **Open Twitch** action.
- The queue and selected campaign remain intact while authentication is blocked.
- Farming resumes automatically when a valid Twitch session is recovered.
- Network loss, Twitch 5xx responses, timeouts, missing cached sessions, and expired integrity tokens use silent retry and backoff. They do not clear farming state or surface as user-facing errors.
- Session and token refreshes run only when missing, expired, explicitly rejected, or required by an authoritative operation.

## Persistence and restart policy

- Persist farming intent, exact campaign identity, queue order, parked state, progress timing, and user preferences.
- Time spent with the browser or computer closed does not count as a progress stall.
- Startup performs fresh session, campaign, inventory, and transport checks before applying recovery decisions.
- Starting without internet waits with silent backoff and resumes when connectivity returns.
- A campaign that ended while the browser was closed is removed only after the first authoritative startup refresh proves it unfarmable.
- A manual stop remains authoritative across restarts.

## User-visible communication

- Transient recovery, streamer search, and campaign parking use neutral status, not error presentation.
- An unfarmable campaign publishes one warning per campaign identity in the popup and enabled notification channels:

  `The {gameName} campaign is no longer farmable. DropHunter is moving to the next campaign.`

- Browser and Telegram notifications respect their existing settings. Missing Telegram configuration never blocks farming.
- Notification deduplication survives service-worker restarts.
- **Open Twitch** and its authentication error are reserved for confirmed invalid OAuth state.

## Implementation approach

Keep the existing module boundaries. Represent refresh and recovery outcomes explicitly so orchestration chooses exactly one action: continue, rotate, preempt, park, remove, wait, or request authentication. Reuse the existing notification controller, Telegram notifier, persistence boundary, queue identity helpers, and transport abstractions. Avoid a new global state machine or unrelated refactor.

## Verification

- Add regression tests before behavior changes for strict favorite preemption, authoritative disappearance, warning deduplication, Hidden parking, streamer rotation gating, parked-campaign revival, authentication classification, restart timing, and offline recovery.
- Run the focused queue, farming, recovery, session, persistence, notification, popup, and service-worker suites while implementing.
- Run TypeScript checks, Biome, the complete Bun test suite, Chrome and Edge builds, manifest verification, dependency audit, and the repository release check.
- Exercise the install/onboarding, queue/start, Hidden, managed-tab, manual-tab, stalled-progress, favorite-preemption, vanished-campaign, authentication-recovery, browser-restart, and offline-start flows manually.

## Delivery

- Audit all existing uncommitted changes against this design and repository standards.
- Group changes into atomic commits by behavior and revertability.
- Advance the 4.0.0 beta train after the behavior is verified; this work shipped in `4.0.0-beta.12`.
- Regenerate the Chrome and Edge beta release archives with the public beta version in their filenames.
- Push the completed history, including the existing local commit, to `origin/main` without rewriting history.
