# Agent Notes

Fast path for agents on DropHunter. `AGENTS.md` = compressed prompt copy. Edit `AGENTS.original.md` first, then recompress.

## Project
- WXT Chrome/Edge MV3 extension using React 19, TypeScript, Tailwind CSS, Bun.
- Package manager: Bun only. Use `bun install`, `bun test`, `bun run build:all`.
- Main code: `src/background/`, `src/popup/`, `src/monitor/`, `src/content/`, `src/shared/`.
- Entrypoints in `src/entrypoints/`: background service worker, popup HTML, monitor HTML, Twitch content scripts, integrity interceptor.
- Builds/zips in `.output/`; don't hand-edit generated files.

## Architecture Map
- `src/background/service-worker.ts` wires controllers, runtime messages, alarms, lifecycle, tab orchestration, Twitch API calls, cache refresh delegation, persistence. Farming session behavior goes through `src/background/farming-session.ts`; games-cache refresh orchestration goes through `src/background/games-cache-orchestration.ts`.
- Background modules take `ServiceWorkerState` and mutate it. Add behavior to focused modules before growing `service-worker.ts`.
- `src/background/farming-session.ts` exports `createFarmingSession`, composing start/stop/pause/resume, monitoring, acquisition, queue controls/progression, recovery. Wire consumers through this facade.
- Start Queue/queued Play persist manual intent + wake farming alarm only; no Twitch/discovery/playback in click handlers. Main monitor owns checks/retries. Play queues incumbent; failed requested campaign parks and follows normal queue order. Unavailable/scheduled initial starts retain authorization. Current cancelled preparation wakes the same alarm after its tick, without parking/budget use. Pause/Stop cancel; automatic queue progression is serialized.
- `src/background/farming-queue-progression.ts` binds deps once; owns selection, parking, rounds, waiting, persistence, completion through `advanceIfCompleted`, `skipCurrent`, `retryWaitingQueue`, synchronous `reconcileAvailability`. Focused logic: `session-lifecycle-queue*.ts`; execution contract internal. Automation supplies positive availability + rehabilitated campaign keys; reconciliation never starts playback. Acquisition never selects round heads independently.
- `src/background/farming-campaign-transition.ts` prepares/commits playback; managed changes reuse one owned tab and suppress stale active-channel projection. Verified unclaimed future watch-time rewards return `waiting`, stay queued for existing checks. Progression uses prepared transitions only; no refresh/boolean-open fallback.
- `src/background/drops-projection.ts` owns Drops snapshot projection: campaign-aware drop matching, game completion annotation, selected-game drop splitting, monotonic progress preservation, progress-recovery proof.
- `src/background/runtime-state.ts` owns `ServiceWorkerState`, `createServiceWorkerState()`, timing normalization, crash/startup resume policy, rotation metadata clearing.
- `src/background/state-persistence.ts` = storage boundary for `appState`, snapshot cache, timing state, activity timestamps, badge updates, state broadcasts.
- `src/background/farming-recovery-alarm.ts` reconciles the retry alarm; `manual-farming-retry.ts` handles popup Retry without bypassing Twitch cooldown. `src/shared/recovery-presentation.ts` derives phase/operation/reason/deadline/action from persisted state; `user-status.ts` shares it across popup/monitor.
- `src/background/automation-event-notifier.ts` owns notification-event deduplication, per-channel receipts, and isolated browser/Telegram delivery. Channel adapters only deliver; routine recovery retries stay silent.
- `src/background/farming-automation-manual-watch.ts` owns serialized manual-view evaluation: a pure decision derives durable facts; the controller performs observation, persistence, deadlines, and transport suspend/resume effects.
- `src/background/queue-operations.ts` owns campaign-aware queue identity + pure mutators (`normalizeQueueSelection`, `removeGameFromQueue`, `resolveGameFromState`, `pushGameToQueue`, `reorderQueue`, plus shared helpers `queueContainsGame`, `queueEntryMatchesGame`, `removeQueueEntriesForGame`, `promoteQueueHead`, `removeQueueEntriesForHeadGame`). DAG leaf — no imports from drops-projection, stream-rotation, state-persistence.
- `src/background/recovery-state.ts` owns recovery-backoff + terminal stop-state mutators (`clearRecoveryState`, `clearStopState`, `applyRecoveryState`, `clearNoStreamersRecoveryState`, `applyNoStreamersRecoveryState`, `applyStopState`). DAG leaf — no imports from drops-projection, queue-operations, state-persistence.
- `src/background/streamer-acquisition.ts` owns streamer acquisition, rotation policy, and best-streamer selection (`acquireStreamerForSelectedGame`, `rotateStreamer`, `rotateStreamerIfInvalid`, `openBestStreamerForSelectedGame`, plus internal `shouldKeepStreamerWhileDropProgresses`, `OpenBestStreamerCallbacks`). Shared eligibility, language fallback, direct channel verification: `eligible-streamer-discovery.ts`. DAG leaf — no imports from drops-projection, queue-operations, state-persistence.
- `src/background/drops-tick.ts` = re-export barrel over the per-tick drop-progress + queue-mutation handlers (`checkDropProgress`, `refreshDropsData`, `handleSetSelectedGame`, `handleAddToQueue`, `handleRemoveFromQueue`, `handleReorderQueue`) plus their `*Callbacks`/`*Deps` interfaces; real logic in `drops-tick-monitoring.ts`, `drops-tick-queue.ts`, `drops-tick-refresh.ts`, `drops-tick-selection.ts`. Hold no state of their own — run against `ServiceWorkerState` + injected callbacks.
- `src/background/session-lifecycle.ts` re-exports initial Start, Stop, tracking reset, `QueueSkipReason`; `queueSkipCopy` lives in focused Stop impl. Start and paused/stopped selection retain workspace/refresh deps; progression goes through bound module/farming facade.
- `src/background/games-cache-orchestration.ts` owns Twitch games-cache refresh orchestration (`refreshGamesCacheFromHiddenFetch`, `handleEnsureGamesCache`) plus `GamesCacheRefreshDeps`/`EnsureGamesCacheDeps`/`RefreshGamesCacheOptions` interfaces. Stateless+deps pattern — free functions taking explicit `ServiceWorkerState` + dep callbacks, no shared mutable state.
- `src/background/managed-watch-ownership.ts` owns managed farming tab acquisition/confirmation, finalization, startup reconstruction, retained-tab observation, and safe release. Candidate discard never rolls back reused-tab navigation and waits for pending proof. Acquisition, proof/navigation guards, and reconstruction remain internal; Chrome host adapts browser operations. Farming, automation, paused/stopped selection, startup, and manual-view observation use the seam. Preserve proof strengths, initial authorization, serialization, failure retention, sole-window protection, and storage keys. Playback/promotion stay in transports; read startup selection after proof recovery.
- `src/background/watch-candidate-preparation.ts` owns shared playback candidate prepare/validate/dispose. `watch-transport-coordinator.ts` promotes viable candidates before releasing the active transport; `watch-transport-transition.ts` uses the same contract for automation transactions. Failed/superseded candidates never replace a working watch.
- `src/background/drops-page-refresh.ts`, `api-operations.ts`, `session-management.ts`, `twitch-api/` own Twitch session, inventory, campaign, integrity, hidden refresh flows.
- `src/content/` inspects Twitch pages, prepares playback; keep DOM parsing defensive—Twitch markup changes often.
- `src/popup/` = user control UI; hooks own app state, settings toggles, onboarding, recovery clocks, Drops refresh state. `components/main-view-model.ts` owns `MainView` campaign/queue/startup/activity projection. Settings expose farming essentials first; secondary controls live in Advanced.
- `src/monitor/` = compact live status window. Keep status semantics aligned with popup runtime status helpers.
- `src/shared/` = cross-context contracts: runtime messages, game/campaign identity, state normalization, browser API wrapper, drop helpers. `src/shared/user-status.ts` is the single popup/monitor session-status model; recovery copy stays concise and UI omits retry counters.

