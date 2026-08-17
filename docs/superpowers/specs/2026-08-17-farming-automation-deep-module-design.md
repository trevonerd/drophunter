# Farming automation deep module design

## Goal

Concentrate DropHunter's automatic campaign workflow behind one deep module with a small interface. The module must own the complete attempt from a browser or campaign trigger through refresh, discovery, ranking, manual-watch handling, queue policy, transactional Farming session transition, durable recovery, activity, notification, and next-check scheduling.

The design must improve locality without changing the user-facing policy established for favorite Twitch Drops campaigns, notifications, queue modes, or manual Twitch viewing.

## Confirmed decisions

- Farming automation owns the end-to-end automatic attempt. The service worker owns only lifecycle and message registration.
- Automatic preemption is transactional: candidate B cannot disturb incumbent Farming session A until B is viable and its transition commits successfully.
- In `priority-list-only`, Farming automation may add discovered favorite campaigns to the visible queue with `favorite-auto` provenance. `ending-soonest` and `lowest-availability` rank privately and never mutate the visible queue.
- Evaluations are single-flight. A trigger received during an active evaluation is assigned to exactly one trailing evaluation rather than the active result.
- Durable behavior is reconstructed from facts and deadlines. Workflow phases, locks, provisional handles, and trailing state remain ephemeral.
- Browser notification permission remains a prerequisite for automatic farming, as already documented in the popup and notification controller.
- A managed-tab preemption may briefly use a second inactive, muted managed farming tab so B can be verified while A remains active.

## Public interface

```ts
export type FarmingAutomationTrigger =
  | 'browser-start'
  | 'periodic'
  | 'campaign-refresh'
  | 'user-request';

export type FarmingAutomationUnchangedReason =
  | 'disabled'
  | 'snoozed'
  | 'paused'
  | 'manual-watch-active'
  | 'already-farming-best-campaign'
  | 'no-eligible-campaign'
  | 'preemption-already-applied'
  | 'superseded-by-state-change';

export type FarmingAutomationFailureReason =
  | 'notifications-unavailable'
  | 'twitch-session-missing'
  | 'drops-refresh-failed'
  | 'candidate-preparation-failed'
  | 'transition-commit-failed'
  | 'persistence-failed';

export type FarmingAutomationOutcome =
  | {
      readonly kind: 'started';
      readonly campaignKey: string;
      readonly transition: 'start' | 'preemption';
    }
  | {
      readonly kind: 'unchanged';
      readonly reason: FarmingAutomationUnchangedReason;
    }
  | {
      readonly kind: 'failed';
      readonly reason: FarmingAutomationFailureReason;
      readonly retryAt?: number;
    };

export interface FarmingAutomation {
  request(trigger: FarmingAutomationTrigger): Promise<FarmingAutomationOutcome>;

  snooze(
    reason: 'manual-pause' | 'manual-stop',
  ): Promise<'snoozed' | 'persistence-failed'>;
}
```

The interface is the test surface. Callers do not pass candidates, ranking functions, queue modes, refresh flags, callbacks, clocks, or persistence operations.

`periodic`, `campaign-refresh`, and `user-request` retain provenance but do not select different policy. `browser-start` is the only trigger that clears a browser-session snooze.

Expected Chrome, Twitch, and persistence failures resolve to a typed outcome. Promise rejection is reserved for an implementation invariant violation or extension teardown.

## Module ownership

### Service worker

`src/background/service-worker.ts` remains the composition root. It creates one Farming automation instance per service-worker lifetime and maps existing callers to the public interface:

- browser startup calls `request('browser-start')`;
- the automation alarm calls `request('periodic')`;
- campaign and favorite changes call `request('campaign-refresh')`;
- the explicit runtime action calls `request('user-request')`;
- manual pause and stop persist `snooze(...)` before applying their Farming session action.

The service worker does not inspect automation settings, discover candidates, rank campaigns, classify manual watch, mutate automatic queue entries, implement retry, or compose automation notifications.

`snooze()` invalidates the active automation revision immediately, before awaiting session storage. A persistence failure cannot block the user's pause or stop action: the in-memory snooze remains effective for the current worker lifetime, the Farming session action proceeds, and the runtime response surfaces the persistence failure instead of reporting a false clean success.

### Farming automation

`src/background/farming-automation.ts` owns:

