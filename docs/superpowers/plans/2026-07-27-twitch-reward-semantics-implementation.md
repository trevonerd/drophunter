# Twitch reward semantics implementation plan

> Approved design: [Twitch reward semantics and farming completion](../specs/2026-07-27-twitch-reward-semantics-design.md)

## Goal

Make subscription-gated rewards and Twitch-native badge/emote rewards truthful and non-blocking without weakening the meaning of the existing green completed state.

At the end of this plan:

- a new badge or emote at 0% is an ordinary farmable reward;
- strict Twitch award evidence can mark a Twitch-native reward verified and acquired;
- exhausted recovery can mark only the affected Twitch-native reward unverifiable while preserving its reported percentage;
- campaigns with no automatable reward left become `farming-complete`, remain inspectable, and cannot trap Start or the queue;
- subscription and unverifiable remainders have distinct restrained indicators;
- `allDropsCompleted` remains true only for `all-acquired` campaigns.

## Architecture constraints

- Keep raw Twitch-shape interpretation in `src/background/twitch-api/`.
- Put reusable automation and campaign-summary decisions in one pure shared module.
- Keep `src/background/drops-projection.ts` authoritative for campaign-aware reconciliation and annotation.
- Persist durable unverifiable markers through `TimingState`; do not put a second timer beside the existing recovery ladder.
- Keep `src/background/service-worker.ts` as dependency wiring only.
- Do not import projection or persistence modules into the DAG-leaf recovery/queue modules.
- Key durable reward state with a strict collision-safe `(campaignId, rewardId)` tuple encoding. Never persist a marker when either identity is missing; that case stays on the existing non-persistent stall-skip path.
- Do not introduce OAuth scopes, external services, analytics, manual completion controls, or name/image heuristics.

## Task 1: Introduce explicit reward semantics

**Files**

- Modify: `src/types/index.ts`
- Modify: `src/shared/drops.ts`
- Create: `tests/drops.test.ts`

**Changes**

1. Add the approved domain types:

   ```ts
   type RewardAcquisitionMethod = 'watch-time' | 'subscription' | 'other-event' | 'unknown';
   type RewardKind = 'in-game' | 'twitch-badge' | 'twitch-emote' | 'unknown';
   type RewardVerificationState = 'unassessed' | 'verified' | 'unverifiable';
   type CampaignCompletion = 'farmable' | 'farming-complete' | 'all-acquired';
   type CampaignRemainderReason = 'subscription-required' | 'unverifiable-twitch';
   ```

2. Add `CampaignRewardSummary` with `completion` and ordered `remainderReasons`.
3. Add `acquisitionMethod`, `rewardKind`, and `verificationState` to `TwitchDrop`.
4. Add `rewardSummary` to `TwitchGame`; retain `allDropsCompleted` as a derived compatibility field.
5. Teach `mergeDropProgressMonotonic` to retain prior acquisition/kind classification only when the fresh parser result is missing or `unknown`, and to retain `verified` together with monotonic claimed progress. Do not make `unverifiable` sticky here; Task 4 makes its durable marker the sole authority so real forward progress can clear it deterministically.
6. Keep the legacy `dropType` field temporarily during Tasks 1–7 so each checkpoint compiles; remove it in Task 8 after every consumer has migrated. It must not receive new business logic.

**Tests first**

- Add merge cases proving that claimed/progress monotonicity still wins.
- Add cases proving that known acquisition/kind classification and verified acquisition survive a weaker refresh.
- Add a case proving that `unverifiable` does not imply `claimed`, 100%, or completed status.

**Checkpoint**

```bash
bun test tests/drops.test.ts
bun run test:ts
```

**Commit**

```text
refactor(drops): model reward acquisition and verification
```

## Task 2: Classify rewards at the Twitch boundary

**Files**

- Modify: `src/background/twitch-api/parsing.ts`
- Modify: `src/background/twitch-api/client.ts`
- Test: `tests/client-parsing.test.ts`
- Test: `tests/api-operations.test.ts`

**Changes**