## Domain Rules
- Twitch campaigns ≠ plain games. Prefer `campaignId` identity when available.
- Use `src/shared/game-selection.ts`: `gameIdentity`, `isSameGameIdentity`, `gameKey`, `getGameDisplayLabel`.
- Dropdown/queue/start/remove/completion flows must not key only by `game.id`; duplicate campaigns share game-ish IDs.
- Campaign titles display as `Game · Campaign Title` even with one campaign per game.
- Queue order matters. Remove/clear/complete/expire/skip must preserve selected campaign semantics; advance only for real terminal/completed/expired states.
- Event-based drops ≠ farmable watch-time rewards. Don't treat as pending watch progress.
- Twitch data can vanish, go stale, have missing fields, or arrive with duplicate benefit IDs. Keep parsing tolerant, progress merging conservative.
- Progress sources: inventory, campaign pages, hidden refresh, content inspection, cached state. Prefer higher/claimed progress over weaker data.

## Runtime And Recovery Rules
- Session targets survive missing candidates; explicit Remove/Clear/Stop retires them. Budget/observation/round deadlines survive worker recycle; a new browser session clears visible operational warnings and attempt state while retaining episode IDs, per-channel receipts, proofs and manual blocks. Operational metadata is local and excluded from portable backups.
- Managed farming reuses one proved tab; recreate only after verified absence. Pause/Stop/completion/tabless switching suspend its player and retain the tab; clear keepalive, pause proved playing control/native videos, cancel pending content retries. Tabless never falls back to a viewing tab. Old navigation cleanup cannot overwrite markers, roll back or pause a newer player.
- Reused Twitch pages use MAIN History router; preserve document/activation. Blank initial page uses browser navigation. Pending route waits for rendered channel header before category/playback proof. Same-origin user navigation retains token proof for acquisition only; cleanup keeps exact URL/token/window guards. Injection failure recovers, never creates a tab.
- Cold playback keeps reserved channel across 30s slices/restart; campaign-authoritative progress renews existing 5–20m observation. Unknown ownership/service preserves observation. Verified expiry spends failure and suspends candidate. Ready commit clears preparing metadata without self-invalidating fingerprint; video time reset clears old readiness proof.
- Unique settled proof permits reuse despite obsolete handles/remapped IDs; uncertainty forbids creation. Destructive cleanup rechecks token/URL/window/siblings inside mutation serialization. Automatic favorites share queued Play runtime preparation/publication; failed navigation suspends retained playback and stale healthy presentation.
- Unknown ownership/shared-service failures release guarded reservations before recovery persistence. Legacy unqualified episodes get fresh alert identity at first verified four-streamer exhaustion; qualified retries retain deduplication.
- Explicit offline beats inactive playback/stale viewer count. Confirm twice; remove only departing reservation, persist before same-campaign acquisition, exclude departing channel. Offline consumes no failure budget. Empty eligible alternatives park/follow queue; directory/API errors stay unknown.
- Campaign-stuck popup/browser/Telegram alerts require four distinct failed streamers. Fewer alternatives park silently; successful second attempt sends no exhaustion alert.
- Complete identified all-100%/claimable watch rewards leave farming queue, clear failure metadata, retain claim/link target without acquired proof. Sole pending target uses `rewards-pending`: watch-time complete UI, suspended player, scheduled inventory/claims. Publish fresh candidate completion before progression; partial/missing rewards prove nothing.
- Managed navigation publishes transient `pendingWatchTarget`, clears incumbent playback presentation; popup/monitor show pending campaign, suspend rewards. Commit campaign/streamer/rewards/ownership/health together. Restoration clears pending; late candidates cannot overwrite newer state.
- Automatic Drops sync may set `closeAfterRefresh`: close only operation-created page after last consumer, verify URL/navigation. Preserve existing/explicit/active/sign-in pages and sole-tab windows; new consumer during cleanup prevents removal.
- `DISMISS_FARMING_MESSAGE` hides only a recognized message ID and persists/broadcasts; warning history never determines the current campaign color. Notifications are independent and detached from queue progression.

