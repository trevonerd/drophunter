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
- `src/background/farming-session.ts` owns farming session interface: start/stop/pause/resume, monitoring ticks, streamer acquisition, queue advancement, recovery orchestration.
- `src/background/drops-projection.ts` owns Drops snapshot projection: campaign-aware drop matching, game completion annotation, selected-game drop splitting, monotonic progress preservation, progress-recovery proof.
- `src/background/runtime-state.ts` owns `ServiceWorkerState`, `createServiceWorkerState()`, timing normalization, crash/startup resume policy, rotation metadata clearing.
- `src/background/state-persistence.ts` = storage boundary for `appState`, snapshot cache, timing state, activity timestamps, badge updates, state broadcasts.
- `src/background/queue-operations.ts` owns campaign-aware queue identity + pure mutators (`normalizeQueueSelection`, `removeGameFromQueue`, `resolveGameFromState`, `pushGameToQueue`, `reorderQueue`, plus shared helpers `queueContainsGame`, `queueEntryMatchesGame`, `removeQueueEntriesForGame`, `promoteQueueHead`, `removeQueueEntriesForHeadGame`). DAG leaf — no imports from drops-projection, stream-rotation, state-persistence.
- `src/background/recovery-state.ts` owns recovery-backoff + terminal stop-state mutators (`clearRecoveryState`, `clearStopState`, `applyRecoveryState`, `clearNoStreamersRecoveryState`, `applyNoStreamersRecoveryState`, `applyStopState`, `enterPersistentRecovery`). DAG leaf — no imports from drops-projection, queue-operations, state-persistence.
- `src/background/streamer-acquisition.ts` owns streamer acquisition, rotation policy, and best-streamer selection (`acquireStreamerForSelectedGame`, `rotateStreamer`, `rotateStreamerIfInvalid`, `openBestStreamerForSelectedGame`, plus internal `shouldKeepStreamerWhileDropProgresses`, `filterStreamersByAllowedChannels`, `OpenBestStreamerCallbacks`). DAG leaf — no imports from drops-projection, queue-operations, state-persistence.
- `src/background/drops-tick.ts` owns the per-tick drop-progress + queue-mutation handlers (`checkDropProgress`, `refreshDropsData`, `handleSetSelectedGame`, `handleAddToQueue`, `handleRemoveFromQueue`, `handleReorderQueue`) plus their `*Callbacks`/`*Deps` interfaces. Holds no state of its own — runs against `ServiceWorkerState` + injected callbacks.
- `src/background/session-lifecycle.ts` owns farming session lifecycle transitions (`stopFarmingSession`, `advanceQueueIfCompleted`, `skipCurrentGameAndAdvanceQueue`, `skipCurrentGameDueToStall`, `handleStartFarming`, `resetStreamTrackingState`) plus the `QueueSkipReason` type and `queueSkipCopy` helper. Coordinates with drops-tick, queue-operations, recovery-state, streamer-acquisition via state + injected callbacks.
- `src/background/games-cache-orchestration.ts` owns Twitch games-cache refresh orchestration (`refreshGamesCacheFromHiddenFetch`, `handleEnsureGamesCache`) plus `GamesCacheRefreshDeps`/`EnsureGamesCacheDeps`/`RefreshGamesCacheOptions` interfaces. Stateless+deps pattern — free functions taking explicit `ServiceWorkerState` + dep callbacks, no shared mutable state.
- `src/background/drops-page-refresh.ts`, `api-operations.ts`, `session-management.ts`, `twitch-api/` own Twitch session, inventory, campaign, integrity, hidden refresh flows.
- `src/content/` inspects Twitch pages, prepares playback; keep DOM parsing defensive—Twitch markup changes often.
- `src/popup/` = user control UI; hooks own app state, settings toggles, onboarding, recovery clocks, Drops refresh state.
- `src/monitor/` = compact live status window. Keep status semantics aligned with popup runtime status helpers.
- `src/shared/` = contracts across extension contexts: runtime messages, game/campaign identity, app state normalization, runtime status, browser API wrapper, drop helpers.

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
- MV3 service workers restart often. Persist durable state, restore timing state; don't rely on in-memory vars surviving.
- `PROGRESS_POLL_MS` must stay ≥ Chrome alarm minimum (0.5 min floor).
- Crash/restart depends on `lastHeartbeatAt`, `CRASH_DETECTION_THRESHOLD_MS`, `autoResumeOnStartup`, `resumedFromCrash`. Cover changes with crash/recovery tests.
- `resumedFromCrash` = transient UI state. Clear lazily via normal ticks/save paths, not timer-only cleanup.
- Recovery: prefer self-heal/backoff/rotation before terminal stop. Terminal stops = manual stop/queue complete/no active campaigns/sign-in required.
- Don't close only tab in Chrome window when releasing managed tab. Preserve user windows.
- Inactivity reset = long-horizon cleanup. Preserve lifetime stats/preferences; clear volatile farming/session/timing data.