1. Add focused normalizers in `parsing.ts` for reward kind and acquisition method. They must consume only structured Twitch fields.
2. In `parseCampaignDrops`:
   - classify positive required minutes as `watch-time`;
   - classify the existing known zero-minute subscription shape as `subscription`;
   - classify `BADGE` and `EMOTE` distribution types as `twitch-badge` and `twitch-emote`;
   - classify known non-Twitch entitlement types as `in-game`;
   - use `unknown` for missing or unrecognized distribution data.
3. In `parseEventBasedDrops`, classify the current subscription/event bucket as `subscription`; do not infer `other-event` from an unknown shape.
4. Initialize ordinary rewards as `unassessed`.
5. When the existing strict `gameEventDrops` proof succeeds, set `verificationState: 'verified'` and retain the existing claimed/100% normalization.
6. Keep sibling-campaign matching strict: exact benefit ID, matching game, valid in-window award timestamp, and no conflicting campaign identity.
7. Delete any residual badge/emote classification based on names, campaign titles, category names, or images.

**Tests first**

- Cover watch-time, subscription, in-game, badge, emote, and unknown classification.
- Prove that names containing “badge” or “emote” do not classify a reward.
- Preserve the existing zero-minute subscription compatibility case.
- Extend the existing early-award tests so strict proof produces `verified`.
- Preserve the tests for outside-window, invalid/missing timestamp, external reward, and reused sibling benefit IDs.
- Add a fresh 0% badge/emote case that remains `unassessed` and unclaimed.

**Checkpoint**

```bash
bun test tests/client-parsing.test.ts tests/api-operations.test.ts
bun run test:ts
```

**Commit**

```text
feat(drops): classify Twitch reward semantics
```

## Task 3: Centralize automation and campaign completion rules

**Files**

- Create: `src/shared/reward-semantics.ts`
- Modify: `src/shared/drop-order.ts`
- Modify: `src/shared/drops.ts`
- Modify: `src/background/auto-claim.ts`
- Modify: `src/background/streamer-acquisition.ts`
- Create: `tests/reward-semantics.test.ts`
- Modify: `tests/drop-order.test.ts`
- Modify: `tests/auto-claim-drops.test.ts`
- Modify: `tests/auto-claim-cross-game.test.ts`

**Changes**

1. Export a deliberately small pure interface:
   - `isTwitchNativeReward(drop)`;
   - `isRewardAutomatable(drop)`;
   - `summarizeCampaignRewards(drops)`.
2. Define automatable behavior explicitly:
   - acquired rewards are not automatable;
   - `subscription` and `other-event` rewards are not automatable;
   - an `unverifiable` Twitch-native reward is not automatable;
   - a Twitch-native reward observed as claimed without strict verification is also treated as an unverifiable, non-automatable remainder without asserting acquisition;
   - `watch-time` and `unknown` rewards retain ordinary farming behavior when still pending.
3. Derive summaries in the approved order:
   - every reward acquired → `all-acquired`, no reasons;
   - any automatable pending reward → `farmable`, no campaign-level warning;
   - otherwise → `farming-complete`, with `subscription-required`, `unverifiable-twitch`, or both in that order.
4. Replace `dropType !== 'event-based'` in `pickNearestDrop` and pending-drop sorting with `isRewardAutomatable`.
5. Use the same helper for auto-claim target filtering and the stream-health “expects Drops signal” decision; this preserves the current exclusion of subscription/event rewards without duplicating the new rules.
6. Keep these helpers independent of background state, React, storage, and raw Twitch payloads.

**Tests first**

- Cover all three completion states.
- Cover subscription-only, unverifiable-only, and combined remainders.
- Prove that a new 0% Twitch-native reward is farmable and has no warning.
- Prove that unknown reward shapes remain on the normal farming path.
- Prove that an empty/partial campaign snapshot does not synthesize `all-acquired`.
- Prove that the nearest-drop selector ignores non-automatable rewards.
- Preserve auto-claim coverage: claimable watch-time rewards are targets; subscription and unverifiable rewards are not.
- Preserve stream-health behavior when only non-automatable remainders exist.

**Checkpoint**

```bash
bun test tests/reward-semantics.test.ts tests/drop-order.test.ts tests/auto-claim-drops.test.ts tests/auto-claim-cross-game.test.ts
bun run test:ts
```

