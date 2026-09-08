# Recovery after prolonged browser absence

Implementation and verification record for the approved recovery and queue-cleanup plan.

## Reproduced observation

On 7 September 2026, the installed `4.0.0-beta.14` in Chrome's Work profile showed
the same failure as the user report: two saved queue entries, zero campaigns,
and “Campaign update will retry automatically.” without a recovery action.
The installed unpacked extension points to `.output/chrome-mv3`.
This observation does not prove that the OAuth token expired.

## Failure paths addressed

| Case | Required behavior and implementation |
| --- | --- |
| Browser reopened after days or weeks | Preserve queue, origin metadata, preferences, stall evidence and campaign recovery state; clear obsolete transport ownership. Startup resume preference still controls manual continuation. |
| Storage temporarily unavailable | Do not claim that inactivity cleanup was persisted or broadcast a successful reset. Preserve the pre-reset state. |
| Interrupted campaign refresh | Persist attempt count and deadline; reconstruct the actual retry alarm after worker restart. |
| Temporary Twitch failure | Distinguish authentication, integrity, network, rate limits and unusable responses. A generic 403 is not proof of expired OAuth. |
| GraphQL authentication error with HTTP 200 | Recognize explicit Unauthorized/invalid OAuth evidence; retain ordinary service errors as operational failures. |
| Recovered credentials for another account | Validate the returned account identity before accepting or persisting the recovered session. |
| Existing/restored Twitch tabs | Attempt local recovery, allowing restored tabs time to become usable. |
| No usable Twitch tab | Use one inactive, owned temporary Drops tab; preserve user focus and tabs. |
| Late recovery result | Check operation/session ownership before publication; discard stale recovered credentials without deleting a newer session. |
| Cancelled extension-update resume | Guard preflight, requested-campaign revalidation and streamer acquisition; a late managed-tab candidate is released without publishing obsolete streamer or health state. |
| Missing campaign-verification field | Treat the snapshot as cached; it cannot clear a terminal summary or a persistent stall block. |
| Expired queued campaign | Remove only the matching campaign, preserving other queue entries and game favorites. |
| Missing campaign in partial data | Preserve it. Only a complete verified snapshot can prove disappearance. |
| Current campaign removed | Release its transport and continue only authorized work. An automatic favorite does not authorize a manual queue tail. |
| Notification delivery failure | Queue cleanup and farming proceed. Removal activity remains visible locally. |

## Verification status

The final `bun run release:check` passed on 7 September 2026 at approximately
15:53 CEST, after the cancellation and manual-start integration fixes: TypeScript
scope, TypeScript, Biome, the full test suite, Chrome/Edge builds and packages,
and generated manifest/archive validation. Earlier integration failures were
resolved before this gate. Artifacts remain `4.0.0-beta.14`.

Gate log: `.omo/evidence/v4-automation/recovery-release-check.log`.

| Artifact | SHA-256 |
| --- | --- |
| `.output/drophunter-4.0.0-beta.14-chrome.zip` | `1ac5a7be22789157f29415ad44ef8336423ee58bbc4abb90baed539dcbcd4b37` |
| `.output/drophunter-4.0.0-beta.14-edge.zip` | `20abd3f2af8ca371bd83302f8024c952adace52f30d519a5ca0db4e8e3927325` |

Main and video dependency audits on 7 September 2026 reported no vulnerabilities.

Live Work-profile inspection reproduced the old passive retry message. After
upgrading, both saved manual queue entries remained, cached campaigns were
marked pending validation, and Retry/Open Twitch Drops remained available after
repeated failures. Opening Drops showed an authenticated Twitch campaign list.
The extension logged an Inventory GraphQL `service error`; no observed evidence
established expired authentication. The Inventory request was subsequently
corrected to include `fetchRewardCampaigns: false`, with outgoing-request
regression coverage. Its live effect still requires verification.

Live validation is currently **environment/browser unavailable**: concurrent
use of Chrome repeatedly interrupted native UI control. The user has been asked
when Work can be left available briefly. No unrelated user tabs were changed.
The two-hour timer has not started, and opening an authenticated Drops page is
not counted as proof of working farming.

The optional local `vexp.verify_done` cross-check timed out without a daemon
response. This is recorded separately from the successful compiler, lint,
test and release checks.

Deferred-operation regressions cover cancellation during workspace preparation,
refresh and managed-tab opening, campaign removal during preflight, and cached
reward projection for the refreshed selection. Manual Start retains its original
selection-before-refresh behavior; the full service-worker and auto-claim
integration cases were rerun after correcting that ordering.

Cleanup: the test-owned in-app fixture tab was closed and its server on port
4179 stopped. Chrome Work test tabs remain available for the pending live check.

The authenticated two-hour run has **not yet passed**. Work is the user-selected
Chrome profile. Record exact build, campaign, progress, worker restart, timestamps
and outcomes here after the run; do not infer live success from fixtures.

Stable versioning and store publication remain gated by the release and soak
checklists. No stable-release claim is made by this report.
