# Storage Schema Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make extension upgrades discard stale Twitch authentication/runtime caches while preserving user statistics, preferences, credentials, onboarding state, queue, and selected campaign.

**Architecture:** Add an idempotent storage-migration boundary that runs before persisted state is hydrated. The first schema migration removes Twitch-derived session and volatile cache keys from the storage areas where they may exist, records the new schema version only after every cleanup succeeds, and leaves durable user-owned data untouched. Future releases bump the schema only when their persisted representation or invalidation policy changes; ordinary extension version bumps do not rerun migrations.

**Tech Stack:** WXT MV3, TypeScript, Bun test, Chrome storage API.

---

### Task 1: Lock down the upgrade behavior

**Files:**
- Create: `src/background/storage-migrations.ts`
- Create: `tests/storage-migrations.test.ts`

- [ ] **Step 1: Write a failing test at the storage migration seam**

Seed an unversioned installation with `appState`, statistics, settings, queue, onboarding, Telegram credentials, `twitchSession`, `twitchIntegrity`, drops snapshot, timing state, and legacy authentication keys in both `storage.local` and `storage.sync`. Assert that migration preserves durable user data and removes only authentication/runtime cache data.

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test tests/storage-migrations.test.ts`

Expected: FAIL because the migration module does not exist.

- [ ] **Step 3: Implement the minimal migration**

Add `STORAGE_SCHEMA_VERSION`, a dedicated schema-version key, explicit local/session/sync key lists, and `migrateExtensionStorage()`. Treat absent, invalid, or older schema values as version zero, apply the first migration, and record the target version.

- [ ] **Step 4: Run the test and verify it passes**

Run: `bun test tests/storage-migrations.test.ts`

Expected: PASS.

### Task 2: Make migrations idempotent and retryable

**Files:**
- Modify: `tests/storage-migrations.test.ts`
- Modify: `src/background/storage-migrations.ts`

- [ ] **Step 1: Write a failing cleanup-failure test**

Make one storage removal reject and assert the schema version is not advanced and `appState` remains byte-for-byte unchanged.

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test tests/storage-migrations.test.ts`

Expected: FAIL until version persistence is correctly ordered.

- [ ] **Step 3: Implement the version guard**

Persist the new version only after all removals succeed so a partially applied migration is safely retried.

- [ ] **Step 4: Run the test and verify it passes**

Run: `bun test tests/storage-migrations.test.ts`

Expected: PASS.

- [ ] **Step 5: Add the current-schema idempotence test**

Seed current-schema storage containing a valid session and assert a second migration run performs no removals or writes and changes nothing.

- [ ] **Step 6: Run the test and verify it passes**

Run: `bun test tests/storage-migrations.test.ts`

Expected: PASS using the version guard implemented in Task 1.

### Task 3: Run migration before hydration and fail closed

**Files:**
- Modify: `src/background/service-worker.ts`
- Modify: `src/background/message-router.ts`
- Modify: `tests/service-worker.test.ts`
- Modify: `tests/message-router.test.ts`
- Modify: `tests/extension-lifecycle.test.ts`
- Modify: `tests/crash-recovery.test.ts`

- [ ] **Step 1: Extend the upgrade regression test**

Add lifecycle/order coverage proving migration completes before `loadState`, startup-resume policy, and update transitions run. Add router- and lifecycle-wide initialization gates and tests proving a pending migration delays `SYNC_TWITCH_INTEGRITY`, settings messages, alarms, and tab/window callbacks. Add rejection tests proving migration failure returns an error or logs the lifecycle failure without invoking any handler or persisting default state.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `bun test tests/message-router.test.ts tests/extension-lifecycle.test.ts tests/crash-recovery.test.ts tests/service-worker.test.ts`

Expected: FAIL because initialization currently hydrates storage before migration and router/lifecycle callbacks are not uniformly gated.

- [ ] **Step 3: Wire migration and invalidate memory**

Chain `migrateExtensionStorage()` before `loadState()` in service-worker initialization and retain a rejected initialization promise after logging rather than converting it to success. Add a single `beforeHandle` gate to the runtime router so every valid message awaits successful initialization. Make every lifecycle callback await the same initialization promise before invoking alarms, tab/window handlers, or update handling. This prevents authentication recovery or integrity sync from racing migration cleanup.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run: `bun test tests/storage-migrations.test.ts tests/message-router.test.ts tests/extension-lifecycle.test.ts tests/crash-recovery.test.ts tests/service-worker.test.ts`

Expected: PASS.

### Task 4: Verify authentication and repository health

**Files:**
- Test: `tests/session-management.test.ts`
- Test: `tests/session-orchestrator.test.ts`
- Test: `tests/state-persistence.test.ts`

- [ ] **Step 1: Run the relevant regression suite**

Run: `bun test tests/storage-migrations.test.ts tests/session-management.test.ts tests/session-orchestrator.test.ts tests/state-persistence.test.ts tests/service-worker.test.ts`

Expected: PASS.

- [ ] **Step 2: Run static verification**

Run: `bun run test:ts && bun run lint`

Expected: PASS.