- MV3 service workers restart often. Persist durable state, restore timing state; don't rely on in-memory vars surviving.
- `PROGRESS_POLL_MS` must stay ≥ Chrome alarm minimum (0.5 min floor).
- Crash/restart depends on `lastHeartbeatAt`, `CRASH_DETECTION_THRESHOLD_MS`, `resumedFromCrash`. Resume previously active sessions; retired `autoResumeOnStartup` never blocks recovery. Cover crash/recovery tests.
- Stale heartbeat alone is not browser restart. `chrome.storage.session` survives worker recycle and clears on browser restart/update. Preserve active farming across both paths; test first progress, worker recycle, browser restart.
- Manual **Pause** preserves authorized queue/position; playback and monitoring stop until explicit Resume/Start. Manual **Stop** persists `lastStopReason === 'user-stop'`, ends session, clears manual authorization until Start. Explicit favorite auto-start enable may clear either block; adding a favorite never restarts farming. Browser recovery never overrides Pause/Stop.
- `resumedFromCrash` = transient UI state. Clear lazily via normal ticks/save paths, not timer-only cleanup.
- Recovery: one four-distinct-streamer budget for playback failures/stalls; park failures and retry unresolved rounds after ten minutes. Automatic terminal stop requires every authorized target positively acquired or validly expired. Missing data, claim failure, nonautomatable rewards and sign-in remain nonterminal scheduled recovery.
- Separate Twitch API/directory errors from local playback failures. Playback failure must not cause API backoff/session reset. Bound candidate/cycle retries, park the failed campaign, continue eligible queue entries, and recheck later.
- Every recovery countdown needs a real alarm/attempt. Reconcile alarms after restart/sleep, keep farming ticks independent of campaign sync, deduplicate alarm/popup/heartbeat, and show “retrying” only after work starts.
- On update preserve preferences, progress evidence, campaign identity/order, queue authorization, Pause and manual Stop; rebuild volatile retry/sync/acquisition/transport/integrity state. Migration must survive interrupted writes; same-version load normalizes corrupt state. Repair historical summary/boolean contradictions without deleting campaigns. Scheduler failure cannot suppress future checks.
- Bound legacy API/recovery deadlines on load. Preserve longer `Retry-After` only with recent persisted HTTP proof; cap verified values at one day. A timestamp alone is not rate-limit proof.
- For recovery edits use `docs/recovery-case-matrix.md`; test HTTP→directory→playback, migration/restart, alarms, Stop/Pause races and storage failure. Diagnostics are local and allowlisted, never tokens/raw Twitch responses.
- Don't close only tab in Chrome window when releasing managed tab. Preserve user windows.
- Inactivity reset = long-horizon cleanup. Preserve lifetime stats/preferences; clear volatile farming/session/timing data.

