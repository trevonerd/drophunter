# Agent Notes

Fast path for future agents working on DropHunter. Keep this file human-readable and update it only when workflow, architecture, or domain rules change. `AGENTS.md` is the compressed prompt copy; edit this source first, then recompress.

## Project
- WXT Chrome/Edge MV3 extension using React 19, TypeScript, Tailwind CSS, Bun.
- Package manager: Bun only. Use `bun install`, `bun test`, `bun run build:all`.
- Main code: `src/background/`, `src/popup/`, `src/monitor/`, `src/content/`, `src/shared/`.
- Entrypoints live in `src/entrypoints/`: background service worker, popup HTML, monitor HTML, Twitch content scripts, and integrity interceptor.
- Generated builds and release zips live under `.output/`; do not hand-edit generated files.

## Architecture Map
- `src/background/service-worker.ts` wires controllers, runtime messages, alarms, lifecycle, tab orchestration, Twitch API calls, cache refresh delegation, and persistence. Farming session behavior should go through `src/background/farming-session.ts`; games-cache refresh orchestration should go through `src/background/games-cache-orchestration.ts`.
- Extracted background modules take `ServiceWorkerState` and mutate that passed state object. Prefer adding behavior to focused modules before growing `service-worker.ts`.
- `src/background/farming-session.ts` exports `createFarmingSession`, the facade that composes the farming-session interface (start/stop/pause/resume, monitoring ticks, streamer acquisition, queue advancement, recovery orchestration) from `farming-session-context.ts`, `farming-session-handlers.ts`, `farming-session-monitoring.ts`, `farming-session-queue.ts`, and `farming-session-streaming.ts`, which hold the actual logic. Wire consumers through this facade rather than importing its implementation modules directly.
- `src/background/drops-projection.ts` owns Drops snapshot projection: campaign-aware drop matching, game completion annotation, selected-game drop splitting, monotonic progress preservation, and progress-recovery proof.
- `src/background/runtime-state.ts` owns `ServiceWorkerState`, `createServiceWorkerState()`, timing normalization, crash/startup resume policy, and rotation metadata clearing.
- `src/background/state-persistence.ts` is the storage boundary for `appState`, drops snapshot cache, timing state, activity timestamps, badge updates, and state broadcasts.
- `src/background/farming-recovery-alarm.ts` reconciles the dedicated retry alarm; `manual-farming-retry.ts` implements the popup's deduplicated Retry action without overriding Twitch cooldown. `src/shared/recovery-presentation.ts` derives phase, operation, reason, deadline, and action from persisted state; `src/shared/user-status.ts` uses it for popup and monitor.
- `src/background/automation-event-notifier.ts` owns notification-event deduplication, per-channel receipts, and isolated browser/Telegram delivery. Channel adapters only deliver; routine recovery retries stay silent.
- `src/background/farming-automation-manual-watch.ts` owns serialized manual-view evaluation. Its pure decision step derives the durable manual-watch fact; the controller alone performs observation, persistence, deadline replacement, and transport suspension/resume effects.
- `src/background/queue-operations.ts` owns campaign-aware queue identity and pure mutators (`normalizeQueueSelection`, `removeGameFromQueue`, `resolveGameFromState`, `pushGameToQueue`, `reorderQueue`, plus shared helpers `queueContainsGame`, `queueEntryMatchesGame`, `removeQueueEntriesForGame`, `promoteQueueHead`, `removeQueueEntriesForHeadGame`). It is a DAG leaf: no imports from drops-projection, stream-rotation, or state-persistence.
- `src/background/recovery-state.ts` owns recovery-backoff and terminal stop-state mutators (`clearRecoveryState`, `clearStopState`, `applyRecoveryState`, `clearNoStreamersRecoveryState`, `applyNoStreamersRecoveryState`, `applyStopState`, `enterPersistentRecovery`). It is a DAG leaf: no imports from drops-projection, queue-operations, or state-persistence.
- `src/background/streamer-acquisition.ts` owns streamer acquisition, rotation policy, and best-streamer selection (`acquireStreamerForSelectedGame`, `rotateStreamer`, `rotateStreamerIfInvalid`, `openBestStreamerForSelectedGame`, plus internal `shouldKeepStreamerWhileDropProgresses`, `OpenBestStreamerCallbacks`). Shared campaign eligibility, language fallback, and direct authorized-channel verification live in `eligible-streamer-discovery.ts`. It is a DAG leaf: no imports from drops-projection, queue-operations, or state-persistence.
- `src/background/drops-tick.ts` is a stable re-export barrel over the per-tick drop-progress and queue-mutation handlers (`checkDropProgress`, `refreshDropsData`, `handleSetSelectedGame`, `handleAddToQueue`, `handleRemoveFromQueue`, `handleReorderQueue`) plus their `*Callbacks`/`*Deps` interfaces; the actual logic lives in `drops-tick-monitoring.ts`, `drops-tick-queue.ts`, `drops-tick-refresh.ts`, `drops-tick-selection.ts`. None of them hold state of their own — they run against `ServiceWorkerState` with injected callbacks.
- `src/background/session-lifecycle.ts` is a re-export barrel over farming session lifecycle transitions (`stopFarmingSession`, `advanceQueueIfCompleted`, `skipCurrentGameAndAdvanceQueue`, `skipCurrentGameDueToStall`, `handleStartFarming`, `resetStreamTrackingState`) plus the `QueueSkipReason` type and `queueSkipCopy` helper; the actual logic lives in `session-lifecycle-queue.ts`, `session-lifecycle-start.ts`, `session-lifecycle-stop.ts`, `session-lifecycle-transition.ts`, `session-lifecycle-types.ts`. They coordinate with drops-tick, queue-operations, recovery-state, and streamer-acquisition via state plus injected callbacks.
- `src/background/games-cache-orchestration.ts` owns Twitch games-cache refresh orchestration (`refreshGamesCacheFromHiddenFetch`, `handleEnsureGamesCache`) plus `GamesCacheRefreshDeps`/`EnsureGamesCacheDeps`/`RefreshGamesCacheOptions` interfaces. Stateless+deps pattern — free functions taking explicit `ServiceWorkerState` and dep callbacks, with no shared mutable state.
- `src/background/watch-candidate-preparation.ts` owns the shared prepare/validate/dispose contract for playback candidates. `watch-transport-coordinator.ts` promotes a viable candidate before releasing the active transport; `watch-transport-transition.ts` uses the same contract for farming-automation transactions. Failed or superseded candidates must not replace a working watch.
- `src/background/drops-page-refresh.ts`, `api-operations.ts`, `session-management.ts`, and `twitch-api/` own Twitch session, inventory, campaign, integrity, and hidden refresh flows.
- `src/content/` inspects Twitch pages and prepares playback; keep DOM parsing defensive because Twitch markup changes often.
- `src/popup/` is user control UI; hooks own app state, settings toggles, onboarding, recovery clocks, and Drops refresh state. `components/main-view-model.ts` owns campaign, queue, startup, and transient-activity projection for `MainView`. Settings keep farming scope, watch source, and notifications visible; secondary controls live in the native Advanced disclosure.
- `src/monitor/` is the compact live status window. Keep status semantics aligned with popup runtime status helpers.
- `src/shared/` contains contracts used across extension contexts: runtime messages, game/campaign identity, app state normalization, browser API wrapper, and drop helpers. `src/shared/user-status.ts` is the single user-facing session-status model for popup and monitor; keep recovery copy concise and keep retry counters out of UI surfaces.