## Privacy And Session Rules
- DropHunter = local-only. No analytics, remote logging, dev-owned backend calls.
- Twitch session credentials: read from user's browser context only to call Twitch endpoints. Never send elsewhere.
- No `cookies` permission, no `chrome.cookies` fallback. Session recovery uses Twitch page storage, content-script extraction, open Twitch tabs, integrity interceptor data.
- Keep `notifications` optional. Request/use only via existing user-facing setting flow.
- Host permissions Twitch-only unless scope explicitly changes.

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
- New popup setting: add state default/type, storage normalization, runtime message contract, background handler, hook/UI toggle, source tests.
- New background action: add runtime message contract, payload validator, router handler, state persistence/broadcast behavior, failure response tests.
- New campaign identity behavior: update shared helper first, then queue, popup selector/chips, drop matching, campaign label tests.
- New recovery behavior: update runtime status helpers if user-visible, timing persistence if durable, monitor/popup display, soak-test notes if manual QA changes.
- New Twitch API field: normalize in `twitch-api/parsing.ts` or nearby parser, keep raw response optional, add null/missing/wrong-shape tests.
- New release behavior: update `scripts/release-check.mjs`, docs/checklist when store handoff changes, release-check UI tests if terminal output changes.

## Testing Matrix
- Queue/farming regressions: `tests/queue-management.test.ts`, `tests/queue-start.test.ts`, `tests/service-worker.test.ts`.
- Campaign identity/labels: `tests/replace-games.test.ts`, `tests/campaign-selection.test.ts`.
- Runtime persistence/recovery: `tests/runtime-state.test.ts`, `tests/state-persistence.test.ts`, `tests/crash-recovery.test.ts`.
- Messages/router contracts: `tests/messages.test.ts`, `tests/message-router.test.ts`.
- Twitch API/session/integrity parsing: `tests/client-parsing.test.ts`, `tests/integrity-token.test.ts`, `tests/session-management.test.ts`, `tests/api-operations.test.ts`.
- Popup source behavior: `tests/popup-source.test.ts`.
- Content/playback changes: `tests/content-script.test.ts`, `tests/content-app-state.test.ts`, `tests/playback-orchestrator.test.ts`.
- Release UI/check scripts: `tests/release-check-ui.test.ts`, `scripts/release-check.mjs`.

## Work Rules
- Preserve dirty worktree unless user asks to revert.
- Use `rg` first for search.
- Edit manually with `apply_patch`; avoid unrelated refactors.
- Keep imports/exports type-safe. Type-only re-exports like `export type { ServiceWorkerState }` OK for backward compat, erase at runtime.
- Don't amend commits unless asked.
- No destructive git commands unless explicitly asked + risk clear.
- Run smallest relevant tests during dev; full release gate before release/store handoff.

## Release And Store Handoff
- Before release/store handoff run:
  - `bun run test:ts`
  - `bun run lint`
  - `bun test tests/`
  - `bun run build:all`
  - `bun audit`
- Preferred release gate: `bun run release:check`; runs TypeScript, Biome, tests, build, generated manifest checks.
- Regenerate release zips with `bun run release:zip`; artifacts are `.output/drophunter-<version>-chrome.zip` and `.output/drophunter-<version>-edge.zip`.
- Store readiness: read `docs/chrome-web-store-checklist.md`.
- Long-run farming changes: use `docs/soak-test-checklist.md` for manual QA.
- Touching video/promotional assets: also run `cd video && bun audit` and relevant `video:*` commands.

## Stability Hotspots
- Queue advancement/drop refresh/crash recovery/session+integrity recovery: regression-prone. Add/update focused tests.
- Campaign labels/duplicate-game campaigns: regression-prone. Cover real campaign titles + duplicate IDs.
- MV3 lifecycle/alarms/storage timing: subtle. Test restart/resume paths, don't assume live worker.
- Twitch DOM/API shape changes normal. Keep code defensive, tests explicit about null/missing/duplicate/stale data.
