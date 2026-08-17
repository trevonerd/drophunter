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

**Farming-complete campaign**:
A Twitch Drops campaign with no remaining reward that DropHunter can obtain automatically. It may still contain subscription-gated rewards or Twitch-native rewards whose acquisition is unverifiable.
_Avoid_: Completed campaign, all rewards claimed

**Managed farming tab**:
The browser tab DropHunter owns for watching the current farming session stream.
_Avoid_: Stream tab, player tab

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