## Domain Rules
- Twitch campaigns are not plain games. Prefer `campaignId` identity whenever available.
- Use `src/shared/game-selection.ts`: `gameIdentity`, `isSameGameIdentity`, `gameKey`, `getGameDisplayLabel`.
- Dropdown, queue, start, remove, and completion flows must not key only by `game.id`; duplicate campaigns can share game-ish IDs.
- Real campaign titles should display as `Game · Campaign Title`, even when only one campaign exists for that game.
- Queue order matters. Removing, clearing, completing, expiring, or skipping a campaign must preserve selected campaign semantics and advance only for real terminal/completed/expired states.
- Event-based drops are not farmable watch-time rewards. Do not treat them as pending watch progress.
- Twitch data can vanish, be stale, have missing fields, or arrive with duplicate benefit IDs. Keep parsing tolerant and progress merging conservative.
- Progress can come from inventory, campaign pages, hidden refresh, content inspection, or cached state. Prefer preserving higher/claimed progress over replacing with weaker data.

## Runtime And Recovery Rules
- MV3 service workers restart often. Persist durable state, restore timing state, and avoid relying on in-memory variables surviving.
- `PROGRESS_POLL_MS` must stay compatible with Chrome alarm minimums. Chrome alarms enforce a 0.5 minute minimum; keep alarm period at or above that floor.
- Crash/restart handling depends on `lastHeartbeatAt`, `CRASH_DETECTION_THRESHOLD_MS`, and `resumedFromCrash`. Resume sessions that were active when the browser stopped; the retired `autoResumeOnStartup` preference must not block recovery. Cover changes with crash/recovery tests.
- Never infer a browser restart from a stale heartbeat alone: Chrome may recycle an MV3 worker between progress alarms. `chrome.storage.session` survives recycling but clears on browser restart or extension update. Preserve active farming across both paths, including after the first nonzero progress update.
- Manual **Pause** preserves the authorized queue and session position in `AppState`; playback and monitoring stay stopped until an explicit Resume or Start. Manual **Stop** persists `lastStopReason === 'user-stop'`, ends the session, and clears manual queue authorization until an explicit Start. Explicitly enabling favorite auto-start may clear either block; merely adding a favorite must not restart farming. Browser recovery never overrides Pause or Stop.
- `resumedFromCrash` is transient UI state. Clear it lazily through normal ticks/save paths rather than adding timer-only cleanup paths.
- Recovery should prefer self-heal/backoff/rotation before terminal stop. Terminal stops are for real end states like manual stop, queue complete, no active campaigns, or sign-in required.
- Keep Twitch directory/API failures separate from local watch-transport failures. A successful directory lookup followed by failed playback must not consume API backoff or reset the Twitch session. Bound candidate attempts and recovery cycles; park a failed campaign and continue eligible queued campaigns, then recheck at a spaced deadline.
- A recovery countdown must correspond to a scheduled alarm and an actual attempt. Reconcile alarms after worker restart and sleep/wake; do not block farming monitoring behind campaign synchronization. Deduplicate popup Retry, alarms, and periodic ticks. Never describe a due but unstarted attempt as “retrying.”
- Storage upgrades must preserve queue authorization, campaign identity/order, preferences, progress evidence, Pause, and manual Stop while rebuilding volatile retry, sync, acquisition, transport, and integrity state. Make migrations repeatable after interrupted writes. Apply defensive normalization on same-version load too; repair contradictory but valid historical campaign summaries rather than deleting campaigns. A failed scheduler write may not prevent all future checks.
- Bound legacy API/recovery deadlines on load. A longer `Retry-After` may survive worker restart only with recent persisted proof that it came from an HTTP response; cap even verified values to one day. Never use a timestamp alone as evidence of a valid rate limit.
- For recovery changes, consult `docs/recovery-case-matrix.md` and add focused regression tests for HTTP→directory→playback, migration/restart, alarm delivery, Stop/Pause races, and inaccessible storage. Keep diagnostics allowlisted and local; never include tokens or raw Twitch responses.
- Do not close the only tab in a Chrome window when releasing a managed tab. Preserve user browser windows.
- Inactivity reset is long-horizon cleanup. Preserve lifetime stats and user preferences while clearing volatile farming/session/timing data.

