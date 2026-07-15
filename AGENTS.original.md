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
- `src/background/farming-session.ts` owns the farming session interface: start/stop/pause/resume, monitoring ticks, streamer acquisition, queue advancement, and recovery orchestration.
- `src/background/drops-projection.ts` owns Drops snapshot projection: campaign-aware drop matching, game completion annotation, selected-game drop splitting, monotonic progress preservation, and progress-recovery proof.
- `src/background/runtime-state.ts` owns `ServiceWorkerState`, `createServiceWorkerState()`, timing normalization, crash/startup resume policy, and rotation metadata clearing.
- `src/background/state-persistence.ts` is the storage boundary for `appState`, drops snapshot cache, timing state, activity timestamps, badge updates, and state broadcasts.
- `src/background/queue-operations.ts` owns campaign-aware queue identity and pure mutators (`normalizeQueueSelection`, `removeGameFromQueue`, `resolveGameFromState`, `pushGameToQueue`, `reorderQueue`, plus shared helpers `queueContainsGame`, `queueEntryMatchesGame`, `removeQueueEntriesForGame`, `promoteQueueHead`, `removeQueueEntriesForHeadGame`). It is a DAG leaf: no imports from drops-projection, stream-rotation, or state-persistence.
- `src/background/recovery-state.ts` owns recovery-backoff and terminal stop-state mutators (`clearRecoveryState`, `clearStopState`, `applyRecoveryState`, `clearNoStreamersRecoveryState`, `applyNoStreamersRecoveryState`, `applyStopState`, `enterPersistentRecovery`). It is a DAG leaf: no imports from drops-projection, queue-operations, or state-persistence.
- `src/background/streamer-acquisition.ts` owns streamer acquisition, rotation policy, and best-streamer selection (`acquireStreamerForSelectedGame`, `rotateStreamer`, `rotateStreamerIfInvalid`, `openBestStreamerForSelectedGame`, plus internal `shouldKeepStreamerWhileDropProgresses`, `filterStreamersByAllowedChannels`, `OpenBestStreamerCallbacks`). It is a DAG leaf: no imports from drops-projection, queue-operations, or state-persistence.
- `src/background/drops-tick.ts` owns the per-tick drop-progress and queue-mutation handlers (`checkDropProgress`, `refreshDropsData`, `handleSetSelectedGame`, `handleAddToQueue`, `handleRemoveFromQueue`, `handleReorderQueue`) plus their `*Callbacks`/`*Deps` interfaces. It holds no state of its own — it runs against `ServiceWorkerState` with injected callbacks.
- `src/background/session-lifecycle.ts` owns farming session lifecycle transitions (`stopFarmingSession`, `advanceQueueIfCompleted`, `skipCurrentGameAndAdvanceQueue`, `skipCurrentGameDueToStall`, `handleStartFarming`, `resetStreamTrackingState`) plus the `QueueSkipReason` type and `queueSkipCopy` helper. It coordinates with drops-tick, queue-operations, recovery-state, and streamer-acquisition via state plus injected callbacks.
- `src/background/games-cache-orchestration.ts` owns Twitch games-cache refresh orchestration (`refreshGamesCacheFromHiddenFetch`, `handleEnsureGamesCache`) plus `GamesCacheRefreshDeps`/`EnsureGamesCacheDeps`/`RefreshGamesCacheOptions` interfaces. Stateless+deps pattern — free functions taking explicit `ServiceWorkerState` and dep callbacks, with no shared mutable state.
- `src/background/drops-page-refresh.ts`, `api-operations.ts`, `session-management.ts`, and `twitch-api/` own Twitch session, inventory, campaign, integrity, and hidden refresh flows.
- `src/content/` inspects Twitch pages and prepares playback; keep DOM parsing defensive because Twitch markup changes often.
- `src/popup/` is user control UI; hooks own app state, settings toggles, onboarding, recovery clocks, and Drops refresh state.
- `src/monitor/` is the compact live status window. Keep status semantics aligned with popup runtime status helpers.
- `src/shared/` contains contracts used across extension contexts: runtime messages, game/campaign identity, app state normalization, runtime status, browser API wrapper, drop helpers.

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
- Crash/restart handling depends on `lastHeartbeatAt`, `CRASH_DETECTION_THRESHOLD_MS`, `autoResumeOnStartup`, and `resumedFromCrash`. Cover changes with crash/recovery tests.
- `resumedFromCrash` is transient UI state. Clear it lazily through normal ticks/save paths rather than adding timer-only cleanup paths.
- Recovery should prefer self-heal/backoff/rotation before terminal stop. Terminal stops are for real end states like manual stop, queue complete, no active campaigns, or sign-in required.
- Do not close the only tab in a Chrome window when releasing a managed tab. Preserve user browser windows.
- Inactivity reset is long-horizon cleanup. Preserve lifetime stats and user preferences while clearing volatile farming/session/timing data.