**Commit**

```text
feat(drops): derive campaign farming completion
```

## Task 4: Persist and reconcile unverifiable reward markers

**Files**

- Modify: `src/background/runtime-state.ts`
- Modify: `src/background/state-persistence.ts`
- Modify: `src/background/drops-projection.ts`
- Modify: `tests/runtime-state.test.ts`
- Modify: `tests/state-persistence.test.ts`
- Modify: `tests/drop-processing.test.ts`

**Changes**

1. Add `UnverifiableRewardMarker` with the observed `progress`, `currentMinutes`, and `markedAt` timestamp.
2. Add `unverifiableRewardsByKey: Record<string, UnverifiableRewardMarker>` to `TimingState` and `ServiceWorkerState`; initialize it in `createServiceWorkerState` and normalize malformed stored values defensively.
3. Save and load the marker record through the existing timing-state storage boundary.
4. Add projection-owned operations:
   - mark one current reward unverifiable by its strict encoded `(campaignId, rewardId)` identity;
   - apply a matching marker to a fresh snapshot;
   - clear a marker on strict verified acquisition;
   - clear it when progress or watched minutes exceed the stored baseline;
   - clear it when an authoritative snapshot proves reward/campaign disappearance or expiry.
5. Do not clear markers on a failed fetch, partial snapshot, equal progress, weaker progress, or service-worker restart.
6. Recompute `rewardSummary` for every campaign in `annotateGameCompletion` and set `allDropsCompleted` only when the summary is `all-acquired`.
7. Apply marker reconciliation before `splitDropsForSelectedGame` chooses `currentDrop`, so unverifiable Twitch-native rewards are excluded from automation immediately.
8. Clear the marker record in existing full inactivity and authoritative-empty/reset paths, but not during normal crash recovery.

**Tests first**

- Round-trip marker persistence and reject malformed records.
- Isolate identical reward IDs across different campaigns.
- Preserve a marker across an equal/failed refresh and restart.
- Clear it on positive proof, real forward progress, authoritative disappearance, and expiry.
- Assert that 99% remains 99% and 0% remains 0% when marked unverifiable.
- Cover `farmable`, `farming-complete`, and `all-acquired` game annotations, including both remainder reasons.

**Checkpoint**

```bash
bun test tests/runtime-state.test.ts tests/state-persistence.test.ts tests/drop-processing.test.ts
bun run test:ts
```

**Commit**

```text
feat(drops): persist unverifiable Twitch rewards
```

## Task 5: Reuse exhausted recovery for Twitch-native uncertainty

**Files**

- Modify: `src/background/farming-session.ts`
- Modify: `src/background/session-lifecycle.ts`
- Modify: `src/shared/runtime-status.ts`
- Modify: `tests/queue-management.test.ts`
- Modify: `tests/service-worker.test.ts`
- Modify: `tests/runtime-status.test.ts`

**Changes**

1. Leave `MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS = 3` and the existing duration-aware thresholds unchanged.
2. Keep `streamer-acquisition.ts` generic and leaf-like. Its exhausted `onSkipCurrentGame` callback remains the seam.
3. In `farming-session.ts`, replace the current blind stalled-skip callback with an adapter that inspects the campaign-aware current reward:
   - if it is a badge/emote, mark it unverifiable through the projection operation, persist timing state, refresh the projected selection, then skip with `unverifiable-twitch`;
   - otherwise call the existing `stalled-progress` path unchanged.
4. Extend `QueueSkipReason` and `queueSkipCopy` with truthful unverifiable-Twitch copy.
5. When another campaign is queued, remove the current campaign from the active slot and advance normally.
6. When the queue ends, use a distinct terminal reason/copy explaining that farming finished but Twitch acquisition could not be verified; never say all rewards were claimed.
7. Add the corresponding `formatStopReason` label for popup and monitor parity.

**Tests first**

