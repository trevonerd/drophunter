# Favorite autostart and queue design

## Goal

Make `Favorite auto-start` a real farming action rather than an automatic queue-only action. When DropHunter is idle, it must reconcile eligible favorite campaigns into the queue and start farming immediately from the campaign that should run first. When DropHunter is already farming, newly discovered favorite campaigns must affect only the future queue and must never interrupt the active farming session.

## Confirmed behavior

- Automatic favorite campaigns remain eligible only when their authoritative reward summary is `farmable`.
- Completed, farming-complete, subscription-only, expired, and unclassified campaigns remain excluded from automatic insertion.
- In `priority-list-only` mode, a newly discovered favorite campaign is inserted before the first queued campaign with a later expiry.
- Existing queue entries keep their relative order. A new campaign with the same expiry is placed after existing equal-expiry entries.
- Queue entry identity remains campaign-aware and prefers `campaignId`.
- Manual queue entries and their metadata remain manual. Automatic reconciliation must not rewrite their provenance.
- At most one `favorite-auto` campaign represents each favorite Twitch category, following the existing favorite eligibility contract.

## Idle behavior

After a successful campaign refresh, DropHunter performs one ordered operation:

1. Classify eligible favorite campaigns from the authoritative campaign and inventory snapshot.
2. Reconcile `favorite-auto` entries into the visible queue by campaign expiry.
3. Persist and broadcast the reconciled queue.
4. Select the first eligible campaign in that queue.
5. Start its farming session in the same automation evaluation.

The campaign that starts may be an existing manual entry or a newly inserted favorite campaign. Expiry decides which eligible campaign is first:

- if an existing queued campaign expires earlier, it starts and the new favorite remains later in the queue;
- if the new favorite expires earlier, it is inserted before the existing entry and starts immediately.

The queue is therefore the single priority authority. There is no separate hidden rule that makes a newly discovered favorite bypass an earlier-expiring queued campaign.

An eligible manual Twitch watch continues to use the existing `manual-watch-active` safety behavior and blocks an automatic farming transition. This change does not take control away from a stream the user is already watching.

## Active farming behavior

When a DropHunter farming session is already running:

- the active campaign, streamer, and watch transport remain unchanged;
- a newly discovered eligible favorite campaign is inserted into the future queue by expiry;
- if it expires before every existing future entry, it becomes the first queued campaign;
- it does not preempt the active campaign, even when it expires before the active campaign;
- normal completion, failure, skip, or stop handling remains responsible for advancing to the first queued campaign.

The existing favorite preemption rule is removed from this flow. Automatic discovery may reorder what runs next, but it may not replace what is running now.

## Ordering details

`insertFavoriteCampaignByDeadline` remains the queue insertion boundary. It preserves the current queue and inserts the automatic campaign at the first position whose expiry is strictly later.

Campaigns with a valid finite expiry sort before campaigns without a valid expiry. Existing equal-expiry entries retain precedence because insertion occurs only before a strictly later expiry. The planner does not globally re-sort the user's queue.

Idle candidate selection in `priority-list-only` mode uses the reconciled queue produced by that same evaluation. This guarantees that the campaign shown first in the queue is the campaign DropHunter attempts to start.

## Scope

- No new runtime message, storage field, timer, setting, permission, or popup control.
- No change to campaign classification, favorite category identity, claim behavior, tabless transport, or queue-completion behavior.
- Private `ending-soonest` and `lowest-availability` ranking modes keep their existing non-mutating queue behavior.
- The no-preemption rule applies to automatic favorite discovery: an already running DropHunter session is preserved.

## Failure and recovery

- Queue reconciliation remains durable before streamer preparation or farming transition work begins.
- If streamer preparation fails while idle, the correctly ordered queue remains persisted and the existing typed retry behavior applies.
- If a state mutation occurs during refresh or preparation, the existing fingerprint guard supersedes the stale evaluation.
- If no eligible queue campaign has an available streamer, DropHunter does not start an invalid campaign and retains the existing retry behavior.
- Repeated automation evaluations remain idempotent and must not duplicate queue entries or transition effects.

## TDD seams and verification

Regression tests exercise the public `automation.request(...)` boundary rather than private helpers:

- Idle, existing manual campaign expires first: it remains first, farming starts immediately from it, and the favorite is inserted later.
- Idle, newly discovered favorite expires first: it is inserted first and farming starts immediately from it in the same request.
- Running, newly discovered favorite expires before the active campaign: the active campaign is not preempted, no replacement watch is prepared, and the favorite becomes the first future queue entry.
- Running, newly discovered favorite expires between two queued campaigns: it is inserted between them without changing the active session.
- Equal expiry preserves existing queue order.
- Manual metadata and campaign-aware identity survive reconciliation.
- A preparation failure leaves the reconciled queue persisted.
- Repeated requests do not duplicate entries or farming transitions.

Focused automation start, queue, preemption, candidate, favorite, persistence, and runtime-wiring tests must pass, followed by TypeScript, Biome, the complete test suite, and both production builds.
