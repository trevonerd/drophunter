# Native reward and campaign recovery follow-up

This follow-up investigates the actual Resonance Minotaur failure after the
[initial reliability checkup](reliability-checkup-2026-09-08.md). Its additional
findings supersede the earlier assumption that the remaining failure had not
been observed in an authenticated browser.

## Observed evidence

- Twitch's claimed inventory and notification show Resonance Minotaur awarded.
- An authenticated Inventory request returns the exact benefit ID,
  `game: null`, and a valid `lastAwardedAt` inside the campaign window.
- DropHunter retained that badge at zero progress and `unassessed` verification.
- The extension logged an Inventory `service error`. Subsequent requests using
  its stored session succeeded with both its full headers and minimal headers.
  This does not establish the cause of that transient service error.
- Its persisted campaign validation failure was `failed integrity check`, with
  `lastErrorKind: integrity` and a scheduled retry. Login validity and this
  integrity failure are separate facts.

These observations were read in the user's existing Chrome session. Credentials
were used only inside the browser to call Twitch; none are in this report or the
fixtures. No notification was sent by a diagnostic probe.

## Corrections

1. Preserve explicitly game-less native awards. Verify badges and emotes using
   exact benefit identity, a valid timestamp in the reward window, and no known
   competing campaign. Missing/malformed game fields, wrong games, missing or
   invalid timestamps, out-of-window awards and duplicate campaign benefits
   remain unproven. In-game reward matching keeps its existing rules.
2. Withhold game-less award proof during progressive campaign discovery, before
   all competing benefits can be checked. Regression coverage includes the
   actual partial-to-final projection that otherwise retained a false claim.
3. Let stalled Hidden playback reach the bounded session recovery ladder.
   Eager managed fallback previously restarted Hidden tracking after failed
   tab creation and prevented exhaustion indefinitely.
4. Apply the existing unverifiable native-reward marker after exhausted
   recovery, persist it, and advance to another ordinary reward or campaign.
   An uncertain reward remains unclaimed; a newly discovered zero-percent
   reward does not get skipped just for being at zero.
5. Report generic API backoff as unavailable Twitch data, not unavailable
   streamer search. Actual streamer acquisition failures retain their specific
   reason. Cached login and unfinished campaigns survive transient failures.
6. Accept session/integrity evidence from the actual Twitch inventory page as
   well as campaign and channel pages. Reject unrelated origins.
7. Use a newly intercepted page integrity token during forced recovery when it
   differs from the rejected token. The same rejected token still requires
   refresh. A new token promptly retries integrity-blocked campaign validation;
   repeated tokens and unrelated network failures do not trigger retry loops.
   Token storage completes before acknowledgement and retry, including when the
   in-memory session has not been populated yet. Session and token are written
   together before publishing the new in-memory token: a failed write leaves
   redelivery eligible for recovery, and a newer in-memory session is preserved.

## Verification

New regressions failed before their corresponding fixes. Coverage includes badge
and emote acquisition at zero progress, ambiguous and stale evidence, progressive
snapshots, the real transport/session ladder over 25 simulated minutes, mixed
native/ordinary campaigns, queue advancement, token replacement, delayed token
storage, and trusted inventory-page messages.

- Full suite before the final storage-race regressions: 1,924 passed, zero failed,
  198 files. Three additional regressions and 92 related tests then passed.
- Final `bun run release:check` passed after that last fix: TypeScript scope,
  compiler, Biome, full tests, Chrome/Edge builds, manifests and ZIP validation.
- `bun audit`: no vulnerabilities found. `git diff --check`: clean.
- Independent review reproduced and fixed the progressive-snapshot false claim;
  missing/failed campaign details were checked to prevent a verified final
  snapshot from bypassing that guard.
- Final integrity re-review approved the failed-write/redelivery correction with
  no remaining blockers; its nine focused integrity cases passed.
- Chrome confirmed the installed unpacked extension loads from this repository's
  `.output/chrome-mv3`. The native automation surface then became unavailable
  (stale menu state and no screenshot) before reload could be confirmed. The
  packaged fix is verified; live recovery with the new build is not yet verified.
  Reload DropHunter in `chrome://extensions`, then reload the Twitch inventory
  page so its content script also uses the new build. No stored reward was
  manually marked claimed during diagnosis.

## Updated engineering score

**64/100 before the overall checkup → 91/100 with this follow-up.** This is a
review rubric, not measured uptime. The previous 88/100 assessment missed these
runtime cases and was insufficient evidence of native-reward compatibility.

| Area | Before /20 | After /20 |
| --- | ---: | ---: |
| Startup and recovery | 10 | 19 |
| Concurrency and cancellation | 9 | 18 |
| Notifications | 12 | 18 |
| Campaign/data compatibility | 17 | 19 |
| Verification and release readiness | 16 | 17 |

Live payload reproduction improves confidence, but a successful reload on the
affected account and the two-hour farming soak remain outstanding validation.

No test result promises universal Twitch availability, uninterrupted credit, or
exactly-once notification delivery across a worker crash. The initial report's
notification and long-run soak limits still apply.