- gate evaluation;
- Drops snapshot refresh orchestration;
- favorite Twitch Drops campaign discovery;
- campaign-aware eligibility and identity;
- streamer availability lookup and caching policy;
- campaign priority and farm-category scope;
- `favorite-auto` queue reconciliation in `priority-list-only`;
- manual-watch observation, classification, and expiry;
- state revision checks and race handling;
- preemption eligibility and deduplication;
- transactional Farming session transition orchestration;
- durable fact normalization and recovery;
- activity construction and retention;
- automation notification construction and delivery ordering;
- next-check derivation and wake-up scheduling;
- single-flight and trailing evaluation semantics;
- mapping operational failures to stable outcomes.

Existing pure modules such as campaign priority and favorite discovery may remain as internal implementation modules. They are not exported as an alternative test surface and are not called directly by lifecycle or runtime-message callers.

### Farming session lifecycle

`src/background/session-lifecycle.ts` owns the transactional start or preemption operation used by Farming automation. Its implementation prepares and validates the candidate watch before committing the new Farming session.

The operation guarantees:

- an unsuccessful result leaves the selected campaign, current transport, managed farming tab, monitoring state, and queue head unchanged;
- visible queue reconciliation is not part of the Farming session transition;
- campaign identity is campaign-aware;
- repeated transition attempt identity is idempotent;
- a successful transition persists a receipt with the Farming session state.

The internal preparation handle and transport staging protocol are implementation details, not additions to the public Farming automation interface.

## Real seams and adapters

Only dependencies with production and deterministic test adapters receive explicit internal seams.

### Twitch adapter

The production adapter delegates Twitch session, campaign, inventory, directory, and stream-context access to the existing Twitch modules. The in-memory adapter provides normalized snapshots, eligible channels, controllable refresh barriers, stale data, missing sessions, and failures.

Farmability, favorite membership, ranking, and preemption remain in the Farming automation implementation rather than the Twitch adapter.

### Browser adapter

The production adapter groups the Chrome host capabilities that currently vary together: tab observation, optional notification permission, notification delivery, alarms, and managed-tab preparation. The in-memory adapter provides deterministic tabs, permissions, notifications, deadlines, and provisional watch outcomes.

Split this adapter only when an independently varying second adapter appears. Do not create separate hypothetical seams for ranking, manual-watch policy, activity copy, or alarm policy.

### Persistence adapter

The production adapter integrates `ServiceWorkerState` with Chrome local and session storage. The in-memory adapter retains data across module reconstruction and supports revision conflicts and injected commit failures.

The adapter persists data selected by the Farming automation implementation; it does not decide queue insertion, ranking, manual-watch classification, or retry.

### Farming session implementation

Primary behavior tests exercise the real in-process Farming session implementation over in-memory Twitch and browser adapters. A narrow contract test covers the transactional transition guarantee. Do not replace the whole Farming session with a permissive mock in the main Farming automation tests.

## Durable facts

Farming automation persists a versioned internal record separate from the UI-facing `AppState` projection:

```ts
interface FarmingAutomationFactsV1 {
  readonly version: 1;

  readonly lastPreemption:
    | {
        readonly attemptId: string;
        readonly fromCampaignKey: string;
        readonly toCampaignKey: string;
        readonly committedAt: number;
        readonly sessionRevision: string;
      }
    | null;

  readonly manualWatch:
    | {
        readonly kind: 'eligible-manual' | 'automation-paused';
        readonly observedAt: number;
        readonly expiresAt: number;
        readonly recheckAt: number;
      }
    | null;

  readonly nextEvaluationAt: number | null;
}
```

Browser-session snooze remains in session storage so it survives MV3 worker recycling but clears on a real browser restart. `browser-start` clears it explicitly before evaluating.

The UI continues to receive only the projections it needs, such as current manual-watch state, next automation check, and recent activity. Internal receipts, attempt identities, and workflow recovery facts do not widen the popup state contract.

Do not persist `idle`, `refreshing`, `ranking`, `preparing`, `committing`, `inFlight`, pending triggers, provisional tabs, or timers.

## Single-flight and trailing evaluation

- With no active evaluation, `request()` starts one and the caller receives its outcome.
- The first request received during an active evaluation creates one trailing evaluation.
- Further requests before that trailing evaluation begins share its promise.
- Requests received while the trailing evaluation is active may create one subsequent trailing evaluation.
- There is never more than one active evaluation and one pending evaluation.
- Trigger provenance is merged internally. A queued `browser-start` retains its snooze-clearing meaning.
- A relevant state revision change invalidates provisional work and requests a trailing evaluation.
- The active promise is never returned to a caller whose trigger requires the trailing evaluation.

The current behavior in which later triggers share the first in-flight result is removed.

## Transactional preemption

