# Twitch reward semantics and farming completion

## Summary

DropHunter must distinguish what a campaign reward is, how it is obtained, what Twitch currently reports, and whether acquisition can be verified. The current `time-based`/`event-based` split conflates these concerns and makes subscription-gated rewards and Twitch-native badge/emote rewards look like ordinary pending Drops.

This design introduces explicit reward semantics and a campaign-level farming summary. It preserves truthful reward progress, prevents unverifiable Twitch-native rewards from trapping the queue, and gives subscription-only campaign remainders a clear status without misusing the existing completed checkmark.

## Goals

- Show a distinct subscription indicator only after every watch-time reward in the campaign has been obtained.
- Keep the existing green completed indicator exclusively for campaigns whose rewards are all acquired.
- Recognize Twitch badges and emotes from structured Twitch distribution data, never from names.
- Treat positive Twitch evidence as proof of acquisition without treating missing evidence as proof of non-acquisition.
- Preserve a new campaign at 0% as ready to farm, including campaigns containing Twitch-native rewards.
- Stop retrying a Twitch-native reward after the existing recovery ladder is exhausted, while preserving its reported progress and marking acquisition as unverifiable.
- Advance the queue when no reward remains that DropHunter can obtain automatically.
- Persist unverifiable reward state across MV3 service-worker and browser restarts.
- Keep campaign identity isolated by `campaignId` and reward identity.

## Non-goals

- No new Twitch OAuth flow, token storage, or `user:read:emotes` scope.
- No attempt to enumerate badges owned by the viewer through unsupported Twitch surfaces.
- No name, image, or copy heuristics for identifying badges, emotes, or subscription requirements.
- No manual “mark obtained” override.
- No custom campaign dropdown; the native `<select>` remains.
- No second stall timer or replacement for the existing recovery ladder.
- No change to ordinary in-game reward recovery behavior.

## Evidence constraints

The research note [Verificare badge ed emote Twitch ottenuti tramite Drops](../../research/twitch-reward-ownership-proof.md) records the available Twitch evidence.

`currentUser.inventory.gameEventDrops` is positive evidence when benefit ID, game, and a valid award timestamp identify one reward inside its campaign window. Missing records do not prove that a reward was not acquired. A reused benefit ID or missing/invalid timestamp cannot safely identify one campaign.

The official `Get User Emotes` endpoint can prove current emote availability but requires new OAuth consent and cannot identify the source Drops campaign. Twitch exposes badge catalogs, not a general viewer badge inventory. `Get Drops Entitlements` is restricted to Client IDs belonging to the organization that owns the game. These constraints are why this design uses verified and unverifiable states instead of inventing certainty.

## Domain model

### Reward axes

Each projected reward carries independent dimensions:

```ts
type RewardAcquisitionMethod = 'watch-time' | 'subscription' | 'other-event' | 'unknown';

type RewardKind = 'in-game' | 'twitch-badge' | 'twitch-emote' | 'unknown';

type RewardVerificationState = 'unassessed' | 'verified' | 'unverifiable';
```

Existing Twitch-reported fields remain authoritative observations:

- `progress`
- `currentMinutes`
- `claimed`
- `claimable`
- `status`

`RewardVerificationState` qualifies those observations; it does not replace them. A reward may therefore remain at 99% and be unverifiable. It must not be silently promoted to claimed.

### Classification rules

- Positive required watch minutes classify the acquisition method as `watch-time`.
- Rewards supplied through Twitch's subscription/event bucket, and the known zero-minute subscription shape already handled by DropHunter, classify as `subscription`.
- `other-event` is reserved for a future explicit Twitch acquisition method. It is not inferred from missing minutes, names, or unknown payload shapes in this change.
- `benefit.distributionType === 'BADGE'` classifies the reward as `twitch-badge`.
- `benefit.distributionType === 'EMOTE'` classifies the reward as `twitch-emote`.
- Known non-Twitch entitlement distribution types already handled as ordinary Drops classify as `in-game` for automation semantics.
- Names, campaign titles, category names, and images never classify reward kind.
- Missing or unrecognized distribution data produces `unknown` and retains ordinary farming behavior unless the acquisition method independently makes the reward non-farmable.

### Campaign summary

The Drops snapshot projection derives one summary for each campaign:

```ts
type CampaignCompletion = 'farmable' | 'farming-complete' | 'all-acquired';

type CampaignRemainderReason = 'subscription-required' | 'unverifiable-twitch';

interface CampaignRewardSummary {
  completion: CampaignCompletion;
  remainderReasons: CampaignRemainderReason[];
}
```

Derivation order is deterministic:

