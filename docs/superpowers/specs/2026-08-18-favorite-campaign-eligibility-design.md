# Favorite campaign eligibility design

## Goal

Make favorite-game automation queue the first campaign that DropHunter can actually farm, as soon as the current Twitch campaign and inventory refresh is complete. Completed campaigns, subscription-only campaigns, expired campaigns, and campaigns whose reward catalog is still incomplete must never be added automatically.

## Root cause

The Farming automation Twitch adapter merges the campaign and inventory snapshots but publishes games before applying the authoritative campaign reward summary. The favorite queue planner currently treats a missing summary as farmable. A fully loaded campaign can therefore remain unclassified and be selected only because it expires first, even when its rewards are already acquired or require a subscription.

The defect is at the classification boundary, not in the popup. The popup is displaying the automatic queue that the background policy persisted.

## Confirmed behavior

- A campaign is eligible for favorite automation only when its authoritative reward summary is `farmable`.
- `all-acquired` campaigns are excluded.
- `farming-complete` campaigns are excluded, including campaigns whose only remaining rewards require a subscription.
- A campaign with at least one pending watch-time reward remains eligible even when it also contains a subscription-gated reward.
- Missing or incomplete reward evidence is fail-closed: DropHunter waits for a later refresh and does not queue the campaign speculatively.
- Expired campaigns are excluded.
- At most one automatic campaign is queued for each favorite Twitch category.
- The selected campaign is the one with the earliest expiry. If two campaigns expire at the same instant, the first campaign in the normal farmable campaign list wins.
- A surviving manual queue entry represents its favorite category and takes precedence over an automatic insertion. Manual entries and their metadata are never rewritten by this reconciliation.
- Existing `favorite-auto` entries are rebuilt from the current authoritative snapshot, so stale completed, subscription-only, expired, or lower-priority entries disappear in the same evaluation.
- The queue is reconciled in the same `campaign-refresh` evaluation that finishes loading campaigns and inventory. It does not wait for the periodic alarm.

## Authoritative classification boundary

`createFarmingAutomationTwitchAdapter.refresh()` remains the boundary that combines Twitch campaign and inventory data for Farming automation. Before it publishes the normalized snapshot, it applies the existing campaign-aware completion annotation used by the Drops snapshot projection.

Annotation remains conservative:

- the campaign declares a non-negative reward count;
- the refresh contains exactly that many uniquely identified rewards for the campaign;
- the rewards can be matched to the campaign without crossing campaign identity.

Only then is a campaign assigned `farmable`, `farming-complete`, or `all-acquired`. Incomplete data retains no summary and is ineligible until a complete later refresh arrives. This reuses the existing reward semantics rather than introducing a second classifier.

## Evaluation flow

Each favorite-automation refresh follows this order:

1. Fetch the current campaign snapshot and inventory snapshot.
2. Merge them by campaign and reward identity.
3. Annotate only complete campaign reward sets with the authoritative reward summary.
4. Normalize and publish the Farming automation snapshot.
5. Discard unclassified and non-farmable campaigns before Twitch directory lookup.
6. Discover stream availability for the remaining farmable campaigns.
7. Reconcile `favorite-auto` queue entries from the classified candidates.
8. Persist and broadcast the resulting queue in the same evaluation.

Filtering before directory lookup avoids delaying the correct campaign behind network requests for campaigns that can never be farmed.

## Ordering and identity

Campaign identity remains campaign-aware and prefers `campaignId`. Favorite membership continues to use the normalized Twitch category key.

Candidate ordering uses the same shared display comparator as the campaign list. That comparator orders by campaign expiry first and applies the existing deterministic campaign identity and label tie-breakers. This makes the planner's equal-expiry choice identical to the first row the user sees in the farmable list.

## Failure and recovery behavior

- A campaign or inventory request failure keeps the existing typed Farming automation failure and retry behavior; it does not fall back to speculative queue insertion.
- A partial successful response is treated as incomplete evidence for affected campaigns and therefore queues nothing for them.
- A later complete refresh reconciles the queue immediately and may add the newly classified campaign.
- Directory lookup failures continue to affect only the otherwise eligible candidate and use the existing retry scheduling.
- No new timer, runtime message, storage field, setting, or popup control is introduced.

## Verification

Regression coverage must exercise public behavior:

- The Twitch adapter classifies a complete three-campaign catalog as acquired, subscription-only, and farmable respectively.
- An incomplete reward catalog remains unclassified.
- The favorite queue planner never inserts an unclassified campaign.
- The exact Marvel Rivals case selects `Season 9.5` and excludes acquired `Day 1` and subscription-only campaigns.
- A mixed watch-time plus subscription campaign remains eligible.
- Equal-expiry campaigns select the first campaign in normal display order.
- Discovery performs directory lookup only for classified farmable campaigns.
- Existing incorrect automatic rows are removed while manual rows remain unchanged, including the cleanup-only persistence path.
- A full `campaign-refresh` request persists the correct queue in that same request.
- Chromium QA with the production extension proves the popup shows only the correct automatic campaign after refresh.

Release remains blocked until focused tests, TypeScript, lint, the complete test suite, both browser builds, audits, generated release checks, and Chromium QA all pass.