## Privacy And Session Rules
- DropHunter is local-only. Do not add analytics, remote logging, or developer-owned backend calls.
- Twitch session credentials are read from the user's browser context only to call Twitch endpoints. Never send them anywhere except Twitch.
- No `cookies` permission and no `chrome.cookies` fallback. Session recovery uses Twitch page storage, content-script extraction, open Twitch tabs, and integrity interceptor data.
- Keep `notifications` optional. Request/use it only through the existing user-facing setting flow.
- Keep host permissions Twitch-only unless product scope explicitly changes.

## Runtime Message Rules
- Runtime message changes must update all contracts together: `RUNTIME_MESSAGE_TYPES`, `RuntimeRequest`, `RuntimeResponseByType`, payload validation, background router handling, and tests.
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
- New popup setting: add state default/type, storage normalization, runtime message contract, background handler, hook/UI toggle, and source tests.
- New background action: add runtime message contract, payload validator, router handler, state persistence/broadcast behavior, and failure response tests.
- New campaign identity behavior: update shared helper first, then queue, popup selector/chips, drop matching, and campaign label tests.
- New recovery behavior: update runtime status helpers if user-visible, timing persistence if durable, monitor/popup display, and soak-test notes if manual QA changes.
- New Twitch API field: normalize in `twitch-api/parsing.ts` or nearby parser, keep raw response optional, add null/missing/wrong-shape tests.
- New release behavior: update `scripts/release-check.mjs`, docs/checklist when store handoff changes, and release-check UI tests if terminal output changes.

## Testing Matrix
- Queue/farming regressions: `tests/queue-management.test.ts`, `tests/queue-start.test.ts`, `tests/service-worker.test.ts`.
- Campaign identity and labels: `tests/replace-games.test.ts`, `tests/campaign-selection.test.ts`.
- Runtime persistence/recovery: `tests/runtime-state.test.ts`, `tests/state-persistence.test.ts`, `tests/crash-recovery.test.ts`.
- Messages/router contracts: `tests/messages.test.ts`, `tests/message-router.test.ts`.
- Twitch API/session/integrity parsing: `tests/client-parsing.test.ts`, `tests/integrity-token.test.ts`, `tests/session-management.test.ts`, `tests/api-operations.test.ts`.
- Popup source behavior: `tests/popup-source.test.ts`.
- Content/playback changes: `tests/content-script.test.ts`, `tests/content-app-state.test.ts`, `tests/playback-orchestrator.test.ts`.
- Release UI/check scripts: `tests/release-check-ui.test.ts`, `scripts/release-check.mjs`.

## Work Rules
- Preserve dirty worktree changes unless the user explicitly asks to revert.
- Use `rg` first for search.
- Edit manually with `apply_patch`; avoid unrelated refactors.
- Keep imports and exports type-safe. Type-only re-exports such as `export type { ServiceWorkerState }` are okay for backward compatibility and erase at runtime.
- Do not amend commits unless explicitly asked.
- Do not use destructive git commands unless the user explicitly asks and the risk is clear.
- Run the smallest relevant tests during development; run the full release gate before release/store handoff.

## Release And Store Handoff
- Before release/store handoff run:
  - `bun run test:ts`
  - `bun run lint`
  - `bun test tests/`
  - `bun run build:all`
  - `bun audit`
- Preferred release gate is `bun run release:check`; it runs TypeScript, Biome, tests, build, and generated manifest checks.
- Regenerate release zips with `bun run release:zip`; artifacts are `.output/drophunter-<version>-chrome.zip` and `.output/drophunter-<version>-edge.zip`.
- For store readiness, read `docs/chrome-web-store-checklist.md`.
- For long-run farming changes, use `docs/soak-test-checklist.md` as manual QA guidance.
- If touching video/promotional assets, also run `cd video && bun audit` and relevant `video:*` commands.

## Stability Hotspots
- Queue advancement, drop refresh, crash recovery, and session/integrity recovery are regression-prone. Add or update focused tests.
- Campaign labels and duplicate-game campaigns are regression-prone. Cover real campaign titles and duplicate IDs.
- MV3 lifecycle, alarms, and storage timing are subtle. Test restart/resume paths rather than assuming a live worker.
- Twitch DOM/API shape changes are normal. Keep code defensive and tests explicit about null, missing, duplicate, and stale data.
