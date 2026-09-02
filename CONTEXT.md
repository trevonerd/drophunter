# DropHunter Context

Shared language for DropHunter's Twitch Drops farming domain. Use these terms when naming modules, tests, and agent notes.

## Language

**Twitch Drops campaign**:
A Twitch-defined reward campaign for one game or category, identified by `campaignId` when Twitch provides it.
_Avoid_: Plain game, game-only campaign

**Farming session**:
The active DropHunter run that watches an eligible Twitch stream, tracks Drop progress, handles recovery, and advances the queue.
_Avoid_: Monitor loop, queue runner, farming service

**Farming automation**:
The DropHunter orchestration that selects eligible Twitch Drops campaigns and automatically starts or preempts farming sessions in response to browser lifecycle and campaign changes.
_Avoid_: Auto-start coordinator, automatic farming session, favorite-game automation

**Favorite campaign preemption**:
The replacement of the active campaign by a newly discovered favorite campaign with a known, strictly earlier expiry and a proven eligible streamer; the interrupted campaign remains next in the queue.
_Avoid_: Streamer rotation, queue reset, equal-expiry preemption

**Authoritative campaign refresh**:
A successful, complete Twitch campaign refresh that can prove whether a specific campaign and its farmable rewards still exist. Timeouts, failed requests, partial snapshots, and cached data are not authoritative.
_Avoid_: Any refresh, cached refresh, empty response

**Unfarmable campaign**:
An active campaign whose exact identity is absent from an authoritative campaign refresh, or which no longer contains an obtainable watch-time reward.
_Avoid_: Stalled campaign, temporarily missing campaign, offline streamer

**Parked campaign**:
A still-valid campaign temporarily moved behind other queued work because no eligible streamer is currently available; it remains eligible for future refreshes and retries.
_Avoid_: Skipped campaign, removed campaign, unfarmable campaign

**Confirmed progress stall**:
The absence of authoritative watch-time progress for the configured stall window. Stream metadata such as offline status, category mismatch, or missing Drops labels is diagnostic evidence only after this condition is established.
_Avoid_: Stream metadata mismatch, single missed poll, transport repair

**Real authentication failure**:
An explicit invalid-OAuth response that remains unresolved after one silent session resynchronization attempt from the user's Twitch browser context.
_Avoid_: Network failure, Twitch service failure, expired integrity token, missing cached session

**Farming-complete campaign**:
A Twitch Drops campaign with no remaining reward that DropHunter can obtain automatically. It may still contain subscription-gated rewards or Twitch-native rewards whose acquisition is unverifiable.
_Avoid_: Completed campaign, all rewards claimed

**Managed farming tab**:
The browser tab DropHunter owns for watching the current farming session stream.
_Avoid_: Stream tab, player tab

**Hidden farming transport**:
The user-selected farming mode that runs without a DropHunter-managed Twitch tab and never falls back to creating one automatically.
_Avoid_: Background tab, automatic managed-tab fallback

**Manual Twitch viewing**:
An eligible Twitch stream opened and controlled by the user, which DropHunter observes without claiming ownership of the tab.
_Avoid_: Managed farming tab, Hidden farming transport

**Drops snapshot projection**:
The state projection that turns Twitch campaign, inventory, hidden refresh, or cached Drops snapshots into DropHunter's campaign-aware app state.
_Avoid_: Drop processing, drops mapper

**Reward acquisition method**:
The condition a viewer must satisfy to obtain a Twitch campaign reward, such as watch time, a channel subscription, or another Twitch event.
_Avoid_: Drop type, event-based reward

**Subscription-gated reward**:
A Twitch campaign reward that requires a paid or Prime channel subscription rather than watch time and cannot be obtained automatically by DropHunter.
_Avoid_: Sub-only drop, event-based reward, paid drop

**Reward kind**:
The nature and destination of a Twitch campaign reward, such as an in-game item, Twitch badge, Twitch emote, or unknown reward.
_Avoid_: Drop type, acquisition method

**Twitch-native reward**:
A Twitch campaign reward used on Twitch itself, specifically a Twitch badge or Twitch emote, rather than an in-game item.
_Avoid_: In-game reward, event-based reward

**Verified reward acquisition**:
A reward acquisition supported by positive Twitch evidence that identifies the awarded benefit for the viewer. Missing evidence does not disprove acquisition.
_Avoid_: Assumed completion, inferred ownership

**Unverifiable reward state**:
An additional verification qualifier shown only for an anomalous Twitch-native reward when DropHunter lacks sufficient positive evidence to determine whether the viewer acquired it. It does not replace Twitch-reported progress or mark the reward as obtained; a newly available reward at 0% remains ready to farm.
_Avoid_: Not obtained, incomplete reward, default Twitch-native state