## Privacy And Session Rules
- DropHunter stores operational state locally. Do not add analytics, remote logging, or developer-owned backend calls. Optional Telegram alerts use the user's bot and chat after explicit configuration and optional host permission.
- Twitch session credentials are read from the user's browser context only to call Twitch endpoints. Never send them anywhere except Twitch.
- No `cookies` permission and no `chrome.cookies` fallback. Session recovery uses Twitch page storage, content-script extraction, open Twitch tabs, and integrity interceptor data.
- Keep `notifications` optional. Request/use it only through the existing user-facing setting flow.
- Required host permissions remain Twitch-only; Telegram uses optional `api.telegram.org` access. Never include Twitch credentials in alerts.
- Portable backup must follow [docs/backup-format.md](docs/backup-format.md): use a DropHunter-owned format identifier, independently versioned sections, and an explicit field allowlist. Export only settings, favorites, hidden games, statistics, and claim log; exclude credentials, sessions, campaign/progress state, queue authorization, runtime state, and transport data. Treat backup JSON as untrusted input and enforce the 10 MiB limit.
- Backup evolution must retain published fixtures and pure migrations. Optional additions keep the section version; absent fields preserve local values or fresh-install defaults. Surface ignored data and unavailable sections before import. Incompatible representation changes require a tested migration or an explicit preview error and release note; reserve root version changes for radical envelope changes. Merge adds channel-point totals and deduplicates history before retention, flooring the drop count at the local total. Replace only selected present sections. Imports require Stop, disable favorite auto-start, and require explicit reactivation of restored notifications; never import authorization or override Pause.