- Badge/emote at 99% becomes unverifiable only after the third exhausted recovery attempt and advances the queue.
- Badge/emote at 0% begins normally and becomes unverifiable only after a real failed recovery cycle.
- In-game and unknown rewards retain the existing `stall-skipped` behavior.
- The marker is persisted before selected campaign/queue state changes.
- Terminal copy and notification copy avoid “all complete”/“all claimed”.

**Checkpoint**

```bash
bun test tests/queue-management.test.ts tests/service-worker.test.ts tests/runtime-status.test.ts
bun run test:ts
```

**Commit**

```text
feat(farming): advance past unverifiable Twitch rewards
```

## Task 6: Enforce farming-complete semantics in Start and queue flows

**Files**

- Modify: `src/background/drops-tick.ts`
- Modify: `src/background/session-lifecycle.ts`
- Modify: `src/background/farming-session.ts`
- Modify: `src/shared/messages.ts`
- Modify: `tests/queue-start.test.ts`
- Modify: `tests/queue-management.test.ts`
- Modify: `tests/messages.test.ts`
- Modify: `tests/message-router.test.ts`

**Changes**

1. Replace `evaluateDropsForGame(...).hasFarmableDrops` with a campaign-summary result sourced from the shared semantic module.
2. In `handleAddToQueue`, return a typed `farming-complete` reason when rewards remain but none is automatable; retain `already-completed` only for `all-acquired`.
3. Add a narrow `AddToQueueReason` response union in the runtime message contract and update the popup response handling.
4. In `handleStartFarming`, reject `farming-complete` with reason-specific copy and reject `all-acquired` with the existing completed meaning.
5. In both queue-advance loops, skip queued `farming-complete` campaigns after refresh, just as terminal campaigns are skipped, but preserve their summary for inspection.
6. Keep campaigns visible/selectable; selection itself must not mutate verification or completion state.
7. Persist and broadcast after every queue mutation through existing callbacks.

**Tests first**

- Subscription-only, unverifiable-only, and combined farming-complete campaigns cannot start or enter the queue.
- All-acquired keeps the existing queue/start outcome.
- A queued campaign that becomes farming-complete is skipped and the next farmable campaign starts.
- A fresh 0% badge/emote can start and enter the queue.
- Malformed runtime payloads still fail closed.

**Checkpoint**

```bash
bun test tests/queue-start.test.ts tests/queue-management.test.ts tests/messages.test.ts tests/message-router.test.ts
bun run test:ts
```

**Commit**

```text
feat(queue): enforce campaign farming completion
```

## Task 7: Explain campaign and reward state in popup and monitor

**Files**

- Create: `src/popup/components/CampaignStatusIndicators.tsx`
- Modify: `src/popup/components/icons.tsx`
- Modify: `src/popup/components/MainView.tsx`
- Modify: `src/popup/components/QueueChips.tsx`
- Modify: `src/popup/components/DropCard.tsx`
- Modify: `src/popup/App.tsx`
- Modify: `src/popup/format.ts`
- Modify: `src/monitor/App.tsx`
- Modify: `tests/popup-source.test.ts`
- Create: `tests/monitor-source.test.ts`

**Changes**

1. Add a circled-question SVG matching the visual weight of the existing `SubIcon`.
2. Add one compact campaign-indicator component used by selected-campaign and queue-chip surfaces:
   - green check only for `all-acquired`;
   - amber gift for `subscription-required`;
   - amber circled question for `unverifiable-twitch`;
   - gift then question, at most two indicators;
   - disconnected-account lock remains independent.
3. Keep the native `<select>` and generate compact Unicode prefixes in `format.ts`; do not attempt SVG inside `<option>`.
4. In `DropCard`, replace the generic event-based presentation with:
   - `Subscription required` / `Subscribe to redeem this reward` for subscription-gated rewards;
   - preserved Twitch percentage plus `Acquisition could not be verified on Twitch` for unverifiable badge/emote rewards.
5. Update claimable counts and nearest-drop display to use `isRewardAutomatable`.
6. Disable Start for `farming-complete` and show separate explanatory lines for subscription and unverifiable reasons. Use `role="status"` and `aria-live="polite"` on the selected status description.
7. Map the typed queue response reason to the same vocabulary; do not reuse “already claimed” for farming-complete.
8. In the monitor, show the shared terminal status and campaign explanation when no automatable reward remains; retain ordinary progress for a fresh 0% Twitch-native reward.
9. Use the existing amber/orange token family, no new colored panels, animation, or extra icon variants.

