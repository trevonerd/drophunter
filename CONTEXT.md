# DropHunter Context

Shared language for DropHunter's Twitch Drops farming domain. Use these terms when naming modules, tests, and agent notes.

## Language

**Authorized session target**:
A campaign identity retained until explicit retirement, positive acquisition proof, or a valid expiry. Its absence from available candidates never removes the objective. All targets must be acquired or expired before automatic termination.

**Streamer watch attempt**:
A normalized channel reserved and persisted before preparation, plus observation start and optional first verified playback. Opening failure, blocked playback and confirmed progress stalls share a maximum of four distinct channels per campaign cycle.

**Acquisition round**:
The authorized queue pass that records tried campaign keys. When unresolved targets cannot start, the session suspends playback and schedules a real ten-minute retry. Explicit Retry or Play opens a new cycle without bypassing proven HTTP cooldown.

**Campaign failure episode**:
A persistent campaign-specific problem identity spanning retries and browser restarts. Each enabled notification channel has its own receipt. Only verified progress, acquisition, expiry or explicit retirement resolves it; hiding its message changes no farming decisions.


**Twitch Drops campaign**:
A Twitch-defined reward campaign for one game or category, identified by `campaignId` when Twitch provides it.
_Avoid_: Plain game, game-only campaign

**Farming session**:
The active DropHunter run that watches an eligible Twitch stream, tracks Drop progress, handles recovery, and advances the queue.
_Avoid_: Monitor loop, queue runner, farming service

**Manual pause and stop**:
Pause persists the authorized queue and position while playback and monitoring remain stopped until an explicit Resume or Start. Stop persists a manual stop reason, ends the session, and clears manual queue authorization until an explicit Start. Turning favorite auto-start on explicitly may clear either block; merely adding a favorite does not restart farming.
_Avoid_: Pause or Stop automatically restarting favorite farming

**Startup auto-resume**:
Recovery of a farming session that was active when the browser stopped, once Twitch is available. The retired `autoResumeOnStartup` preference does not block this recovery. Manual Pause and Stop remain authoritative; authorized queues waiting for streamers or scheduled rewards continue their checks.
_Avoid_: Resume after any browser restart

**Farming automation**:
The DropHunter orchestration that selects eligible Twitch Drops campaigns and automatically starts or preempts farming sessions in response to browser lifecycle and campaign changes.
_Avoid_: Auto-start coordinator, automatic farming session, favorite-game automation

**Authorized manual queue**:
A queue the user has explicitly started, whose manual campaigns may continue after an intervening favorite campaign. Adding campaigns alone does not authorize their playback.
_Avoid_: Any non-empty queue, automatic queue

**Queued campaign Play**:
An explicit request that makes a queued campaign the farming target and queues the previous campaign. The click persists this intent and wakes the normal farming alarm; the same farming flow owns streamer acquisition, progress checks, recovery and progression. If the requested campaign cannot start, it is parked and normal queue order selects the next authorized target.
_Avoid_: Queue player, second farming loop

**Favorite campaign preemption**:
The replacement of the active campaign by a newly discovered favorite campaign with a known, strictly earlier expiry and a proven eligible streamer; the interrupted campaign remains next in the queue.
_Avoid_: Streamer rotation, queue reset, equal-expiry preemption

**Authoritative campaign refresh**:
A successful, complete Twitch campaign refresh that can prove whether a specific campaign and its farmable rewards still exist. Timeouts, failed requests, partial snapshots, and cached data are not authoritative.
_Avoid_: Any refresh, cached refresh, empty response

**Unfarmable campaign**:
A campaign with no currently automatable reward. Missing data, failed claims and nonautomatable rewards leave its authorized session target unresolved; absence alone never proves expiry or acquisition.
_Avoid_: Stalled campaign, temporarily missing campaign, offline streamer

**Parked campaign**:
A still-valid campaign temporarily moved behind other queued work because no eligible streamer is currently available; it remains eligible for future refreshes and retries.
_Avoid_: Skipped campaign, removed campaign, unfarmable campaign

**Queue progression**:
The transition from the current Twitch Drops campaign to the next authorized farmable campaign, preserving queue order while refreshing campaign evidence, waiting for scheduled rewards, and parking temporarily unavailable campaigns.
_Avoid_: Queue loop, next-game handling