1. If every campaign reward is acquired, completion is `all-acquired` and `remainderReasons` is empty.
2. Otherwise, if any pending watch-time reward remains automatable, completion is `farmable` and no campaign-level remainder indicator is shown.
3. Otherwise, completion is `farming-complete`. Reasons contain `subscription-required`, `unverifiable-twitch`, or both, based on the remaining rewards.

The existing `allDropsCompleted` compatibility field may remain during implementation, but it must be derived only from `all-acquired`. It must never mean `farming-complete`.

## Module design

### Twitch reward classification

The Twitch parsing layer owns translation from unstable raw Twitch payloads into the explicit reward axes. Callers do not inspect `eventBasedDrops`, `requiredMinutesWatched`, or raw benefit distribution fields after parsing.

Its interface returns normalized reward semantics. Its implementation hides compatibility handling for Twitch placing zero-minute subscription rewards in different payload buckets.

### Reward automation semantics

A pure shared module owns the small interface used by the rest of the application:

- determine whether a reward is currently automatable;
- summarize all rewards belonging to one campaign;
- expose the resulting campaign completion and remainder reasons.

Queue, farming-session, monitor, and popup code consume this interface rather than repeating `dropType !== 'event-based'` checks.

### Drops snapshot projection

`drops-projection.ts` remains the authoritative module for campaign-aware matching, monotonic progress merging, reward verification reconciliation, and campaign summary annotation. It applies persisted unverifiable state before producing popup-visible app state.

`service-worker.ts` remains orchestration glue. Recovery reports an exhausted Twitch-native reward through an injected callback rather than importing projection internals into the recovery modules.

## Verification lifecycle

### Verified acquisition

A badge or emote becomes verified and acquired only from positive evidence that safely identifies it:

- exact benefit ID;
- matching game;
- valid `lastAwardedAt` inside the reward/campaign window;
- no conflicting campaign identity.

When verified, the existing completion normalization applies: claimed, 100%, not claimable, zero remaining minutes, and completed status.

### Fresh and progressing rewards

A newly discovered reward at 0% is `unassessed`, not unverifiable. It appears ready to farm. Real progress keeps or restores the reward to the normal farmable path.

### Ambiguous evidence

A reused benefit ID with no timestamp or invalid campaign attribution never marks multiple candidate campaigns claimed or unverifiable. Each candidate remains ready to farm until real progress or exhausted recovery provides campaign-specific evidence.

An ambiguous award hint may qualify one reward as unverifiable only when its campaign and reward identity are otherwise unique. It still does not become acquired.

### Exhausted recovery

The existing recovery ladder remains the timing authority. No second timer or percentage-specific threshold is introduced.

For a stalled reward, DropHunter already:

1. waits for the duration-aware stall threshold;
2. attempts in-place playback self-healing;
3. forces a campaign and inventory refresh;
4. rotates to a different streamer;
5. exhausts three stalled-progress recovery attempts.

When that ladder is exhausted:

- a Twitch badge or emote is marked `unverifiable`, persisted, removed from the automatable set, and the queue advances;
- an in-game or unknown reward follows the existing stalled-progress behavior without receiving the new qualifier.

### Persistence and clearing

Unverifiable state is durable and keyed by campaign-aware reward identity, using `campaignId + rewardId`. It survives service-worker recycling and browser restart.

It clears only when:

- positive evidence verifies acquisition;
- Twitch reports real forward progress for that reward;
- the campaign or reward disappears authoritatively;
- the campaign expires.

A refresh that returns the same evidence does not clear it. Subscription remainder state is derived from every current snapshot and requires no durable marker.

## Queue and farming behavior

- `all-acquired` campaigns retain the current completed behavior and green checkmark.
- `farmable` campaigns may be selected, queued, and started normally.
- `farming-complete` campaigns remain visible and selectable for inspection but cannot be added to the queue or used to start farming.
- A queued campaign that becomes `farming-complete` is removed from the active slot and the queue advances.
- If the queue ends on a `farming-complete` campaign, terminal copy states why automation ended without claiming that every reward was acquired.
- A manual campaign refresh can supply new evidence, but there is no manual completion override and no separate retry-farming button.

## Popup and monitor UX

### Compact campaign indicators

- Green checkmark: `all-acquired` only.
- Amber subscription gift icon: `farming-complete` with `subscription-required`.
- Amber circled question mark: `farming-complete` with `unverifiable-twitch`.
- Both indicators may appear, in that order, when both reasons apply.
- Existing disconnected-account lock remains unchanged.

The gift and question indicators share one restrained amber/orange family. Shape and text carry meaning; color is not the sole signal. There are no new colored backgrounds or animations.