## Privacy And Session Rules
- Operational state stays local. No analytics, remote logging, dev-owned backend calls. Optional Telegram alerts use user's bot/chat after configuration and optional host permission.
- Twitch session credentials: read from user's browser context only to call Twitch endpoints. Never send elsewhere.
- No `cookies` permission, no `chrome.cookies` fallback. Session recovery uses Twitch page storage, content-script extraction, open Twitch tabs, integrity interceptor data.
- Keep `notifications` optional. Request/use only via existing user-facing setting flow.
- Required hosts Twitch-only; Telegram uses optional `api.telegram.org`. Never include Twitch credentials in alerts.
- Portable JSON backup follows [docs/backup-format.md](docs/backup-format.md): DropHunter format ID, root + independent section versions, strict allowlist for settings/favorites/hidden/history/statistics, max 10 MiB. Exclude secrets/session/runtime/campaign progress. Unknown data is ignored and surfaced; incompatible root rejects, incompatible sections skip. Keep migrations pure with permanent historical fixtures. Merge adds channel-point totals and unions distinct history (drop total floored by local count, history capped at 5,000); replacement affects selected present sections. Favorite auto-start turns off after every import; desktop notifications turn off when backup settings apply. Import requires farming stopped and never resumes Pause.
- Backup evolution: optional additions keep section versions; missing fields preserve local/default values. Incompatible changes need tested migrations or explicit preview errors + release notes. Root version bumps only for radical envelope changes; retain all published fixtures.

## Runtime Message Rules
- Runtime message changes must update all contracts: `RUNTIME_MESSAGE_TYPES`, `RuntimeRequest`, `RuntimeResponseByType`, payload validation, background router handling, tests.
- Homogeneous message clusters (uniform request+response shape) use the table-driven pattern in `src/shared/messages.ts` (see `BOOLEAN_TOGGLE_MESSAGES`, `NO_PAYLOAD_MINIMAL_RESPONSE_MESSAGES`) instead of literal arms; heterogeneous clusters stay literal until a per-type response-shape table is designed.
- Validate payloads before invoking handlers. Critical actions fail closed on malformed input.
- Responses include useful `error` text on failure. Don't swallow clear/remove/start failures.
- After state-changing handlers, persist + broadcast unless local pattern delegates.