**Tests first**

- Assert green check exclusivity.
- Assert gift and question indicators independently and together in fixed order.
- Assert the native option label stays campaign-aware and compact.
- Assert the selected detail includes accessible full copy and live-region semantics.
- Assert subscription and unverifiable reward-card copy.
- Assert Start is enabled for a new 0% badge/emote and disabled only once the campaign is farming-complete.
- Assert popup and monitor terminal copy never reports all rewards claimed for farming-complete.

**Checkpoint**

```bash
bun test tests/popup-source.test.ts tests/monitor-source.test.ts
bun run test:ts
bun run lint
```

**Commit**

```text
feat(ui): explain non-automatable campaign rewards
```

## Task 8: Remove the legacy drop-type split and run the release gate

**Files**

- Modify: `src/types/index.ts`
- Modify: any remaining source consumer returned by `rg "dropType|event-based|time-based" src`
- Modify: remaining fixture literals in `tests/crash-recovery.test.ts`, `tests/drop-processing.test.ts`, and `tests/queue-management.test.ts`
- Update if behavior changes: `docs/soak-test-checklist.md`

**Changes**

1. Migrate every remaining consumer and fixture to the explicit acquisition/kind/verification fields.
2. Remove `DropType` and `TwitchDrop.dropType` after the search returns no business-logic references.
3. Confirm stored legacy snapshots cannot survive an extension update through the existing volatile-state reset; do not add a long-lived compatibility shim.
4. Run formatting only on touched files and inspect the final diff for unrelated changes.

**Automated verification**

```bash
bun run test:ts
bun run lint
bun test tests/
bun run build:all
bun audit
```

If this is being prepared for a store handoff, use the project’s consolidated gate as the final repeatable command:

```bash
bun run release:check
```

**Manual QA gate**

1. New campaign, ordinary in-game reward at 0%: Start enabled, no warning.
2. New campaign, badge/emote at 0%: Start enabled, no question indicator.
3. Watch rewards complete, subscription remainder: amber gift, green check absent, Start disabled, subscription card retained.
4. Strict early badge/emote award: reward verified/completed; green check appears only if every campaign reward is acquired.
5. Badge/emote stalled at 99% through all three recovery attempts: 99% preserved, question indicator shown, queue advances.
6. Badge/emote stalled at 0% after a real recovery cycle: 0% preserved, then question indicator shown, queue advances.
7. Browser restart: unverifiable marker and campaign summary survive.
8. Later strict award evidence or forward progress: marker clears and farming can resume when appropriate.
9. Two sibling campaigns sharing game/benefit IDs: neither inherits the other’s verified or unverifiable state.
10. Campaign with both remainder reasons: exactly gift plus question, two concise explanation lines, no visual clutter.
11. Queue ending on farming-complete: popup and monitor explain why automation stopped without claiming all rewards were acquired.

Record the browser version, extension build, campaign IDs, observed reward percentages, recovery-attempt sequence, and screenshots for cases 2, 3, 5, 7, 8, and 10.

**Commit**

```text
refactor(drops): remove legacy drop type semantics
```

## Final acceptance checklist

- [ ] Subscription remainder never produces the green completed check.
- [ ] Gift appears only when no automatable watch-time reward remains.
- [ ] Fresh badge/emote at 0% remains ready to farm.
- [ ] Badge/emote acquisition is never asserted without positive Twitch evidence.
- [ ] Exhausted Twitch-native recovery cannot trap the session or queue.
- [ ] Unverifiable percentage remains exactly what Twitch reported.
- [ ] Durable marker survives restart and clears only on approved transitions.
- [ ] Campaign-aware identity prevents sibling contamination.
- [ ] Farming-complete stays visible but cannot Start or join the queue.
- [ ] Popup and monitor use the same truthful vocabulary.
- [ ] No new permission, backend, analytics, heuristic classifier, or manual completion override exists.
- [ ] Full project verification and manual QA gate pass.