The native campaign `<select>` uses compact Unicode equivalents because native options cannot reliably render SVG. The selected-campaign surface and queue chips use the existing `SubIcon` and a matching circled-question SVG. A selected status description provides the full accessible meaning.

### Reward and action copy

Subscription reward card:

- `Subscription required`
- `Subscribe to redeem this reward`

Unverifiable Twitch-native reward card:

- retain the Twitch-reported percentage;
- `Acquisition could not be verified on Twitch`.

Disabled Start helper copy:

- `All farmable rewards claimed · Subscription required for remaining rewards`
- `Farming finished · Twitch reward acquisition could not be verified`

When both reasons apply, the selected campaign shows two compact explanatory lines rather than one overloaded sentence. Status changes use `role="status"` and `aria-live="polite"`. Popup and monitor use the same campaign completion vocabulary.

## Failure behavior

- A failed Twitch refresh preserves the last known summary and unverifiable markers; failure is surfaced through the existing refresh error UI.
- Missing fields never create a verified acquisition or a Twitch-native classification.
- Stale or weaker progress cannot overwrite stronger claimed or monotonic progress.
- A sibling campaign cannot inherit claimed or unverifiable state from another campaign sharing the same game or benefit ID.
- Unknown reward shapes do not receive gift or question indicators through heuristics.

## Automated test coverage

### Twitch parsing

- Watch-time, subscription, Twitch badge, Twitch emote, and unknown classification.
- `BADGE` and `EMOTE` use structured distribution types.
- Names containing “badge” or “emote” do not classify the reward.
- Zero-minute subscription payload compatibility remains covered.

### Drops snapshot projection

- `all-acquired`, `farmable`, and `farming-complete` summaries.
- Subscription-only remainder, unverifiable Twitch remainder, and both reasons.
- A fresh Twitch-native reward at 0% remains farmable without a warning.
- Early badge/emote award with strict evidence becomes verified and completed.
- Ambiguous sibling campaign evidence does not contaminate either campaign.

### Recovery, queue, and persistence

- Badge/emote at 99% becomes unverifiable only after exhausted recovery and advances the queue.
- Badge/emote at 0% begins normally; after a real failed farming/recovery cycle it becomes unverifiable.
- In-game stalled rewards retain existing behavior.
- Unverifiable identity survives restart and remains campaign-specific.
- Positive evidence or forward progress clears the marker.
- Farming-complete campaigns cannot start or enter the queue and are skipped if already queued.

### Popup and monitor

- Existing green check remains exclusive to all-acquired campaigns.
- Gift and circled-question indicators render independently and together.
- Start and queue controls are disabled with correct explanatory copy.
- Native select labels remain compact; selected details expose accessible text.
- Status regions announce meaningful changes.
- Popup and monitor terminal copy does not say “all rewards claimed” for farming-complete campaigns.

## Manual QA

1. Load a newly released campaign at 0% and confirm it appears ready to farm without an unverifiable indicator.
2. Complete all watch-time rewards in a campaign with a subscription-gated remainder; confirm the gift indicator, disabled Start action, and preserved subscription reward card.
3. Observe a badge/emote awarded early through strict `gameEventDrops` evidence; confirm it becomes completed and the campaign can receive the green check only when every reward is acquired.
4. Exercise a Twitch-native reward stalled at 99% through the complete recovery ladder; confirm its percentage remains, the circled-question indicator appears, and the queue advances.
5. Exercise a Twitch-native reward stalled at 0% after a real farming attempt; confirm it was initially normal and becomes unverifiable only after recovery is exhausted.
6. Restart the browser and confirm an unverifiable marker persists without restarting farming for that reward.
7. Produce a later progress increase or strict award proof and confirm the marker clears.
8. Load two campaigns for the same game with a reused benefit ID and ambiguous timestamp; confirm neither receives a premature completion or unverifiable marker.
9. Display a campaign with both subscription and unverifiable remainders; confirm at most two restrained indicators and separate explanatory lines.

## Acceptance criteria

- A campaign with remaining subscription-gated rewards never shows the green completed check unless those rewards are acquired.
- The subscription indicator appears only after no automatable watch-time reward remains.
- A new campaign at 0% never appears unverifiable merely because it contains a badge or emote.
- A badge/emote is never marked acquired without positive Twitch evidence.
- Exhausted Twitch-native recovery cannot trap the farming session or queue.
- Unverifiable state persists and clears only on the defined evidence transitions.
- Duplicate campaigns remain isolated by campaign-aware reward identity.
- No OAuth permission, remote backend, analytics, or non-Twitch network surface is introduced.