For incumbent Farming session A and candidate B:

1. Capture automation and Farming session revisions.
2. Refresh Twitch Drops data into provisional workflow state without changing A.
3. Reconcile visible queue additions independently and only for `priority-list-only`.
4. Rank candidates and observe manual watch.
5. Recheck revisions and all gates.
6. Acquire B's streamer and prepare its watch while A remains active.
7. For managed-tab transport, open B in a second inactive, muted tab. For tabless transport, prepare a separate provisional heartbeat session.
8. Verify that B remains farmable and its watch is viable.
9. Persist the new Farming session state, new managed-tab ownership, and transition receipt together.
10. Promote B and release A only after the persistence operation succeeds.
11. Persist the corresponding Farming automation preemption fact and activity.
12. Notify and reconcile the next wake-up as best-effort post-commit effects.

Any failure before step 9 disposes provisional resources and leaves A unchanged. A failure at step 9 also disposes B and leaves A unchanged.

If the worker stops after step 9 but before step 11, the next evaluation repairs the Farming automation facts from the transition receipt. It does not start B again. If obsolete A cleanup was interrupted, recovery closes only the tab that the receipt proves is no longer owned.

Chrome storage and tab operations do not provide a literal ACID transaction. The design provides semantic atomicity through preparation, one durable commit point, idempotent transition identity, and receipt-based reconciliation.

## Evaluation ordering

Each evaluation owns this ordering:

1. Load and normalize durable facts.
2. Apply trigger semantics.
3. Expire stale manual-watch observations from their deadline.
4. Apply cheap gates: enabled, notification permission, Twitch session, snooze, and pause.
5. Refresh the Drops snapshot without modifying the Farming session.
6. Discover eligible campaigns and streamer availability.
7. Reconcile visible queue additions only in `priority-list-only`.
8. Rank candidates privately for all modes.
9. Observe manual Twitch viewing and persist its expiry and recheck deadline.
10. Recheck state and session revisions.
11. Prepare and validate the candidate Farming session.
12. Recheck revisions immediately before commit.
13. Commit the transition and receipt.
14. Persist automation facts, activity, and next check.
15. Broadcast the resulting projection.
16. Deliver the notification and release obsolete resources as best-effort post-commit effects.

Callers cannot reorder or omit these steps.

## Queue semantics

- `priority-list-only` may persist new favorite campaigns in deadline order with `favorite-auto` metadata.
- Queue discovery continues during manual watch, but it never selects or starts a candidate while manual watch is active.
- `ending-soonest` and `lowest-availability` leave visible queue entries and metadata byte-for-byte unchanged.
- A candidate start failure does not remove an independently discovered `favorite-auto` queue entry.
- Manual queue entries retain their provenance and ordering.
- Automatic preemption never calls the manual start path that marks an entry as user-added.
- Unfavoriting a game continues to remove only automatic entries for that favorite category.

## Error handling and recovery

### Before commit

Twitch refresh, manual-watch observation, candidate preparation, and persistence errors return `failed`. A missing eligible candidate or a revision conflict caused by newer user state returns `unchanged`. Provisional resources are disposed and the incumbent Farming session remains unchanged in both cases.

### After commit

Notification delivery, activity presentation, obsolete-tab cleanup, or alarm scheduling failure cannot convert a successful Farming session transition into a failed transition. The public outcome remains `started`. These failures are recorded through existing local diagnostic mechanisms and repaired when durable facts permit.

The durable next-check timestamp remains the source of truth even when wake-up scheduling fails. Existing periodic lifecycle alarms provide a later reconciliation opportunity.

### Retry ownership

Farming automation derives, persists, and schedules retry deadlines. Callers do not implement retry loops or timers. A timer may optimize an awake worker, but it is never the source of truth.

`persistence-failed` describes a failure before the Farming session commit, including a failed durable snooze. Persistence or cleanup failure after a successful session commit cannot rewrite the outcome to `failed`; the transition receipt remains the recovery source.

## Test strategy

### Behavior tests through the public interface