## Popup And UI Rules
- Popup must stay campaign-aware. Use shared identity helpers for select options, queue chips, start/remove flows, display labels.
- Async failures surface in popup state. Don't leave UI stuck loading or silently unchanged.
- Queue/status feedback screen-reader friendly. Use `role="status"` and `aria-live="polite"` for non-modal status.
- Loading fallback timers secondary; prefer clearing from real background broadcasts/responses.
- Preserve visual language. Extension popup/control surface, not marketing page.

## Background Edit Rules
- `service-worker.ts` = orchestration glue. Domain logic goes in focused modules.
- New mutable state goes in `ServiceWorkerState` and `createServiceWorkerState()`.
- Extracted functions receive `state` + deps explicitly, matching controller/module patterns.
- Changing persistence/timing fields: update load/save normalization, default state factory, round-trip tests.
- Changing queue semantics: check start/pause/resume/skip/complete/expired/vanished/selected-game behavior.
- Twitch API parsing: prefer explicit guards + typed normalization helpers over trusting nested fields.

## Common Change Recipes
- New popup setting: add default/type, storage normalization, messages, handler, hook/UI, tests; declare backup portability/default/sensitivity/import behavior. Add portable fields to the registry and preserve published fixtures.
- Backup format changes: document field portability/default/sensitivity/import behavior in [docs/backup-format.md](docs/backup-format.md); update `AGENTS.original.md` first, then this compressed copy.
- New background action: add runtime message contract, payload validator, router handler, state persistence/broadcast behavior, failure response tests.
- New campaign identity behavior: update shared helper first, then queue, popup selector/chips, drop matching, campaign label tests.
- New recovery behavior: update runtime status helpers if user-visible, timing persistence if durable, monitor/popup display, soak-test notes if manual QA changes.
- New Twitch API field: normalize in `twitch-api/parsing.ts` or nearby parser, keep raw response optional, add null/missing/wrong-shape tests.
- New release behavior: update `scripts/release-check.mjs`, docs/checklist when store handoff changes, release-check UI tests if terminal output changes.

## Testing Matrix
- Queue/farming regressions: `tests/queue-management.test.ts`, `tests/queue-start.test.ts`, `tests/service-worker.test.ts`.
- Progression/scheduled transitions: `tests/farming-queue-progression.test.ts`, `tests/farming-queue-scheduled-successor.test.ts`, `tests/queue-acquisition-round.test.ts`, `tests/queue-availability-resume.test.ts`, `tests/v4-queue-continuation.test.ts`, `tests/queue-advancement-cancellation.test.ts`, `tests/farming-campaign-handoff.test.ts`.
- Campaign identity/labels: `tests/replace-games.test.ts`, `tests/campaign-selection.test.ts`.
- Runtime persistence/recovery: `tests/runtime-state.test.ts`, `tests/state-persistence-session.test.ts`, `tests/crash-recovery.test.ts`, `tests/worker-recycle-progress.test.ts`.
- Manual-watch policy/controller: `tests/manual-watch-policy.test.ts`, `tests/farming-automation-manual-watch.test.ts`.
- Favorite preemption: `tests/farming-automation-preemption.test.ts`.
- Playback handoff: `tests/watch-transport-handoff.test.ts`.
- Managed tab ownership: `tests/managed-watch-ownership.test.ts`, `tests/tab-management-tabs.test.ts`, `tests/managed-watch-durable-ownership.test.ts`, `tests/managed-watch-provisional-recovery.test.ts`, `tests/managed-watch-startup-integration.test.ts`, `tests/managed-watch-candidate-preservation.test.ts`, `tests/retained-managed-manual-watch.test.ts`.
- Messages/router contracts: `tests/messages.test.ts`, `tests/message-router.test.ts`.
- Twitch API/session/integrity parsing: `tests/client-parsing.test.ts`, `tests/integrity-token.test.ts`, `tests/session-management.test.ts`, `tests/api-operations.test.ts`.
- Popup source behavior: `tests/popup-source.test.ts`.
- Content/playback changes: `tests/content-script.test.ts`, `tests/content-app-state.test.ts`, `tests/playback-orchestrator.test.ts`.
- Browser extension E2E: `e2e/extension-controls.spec.ts` via `bun run test:e2e` after a real Chrome MV3 build.
- Release UI/check scripts: `tests/release-check-ui.test.ts`, `scripts/release-check.mjs`.