## Runtime Message Rules
- Runtime message changes must update all contracts together: `RUNTIME_MESSAGE_TYPES`, `RuntimeRequest`, `RuntimeResponseByType`, payload validation, background router handling, and tests.
- Homogeneous message clusters (uniform request+response shape) use the table-driven pattern in `src/shared/messages.ts` (see `BOOLEAN_TOGGLE_MESSAGES`, `NO_PAYLOAD_MINIMAL_RESPONSE_MESSAGES`) instead of literal arms; heterogeneous clusters stay literal until a per-type response-shape table is designed.
- Validate payloads before invoking handlers. Critical actions should fail closed on malformed input.
- Responses should include useful `error` text when user actions fail. Do not swallow clear/remove/start failures silently.
- After state-changing handlers, persist state and broadcast updates unless the local pattern explicitly delegates that work.

## Popup And UI Rules
- Popup must stay campaign-aware. Use shared identity helpers for select options, queue chips, start/remove flows, and display labels.
- User-facing async failures should surface in popup state. Do not leave the UI stuck loading or silently unchanged.
- Queue/status feedback should be screen-reader friendly. Use `role="status"` and `aria-live="polite"` for non-modal status messages.
- Loading fallback timers are secondary; prefer clearing loading from real background broadcasts/responses.
- Preserve existing visual language. This is an extension popup/control surface, not a marketing page.

## Background Edit Rules
- Keep `service-worker.ts` as orchestration glue. Put domain logic in focused modules where a matching module exists.
- New mutable service-worker state belongs in `ServiceWorkerState` and `createServiceWorkerState()`.
- Extracted functions should receive `state` and dependencies explicitly, matching existing controller/module patterns.
- When changing persistence or timing fields, update load/save normalization, default state factory, and round-trip tests.
- When changing queue semantics, check start, pause/resume, skip, complete, expired/vanished, and selected-game behavior.
- When changing Twitch API parsing, prefer explicit guards and typed normalization helpers over trusting nested fields.

## Common Change Recipes
- New popup setting: add state default/type, storage normalization, runtime message contract, background handler, hook/UI toggle, and source tests. Declare portability, default, sensitivity, and missing-field/import behavior in the backup contract; portable fields must join the modular registry without breaking published fixtures.
- Backup format changes: update [docs/backup-format.md](docs/backup-format.md) and this file first, then keep `AGENTS.md` compressed copy aligned. Keep migrations pure and covered by permanent historical fixtures.
- New background action: add runtime message contract, payload validator, router handler, state persistence/broadcast behavior, and failure response tests.
- New campaign identity behavior: update shared helper first, then queue, popup selector/chips, drop matching, and campaign label tests.
- New recovery behavior: update runtime status helpers if user-visible, timing persistence if durable, monitor/popup display, and soak-test notes if manual QA changes.
- New Twitch API field: normalize in `twitch-api/parsing.ts` or nearby parser, keep raw response optional, add null/missing/wrong-shape tests.
- New release behavior: update `scripts/release-check.mjs`, docs/checklist when store handoff changes, and release-check UI tests if terminal output changes.