- `request('periodic')` starts the highest-ranked eligible campaign and resolves only after persistence.
- A campaign refresh received during an active evaluation executes in exactly one trailing evaluation.
- A trigger received during that trailing evaluation produces at most one subsequent evaluation.
- Concurrent callers assigned to the same trailing evaluation receive the same trailing outcome.
- A manual start, pause, stop, or settings change during refresh wins through revision invalidation.
- Failure at every candidate preparation and commit stage preserves A, its managed farming tab, monitoring, and selected campaign.
- Successful preemption persists B and its transition receipt before releasing A.
- Reconstruction after the post-commit crash window repairs the preemption fact without starting B again.
- A repeated attempt identity is idempotent.
- `priority-list-only` adds favorite campaigns during manual watch without selecting them.
- `ending-soonest` and `lowest-availability` never mutate the visible queue.
- Manual-watch observation and deadlines survive module reconstruction and expire deterministically.
- Browser-session snooze survives worker recycling and clears only on `browser-start`.
- Revoked notification permission disables Farming automation and returns the stable failure reason.
- Notification failure after commit leaves B running and returns `started`.
- Duplicate game IDs with distinct campaign IDs remain distinct throughout discovery, queueing, and preemption.
- Invalid persisted facts are normalized fail-closed without persisting an opaque workflow phase.

### Adapter contract tests

- Persistence round-trip preserves versioned facts and session-scoped snooze.
- Persistence rejects a stale revision without partial mutation.
- The Farming session transition leaves incumbent state unchanged on every unsuccessful result.
- A successful transition persists its receipt with the new session state.
- Repeating the same attempt identity is idempotent.
- Browser wake-up replacement uses the durable deadline.
- Notification delivery and manual-watch observations are deterministic in the in-memory adapter.

### Wiring tests

Service-worker tests verify only that browser startup, periodic alarms, campaign changes, explicit runtime evaluation, pause, and stop map to the correct public operation. They do not duplicate policy tests.

### Test replacement

Once equivalent behavior exists through the deep module interface, narrow tests for the old coordinator and extracted orchestration helpers are removed rather than layered underneath the new tests. Pure domain helpers retain direct tests only where they remain independently reused outside Farming automation.

### Manual QA

- Start A and cause an earlier favorite campaign B to preempt it. Observe B's provisional managed farming tab remain inactive and muted, then A close only after B is viable.
- Make B unavailable during preparation. Confirm its provisional tab closes and A continues without state, progress, or queue disruption.
- Exercise tabless preemption and confirm no managed tab appears unless fallback is required.
- Recycle the service worker during refresh and confirm one later evaluation reconstructs from facts.
- Recycle the service worker after B commits but before post-commit effects. Confirm B is not started again and obsolete A cleanup is reconciled safely.
- Begin manual Twitch viewing while evaluation is active. Confirm manual viewing wins and automation resumes from the persisted deadline.

## Migration sequence

1. Add normalized durable facts and transition receipt persistence with round-trip and migration tests.
2. Add deterministic browser, Twitch, persistence, and clock adapters used by the new test rig.
3. Add the public Farming automation interface and single-flight/trailing evaluation shell.
4. Move gating, refresh, discovery, ranking, queue policy, manual-watch handling, activity, and retry behind the module.
5. Add transactional Farming session transition and provisional transport staging.
6. Route browser startup and the automation alarm through `request()`.
7. Route campaign, favorite, explicit evaluation, pause, and stop callers through `request()` and `snooze()`.
8. Verify all interface behavior, adapter contracts, service-worker wiring, and manual preemption scenarios.
9. Remove the old coordinator interface, callback assembly, in-memory preemption set, timer source of truth, and superseded tests.
10. Run the full release gate and long-run farming QA checklist before release handoff.

Each step must leave the repository buildable and preserve existing user-facing behavior.

## Scope boundaries

- No new user preference or popup control.
- No change to notification permission requirements.
- No change to existing campaign priority modes.
- No concurrent farming of multiple Twitch channels.
- No remote logging, analytics, or new backend.
- No public ranking preview or diagnostics interface.
- No caller-provided candidate, refresh option, ranking function, or persistence callback.
- No persistence of workflow phases, locks, timers, or provisional handles.
- No weakening of campaign-aware identity or reward-acquisition semantics from ADR-0001.

## Acceptance criteria

- Lifecycle and runtime callers use only `request()` and `snooze()`.
- The service worker no longer owns automatic discovery, ranking, manual-watch, notification, retry, or preemption policy.
- A failed automatic candidate cannot stop, select over, navigate, mute, close, or otherwise disturb the incumbent Farming session.
- Successful preemption survives every MV3 restart window without duplicate start.
- Queue mutation remains mode-correct and provenance-aware.
- Every behavior-relevant deadline and preemption fact is durable; every lock and workflow phase is ephemeral.
- Expected external failures return stable outcomes and never become unhandled rejections.
- Tests exercise the public interface and real Farming session implementation over deterministic external adapters.
- Obsolete shallow interfaces and duplicate orchestration tests are removed after replacement coverage exists.