## Work Rules
- Preserve dirty worktree unless user asks to revert.
- Use `rg` first for search.
- Edit manually with `apply_patch`; avoid unrelated refactors.
- Keep imports/exports type-safe. Type-only re-exports like `export type { ServiceWorkerState }` OK for backward compat, erase at runtime.
- Don't amend commits unless asked.
- No destructive git commands unless explicitly asked + risk clear.
- Run smallest relevant tests during dev. `bun run test:types` and `bun run test:ts` are mandatory before handoff; run the full release gate before release/store handoff.
- Stable Bun ≥1.4.2; CI reads pinned package-manager version from `package.json`.
- Short English Conventional Commits; author/committer `trevonerd <marco.trevisani81@gmail.com>`. Preserve historical ImgBotApp attribution. No co-author/generated-by trailers.
- Keep only review/debugging/TDD/code design/domain/research/conflict skills; maintain valid references.
- Vexp indices/machine configs stay local, untracked. Use orientation + `verify_done` when available, native search fallback. RTK exploration summaries OK; inspect full release logs.

## Release And Store Handoff
- Treat `4.0.0-beta.N` as GitHub/local-only builds. The manifest uses technical version `3.99.0.N` plus visible `version_name`; never upload these betas to browser stores.
- Reserve manifest/tag/release version `4.0.0` for the first stable 4.x store submission.
- Before release/store handoff run:
  - `bun run test:types`
  - `bun run test:ts`
  - `bun run lint`
  - `bun test tests/`
  - `bun run test:e2e`
  - `bun run build:all`
  - `bun audit`
- Preferred release gate: `bun run release:check`; runs source and test TypeScript, Biome, unit and browser E2E tests, dependency audit, build/package, and generated manifest/archive checks.
- Regenerate release zips with `bun run release:zip`; artifacts are `.output/drophunter-<version>-chrome.zip` and `.output/drophunter-<version>-edge.zip`.
- Stable store handoff: verify `README.md`, `PRIVACY.md`, screenshots, permission justifications, listing copy against exact production artifacts.
- Long-run farming changes: exercise real eligible campaign progress, worker restart, sleep/wake, strict tabless recovery without viewing-tab fallback, manual viewing, notifications, recovery.
- Touching video/promotional assets: also run `cd video && bun audit` and relevant `video:*` commands.

## Stability Hotspots
- Queue advancement/drop refresh/crash recovery/session+integrity recovery: regression-prone. Add/update focused tests.
- Campaign labels/duplicate-game campaigns: regression-prone. Cover real campaign titles + duplicate IDs.
- MV3 lifecycle/alarms/storage timing: subtle. Test restart/resume paths, don't assume live worker.
- Twitch DOM/API shape changes normal. Keep code defensive, tests explicit about null/missing/duplicate/stale data.


## vexp - Context-Aware AI Coding <!-- vexp v3.3.0 -->

### Context strategy: call run_pipeline ONCE at task start
If the task already names the files/symbols to touch, SKIP vexp. Otherwise one
`run_pipeline({ "task": "..." })` returns ranked pivot files with line ranges and
blast radius. Do NOT open files one by one to find your way around - every extra
tool call costs a turn. Call it again ONLY when the task moves to a new area.
`get_skeleton` for files to understand, not edit. `verify_done` before calling a
multi-file task complete, then RUN the tests it names.

### Query shape (do this)
Anchor the task on real identifiers (ClassName, functionName) or file paths:
`run_pipeline({ "task": "fix JWT expiry in AuthService.validateToken" })`

vexp runs entirely on this machine, index in `.vexp/`;
`run_pipeline` transmits nothing to any external service.
On `status: "degraded"` or 0 pivots the index is still building - use your own tools.
For literal string sweeps use your native search - do NOT route text sweeps through vexp.
Repo SOURCE only: logs, dist/, node_modules/ and files outside the repo are NOT indexed.
<!-- /vexp -->