**Watch handoff**:
The prepare-then-promote transition that publishes the new campaign, streamer, rewards and ownership together. Managed changes navigate the same owned tab; the old channel is no longer presented as active during navigation. Superseded cleanup cannot pause or roll back a newer navigation.
_Avoid_: Player swap, transport restart, close-then-open

**Watch start result**:
The outcome of one specific playback attempt: started, failed, or cancelled. A healthy incumbent is not evidence that its replacement started. Campaign, streamer, reward projection and watch ownership are published together after preparation and persistence succeed.
_Avoid_: Treating current watch health as replacement success

**Playback readiness**:
Observed advancement of the managed video's playback time. Opening a tab, resolving play(), or accepting a heartbeat does not prove reward progress; only campaign-aware Twitch reward evidence does that.
_Avoid_: Tab opened means farming works

**Initial playback gesture wait**:
An authorized managed watch awaiting an initial gesture after confirmed autoplay refusal, or after Twitch pauses the same video despite its verified paused Play control before any user activation. This wait uses the ordinary duration-based observation window and streamer budget. One first verified video start may grant a full window once per attempt; buffering, player replacement and a control's displayed state do not confirm playback or reward progress.
_Avoid_: No eligible streamer, stalled campaign

**Streamer availability evidence**:
Verified eligible directory or direct-channel results, supplemented by recent authoritative reward progress for the incumbent campaign. An unavailable verification is unknown; exhausted alternatives and failed playback do not establish that no streamer exists.
_Avoid_: Directory failure means zero availability

**User status**:
The single concise explanation of what farming is doing and what happens next, shared by the popup and monitor. It contains one state, one reason, and an optional retry time; internal attempt counters and transport diagnostics stay out of the user flow.
_Avoid_: Debug status, recovery trace, polling status

**Notification event**:
A durable farming transition delivered independently to enabled browser and Telegram channels, with one receipt per channel. Routine retries and internal recovery attempts are not notification events.
_Avoid_: Retry log, channel-specific event, polling alert

**Recorded claim**:
A reward acquisition saved to the local claim log under its campaign-aware drop identity. Repeated observations do not increase the lifetime count or resend claim alerts. Browser and Telegram delivery are independent; refreshes that suppress browser alerts still record claims and retain Telegram delivery.

**Confirmed progress stall**:
The absence of authoritative watch-time progress for the configured stall window. Stream metadata such as offline status, category mismatch, or missing Drops labels is diagnostic evidence only after this condition is established.
_Avoid_: Stream metadata mismatch, single missed poll, transport repair

**Real authentication failure**:
An explicit invalid-OAuth response that remains unresolved after one silent session resynchronization attempt from the user's Twitch browser context.
_Avoid_: Network failure, Twitch service failure, expired integrity token, missing cached session

**Farming-complete campaign**:
A campaign display classification with no remaining automatically farmable reward. It does not prove acquisition and cannot terminate an authorized unresolved target.
_Avoid_: Completed campaign, all rewards claimed

**Managed farming tab**:
The single browser tab DropHunter owns for farming. Changes reuse its ID; only positively established absence permits recreation. Pause, Stop and tabless switching suspend its player and retain the tab.
_Avoid_: Stream tab, player tab

**Hidden farming transport**:
The farming mode that runs without a viewing tab. Failures use the same bounded attempts and queue rounds as managed farming, without a managed-tab fallback. Login and Drops service pages are separate.
_Avoid_: Background tab, guaranteed tabless playback

**Manual Twitch viewing**:
A Twitch stream playing in a user-controlled tab, including a background tab, which takes precedence over automated playback whether or not it earns Drops.
_Avoid_: Managed farming tab, Hidden farming transport

**Manual-watch decision**:
The pure transition from the latest manual-tab classification and durable farming facts to the next manual-watch fact. Observation, storage, wake scheduling, and transport suspension are effects applied after this decision.
_Avoid_: Manual-tab scan, transport transaction

**Stalled campaign exclusion**:
Historical campaign block metadata retained for migration compatibility. Current farming parks failed targets within an acquisition round and retries unresolved targets after ten minutes.
_Avoid_: Expired campaign, unfarmable campaign, timed retry

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
