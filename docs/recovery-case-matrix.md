# Recovery and Update Matrix

Current farming contract. It supersedes older expectations about an indefinite initial gesture, a second tab, tabless→tab fallback, rollback, and stopping for sign-in. Historical implementation notes and manual browser observations live in git history.

| Scenario | Expected result | Automated coverage |
| --- | --- | --- |
| Real progress increasing | Keep the channel, resolve the episode | farming-cycle-contract, drops-projection-semantics |
| Healthy video/heartbeat without progress | Refresh before the stall, proportional 5–20 minute window | farming-cycle-contract, native-reward-stall-recovery, strict-stall-refresh |
| Player still loading after 30 seconds | Keep channel and tab; campaign progress renews the 5–20 minute window, ownership errors stay unknown | managed-watch-cold-loading, automatic-pending-playback |
| Verified loading expiry | Suspend the candidate, clear Switching, try the next streamer, keep real failures | managed-watch-cold-loading, automatic-pending-playback |
| Queued Play and Twitch channel change | Internal navigation in the same tab/document; the URL alone does not confirm the new player, header/category and advancement are required | managed-watch-internal-navigation, content-internal-navigation, queue-campaign-handoff E2E |
| Drops sync finishes while the watch is publishing | Updated sync state and timestamps do not cancel the ready candidate; keep current sync data and the latest successful refresh | farming-campaign-handoff, queue-campaign-handoff E2E |
| Manual navigation in the owned tab | Recover the same-origin token to reuse the tab; cleanup keeps exact guards | managed-watch-internal-navigation, managed-watch-stale-cleanup |
| Reused video with reset time | Previous advancement does not confirm the new source | managed-playback-suspension |
| Chrome synchronously rejects alwaysOnTop | Monitor uses the focused-only fallback without failing to open | tab-management-window, monitor-dashboard |
| Mixed failures | Reservation persisted before preparation, at most four distinct names | farming-cycle-contract, playback-start-retry-budget, streamer-transport-failure |
| Offline player, even with a residual viewer count | Two consecutive reads; beats inactive playback and the stall deadline | watch-transport, content-script-modules, offline-farming-recovery |
| Five consecutive offline switches after three real errors | Remove only the offline reservation before searching; keep errors, campaign and tab | offline-farming-recovery |
| Last streamer offline, no verified alternative | Park the campaign and continue the queue; a directory error stays unknown availability | offline-farming-recovery, farming-cycle-contract, e2e/queue-campaign-handoff.spec.ts |
| One to three failed streamers or fewer than four alternatives | Recovery and retry continue; no campaign-stuck warning or Telegram/browser alert | campaign-failure-alert-threshold, farming-automation-notifications, queue-availability-resume |
| Fourth distinct streamer failed | One failure episode, a persistent warning, deliveries deduplicated per destination | campaign-failure-alert-threshold, farming-cycle-contract |
| All rewards 100% claimable, account not linked | Leaves the farming queue; the unacquired target stays for claim/link checks; the next campaign continues | claim-pending-queue-continuation |
| Only rewards to claim, including after restart | Watch time complete / link account; no streamer acquisition, scheduled inventory retry | claim-pending-queue-continuation |
| Candidate moves from 90% to 100% during refresh | Publish complete proof, keep the incumbent player, no candidate preparation | claim-pending-queue-continuation |
| Managed navigation slow, failed or superseded | Popup and monitor show Switching to; no previous reward shown as running; atomic commit or suspended recovery | queued-managed-campaign-handoff, watch-transport-cancellation, watch-transport-replacement, e2e/queue-campaign-handoff.spec.ts |
| Automatic Drops refresh shared, cancelled or expired | Close only the created page after the last consumer; keep explicit/existing pages, user navigation, sign-in and single-tab windows | drops-page-cleanup, drops-page-refresh |
| Pending state restored after worker restart | No imagined navigation; transient target null, real attempts kept | app-state-sync, state-persistence-session |
| Fewer than four channels | No repeated names, move to the next campaign | farming-cycle-contract, queue-acquisition-round |
| Last unresolved target failed | Persisted warning, suspended transport, real retry in ten minutes | farming-cycle-contract, queue-acquisition-round |
| Early retry / no selection | Reopen round and budget, respect verified HTTP cooldown | manual-farming-retry |
| Play from any state | Persist intent, wake monitoring, keep the previous campaign queued | queued-campaign-start, farming-session-revision |
| Missing/partial snapshot, future reward, failed claim | Target kept, no invented acquisition | farming-cycle-contract, claimable-queue-eligibility, native-reward-stall-recovery |
| All acquired, expired or mixed | Stop only when every target is terminal | farming-cycle-contract, session-lifecycle-summary-precedence |
| Expired campaign filtered from candidates | Keep the valid expiry before filtering | games-cache-orchestration, service-worker |
| Pause/Stop with pending operations | No late navigation, promotion, heartbeat or claim | managed-watch-pending-navigation, farming-session-revision, watch-transport-races |
| Managed switch / uncertain ownership | Same proved ID; no duplicate on uncertain proof | single-managed-watch-tab, managed-watch-preflight-retry |
| Historical ID reused after restart | Search all proofs before deciding; reuse the single proved tab, uncertainty forbids creation | managed-watch-preflight-recovery |
| Tab proof temporarily unavailable | Return the reservation and keep persisted retries without spending four channels | watch-preparation-budget, managed-watch-preflight-retry |
| Favorite preemption during preparation or failure | Same coordinator as Play, pending published before navigation; retained player suspended, no stale healthy state | managed-watch-startup-integration |
| Old cleanup after a newer navigation | Recheck token, URL, window and last tab before the serialized mutation; never closes or neutralizes the new watch | managed-watch-stale-cleanup |
| Old premature alert already delivered | First verified exhaustion creates a new identity, then deduplicates browser and Telegram | campaign-failure-alert-threshold |
| Tabless / mode change | No viewing fallback, suspend the previous player first | farming-cycle-contract, watch-transport-handoff |
| Browser restart / recycle | Browser restart clears operational warnings; recycle keeps windows and budget | farming-cycle-contract, worker-recycle-progress, crash-recovery |
| Late sign-in / Stop | Scheduled recovery; Stop beats late sign-in | afk-auth-recovery, queue-auth-recovery-persistence |
| Repeated warnings and broken notifications | One episode, independent receipts, farming not blocked | farming-cycle-contract, automation-event-notifier, claim-log |
| API/integrity/claim response from the old account | Recreates no proof or backoff and unlocks no new claims | session-account-evidence |
| Monitor, × or Drops warning during persistence | Does not cancel the valid watch, keeps the updated presentation | farming-campaign-transition |
| Play interrupts a healthy channel on the fourth attempt | Resume the suspended attempt, no fifth name | farming-cycle-contract |
| Pending claim during Pause/Play | Discard the stale outcome; the next batch stays runnable | session-account-evidence |
| Popup messages | Expansion, × and dismissal persist across popup close and worker recycle | e2e/farming-messages.spec.ts |
| Tabless heartbeat service unavailable | Global recovery, no warning attributed to channels; observation time suspended | farming-cycle-contract, streamer-transport-failure |
| Tabless response restored, even degraded | Resume time from the suspended point without an immediate stall | farming-cycle-contract |
| Publication cancelled by concurrent state | Neither parks nor spends the channel; wakes the same alarm after the owning tick, unless blocked or in cooldown | farming-campaign-handoff |
| Playback timeout with late response | The attempt stays spent; no late promotion | farming-campaign-handoff |
| Restore with failed probe or Stop during probe | Immediately keep dormant ownership and suspend the proved tab | watch-transport-handoff |
| Restore with persisted Pause/Stop | Suspend the browser-restored player, no new playback | watch-transport-handoff |
| Pause/Stop after a user-restarted failed candidate | Recover the current tab proof and suspend the player, even without a published watch | managed-watch-candidate-preservation, e2e/queue-campaign-handoff.spec.ts |
| Stop superseded during reconstruction or mutation queue | Does not overwrite the registry or suspend the new navigation | managed-watch-pending-navigation |
| Stop while observing the Twitch control or pending play | Also suspends player intent, disables keepalive and prevents late native retries | managed-playback-suspension |
| Stop/Play during async policy, self-heal or legacy open | Recheck the revision before preparing, navigating or publishing; no late PREPARE | playback-orchestrator, playback-self-heal-cancellation, tab-management-tabs |
| Stop during persistence or first-tab marker | Complete only its own tab proof, suspend it and return a cancelled candidate | managed-watch-initial-cancellation |

Names refer to files in `tests/`. `e2e/queue-campaign-handoff.spec.ts` uses MV3 listeners and real local videos for same-tab switching, initial gesture, Pause/Stop, recycle, browser restart, blocked rounds and shutdown. Progress and claims come from the fixture: they are simulated Twitch responses.

## Not verified on real Twitch

Fixtures validate logic but do not certify AFK farming on the live service. Still unverified on the current build: fresh-install bootstrap/sign-in, real sleep/wake, full acquisition of every reward, real browser/Telegram delivery, and tabless progress when the Twitch heartbeat endpoint is unreachable. Restart and worker recycle are covered automatically with simulated Twitch.
