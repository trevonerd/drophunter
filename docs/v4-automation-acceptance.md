# Version 4 automation acceptance

This is the acceptance contract for the v4 automation changes. It supplements
the existing [soak checklist](soak-test-checklist.md), rather than replacing its
reward-evidence requirements. Each case needs a recorded PASS, FAIL, or a precise
unavailable prerequisite; fixtures do not prove live Twitch watch-time credit.

## Deterministic scenarios

| Case | Action | Required observation |
| --- | --- | --- |
| Fresh install | Initialize without stored settings, then connect Twitch | Favorite auto-start and hidden preference enabled; notifications off; empty favorites remain idle |
| Upgrade | Restore explicit disabled auto-start and managed transport | Explicit preferences remain; obsolete priority choices normalize to the single policy |
| Manual queue | Add A then B; run discovery; press Start | No playback before Start; authorized queue follows A then B |
| Mixed idle queue | Add A/B, star C, complete C | C starts automatically; untouched manual A/B remain queued and idle |
| Preemption | Start A/B, discover earlier favorite C, complete C | C preempts; A and its manual authorization survive; A/B resume |
| Favorite order | Star later-expiring B before earlier A | Favorite ordering follows expiry, not click order; equal/unknown expiry does not preempt current |
| Identity | Discover two campaigns for the same favorite game | Both retain independent campaign identities and progress |
| Unfavorite | Remove star with current, pending automatic and manual entries | Current continues; pending automatic entries disappear; manual entries remain |
| Stop/Pause | Stop or pause an eligible favorite with auto-start on/off | On permits restart at next evaluation; off respects the user command |
| Discovery | Run a five-minute deadline while idle/running/manual-viewing | New campaigns reconcile; personal playback still prevents automated playback |
| Personal stream | Play an unmanaged stream in a background tab | Farming transport suspends; campaign refresh continues |
| Several streams | Close/stop one of two personal streams, then the last | No early resume; resume after the last ends and the 30-second grace |
| Detection failure | Fail a personal-stream observation | Failure is not interpreted as playback stopped |
| Hidden failure | Reject hidden playback then allow managed preparation | Muted background fallback; progress and hidden preference preserved; reason visible |
| Slow reward | Advance a long-duration reward while DOM Drops signal is missing | No three-minute forced rotation; adaptive progress threshold applies |
| Weak data | Return stale/cache-only/failed refresh during suspected stall | No false authoritative stall proof or queue erasure |
| Exclusion | Exhaust streamer recovery with/without other authorized work | Campaign moves to tail and is excluded; continue authorized work or stop with reason |
| No new evidence | Refresh unchanged data and restart worker after exclusion | Campaign remains excluded; no restart loop |
| New evidence | Report new eligible streamer, positive progress, or explicit Start | Exact blocked campaign can retry; sibling campaign unaffected |
| Authentication | Reject stale OAuth then recover current browser session | Silent recovery before sign-in prompt; queue retained |
| Error distinction | Return network/integrity failure | Recoverable state, no false sign-in-required or empty authoritative list |
| Notifications | Enable either/both/neither channel and repeat the same event | Only enabled destinations receive the event, once per transition; delivery failure does not block farming |
| Worker lifecycle | Restart during preemption, exclusion and personal viewing | Queue authorization, block and manual-view ownership persist without duplicate playback/events |

## Production and live checks

1. Run `bun run test:ts`, `bun run lint`, `bun test tests/`,
   `bun run build:all`, and `bun audit`; use `bun run release:check` to validate
   the generated manifests and archives. Follow the store checklist for the
   video dependency audit as well.
2. Load the exact built Chrome and Edge artifacts. Exercise first connection,
   settings, manual queue, favorite start and Stop/Pause explanation in the
   real popup; check the corresponding monitor states and keyboard access.
3. Check both a clean install and upgrade preserving explicit preferences.
4. On authenticated Twitch, record campaign/reward IDs and positive progress
   over at least two hours. Include a worker restart and recovery. Record
   personal-view suspension/resume and hidden fallback without exporting tokens.
5. Capture the final popup/monitor states with the artifact version and
   timestamp. Record unavailable campaigns, browser access, or credentials as
   separate prerequisites, not as successful tests.
6. Change the release version to stable `4.0.0` and regenerate artifacts only
   after the required gates pass. Store publication is a separate action.

## Evidence record

For each run record: date, source/build identifier, browser/version, clean or
upgrade track, scenario, expected/observed result, test log or screenshot path,
and cleanup. For the live soak also record start/end times, reward progress
before/after, worker restart time and recovery observations. Never record OAuth,
integrity, bot tokens, or browser session dumps in the report.