## Testing Matrix
- Queue/farming regressions: `tests/queue-management.test.ts`, `tests/queue-start.test.ts`, `tests/service-worker.test.ts`.
- Campaign identity and labels: `tests/replace-games.test.ts`, `tests/campaign-selection.test.ts`.
- Runtime persistence/recovery: `tests/runtime-state.test.ts`, `tests/state-persistence-session.test.ts`, `tests/crash-recovery.test.ts`, `tests/worker-recycle-progress.test.ts`.
- Manual-watch policy/controller: `tests/manual-watch-policy.test.ts`, `tests/farming-automation-manual-watch.test.ts`.
- Favorite preemption: `tests/farming-automation-preemption.test.ts`.
- Playback handoff: `tests/watch-transport-handoff.test.ts`.
- Messages/router contracts: `tests/messages.test.ts`, `tests/message-router.test.ts`.
- Twitch API/session/integrity parsing: `tests/client-parsing.test.ts`, `tests/integrity-token.test.ts`, `tests/session-management.test.ts`, `tests/api-operations.test.ts`.
- Popup source behavior: `tests/popup-source.test.ts`.
- Content/playback changes: `tests/content-script.test.ts`, `tests/content-app-state.test.ts`, `tests/playback-orchestrator.test.ts`.
- Browser extension E2E: `e2e/extension-controls.spec.ts` through `bun run test:e2e` after a real Chrome MV3 build.
- Release UI/check scripts: `tests/release-check-ui.test.ts`, `scripts/release-check.mjs`.

## Work Rules
- Preserve dirty worktree changes unless the user explicitly asks to revert.
- Use `rg` first for search.
- Edit manually with `apply_patch`; avoid unrelated refactors.
- Keep imports and exports type-safe. Type-only re-exports such as `export type { ServiceWorkerState }` are okay for backward compatibility and erase at runtime.
- Do not amend commits unless explicitly asked.
- Do not use destructive git commands unless the user explicitly asks and the risk is clear.
- Run the smallest relevant tests during development. `bun run test:types` and `bun run test:ts` are mandatory before handoff for every change; run the full release gate before release/store handoff.
- Use stable Bun 1.4.2 or newer; CI reads the pinned package-manager version from `package.json`.
- Commit subjects use short English Conventional Commits. Author and committer: `trevonerd <marco.trevisani81@gmail.com>`; preserve historical ImgBotApp attribution. No co-author or generated-by trailers.
- Repo skills are limited to review, debugging, TDD, code design, domain modeling, research, and merge conflicts. Keep their references valid; do not vendor a general skill catalog.
- Vexp indices and machine-specific tool configuration stay local and untracked. Use Vexp for orientation and `verify_done` for multi-file checks when available; native search is the fallback. RTK may summarize exploration output, but release validation must inspect full logs.

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
- Preferred release gate is `bun run release:check`; it runs source and test TypeScript, Biome, unit and browser E2E tests, dependency audit, build/package, and generated manifest/archive checks.
- Regenerate release zips with `bun run release:zip`; artifacts are `.output/drophunter-<version>-chrome.zip` and `.output/drophunter-<version>-edge.zip`.
- Before a stable store handoff, verify `README.md`, `PRIVACY.md`, screenshots, permission justifications, and listing copy against the exact production artifacts.
- For long-run farming changes, exercise a real eligible campaign across progress, service-worker restart, sleep/wake, hidden-to-managed fallback, manual Twitch viewing, notifications, and recovery.
- If touching video/promotional assets, also run `cd video && bun audit` and relevant `video:*` commands.

## Stability Hotspots
- Queue advancement, drop refresh, crash recovery, and session/integrity recovery are regression-prone. Add or update focused tests.
- Campaign labels and duplicate-game campaigns are regression-prone. Cover real campaign titles and duplicate IDs.
- MV3 lifecycle, alarms, and storage timing are subtle. Test restart/resume paths rather than assuming a live worker.
- Twitch DOM/API shape changes are normal. Keep code defensive and tests explicit about null, missing, duplicate, and stale data.
