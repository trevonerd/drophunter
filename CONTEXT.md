# DropHunter Context

Shared language for DropHunter's Twitch Drops farming domain. Use these terms when naming modules, tests, and agent notes.

## Language

**Twitch Drops campaign**:
A Twitch-defined reward campaign for one game or category, identified by `campaignId` when Twitch provides it.
_Avoid_: Plain game, game-only campaign

**Farming session**:
The active DropHunter run that watches an eligible Twitch stream, tracks Drop progress, handles recovery, and advances the queue.
_Avoid_: Monitor loop, queue runner, farming service

**Managed farming tab**:
The browser tab DropHunter owns for watching the current farming session stream.
_Avoid_: Stream tab, player tab

**Drops snapshot projection**:
The state projection that turns Twitch campaign, inventory, hidden refresh, or cached Drops snapshots into DropHunter's campaign-aware app state.
_Avoid_: Drop processing, drops mapper
