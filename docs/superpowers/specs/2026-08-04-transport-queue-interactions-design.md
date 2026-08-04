# Transport visibility and queue interaction design

## Goal

Make DropHunter's active watch method immediately understandable, keep managed-tab audio controls contextual, restore direct manipulation of every future queue entry, and prevent hidden farming from competing with real manual Twitch viewing.

## Information architecture

- `SessionSummary` is the only surface that names the active watch method.
- The popup header remains limited to global utilities and contextual managed-tab audio.
- `Farming queue` remains a top-level group between Session and Campaigns.
- The campaign browser reports queue positions, not per-game queue counts.

## Transport presentation

While a farming session is active, SessionSummary shows one compact actual-transport indicator:

- eye-off icon + `Hidden` when `watchTransportMode === 'tabless'`;
- monitor icon + `Tab` when `watchTransportMode === 'managed-tab'`;
- `Manual tab` while detected user playback is carrying or blocking the watch session.

The indicator reflects the effective transport, so a tabless fallback is presented as `Tab`. It adds no health, heartbeat cadence, or implementation diagnostics.

The header mute action renders only when the session is running through a managed tab and `tabId` identifies a DropHunter-owned tab. The persisted mute preference remains available in Settings because it also applies to a future managed-tab fallback.

## Manual Twitch viewing policy

Manual viewing is active only when DropHunter observes a visible, active Twitch tab with a video that is actually playing. A merely open, paused, or non-playing Twitch page does not suspend farming.

During an active farming session:

- eligible manual playback suppresses automated transport ticks and presents manual tracking;
- ineligible manual Twitch playback suppresses automated transport ticks and presents automation waiting;
- ordinary Drops inventory refresh continues, so Twitch remains the progress source of truth;
- when manual playback is no longer detected after the existing telemetry TTL, the previous transport resumes automatically.

There is no concurrent-mode setting. Twitch awards Drop progress for only one channel at a time, so simultaneous manual playback and automation add ambiguity without increasing progress.

## Queue behavior

- The active campaign is owned by SessionSummary and remains excluded from the visible future queue.
- Every visible future row exposes a mouse drag handle, keyboard arrow reordering, and remove action while idle or farming.
- The first direct reorder switches `campaignPriorityMode` to `priority-list-only` atomically with the reorder. No settings detour or explanatory paragraph is added.
- During farming, only future queue indices may move; the selected running campaign cannot be moved or removed through the queue surface.
- A remove response that reports `removed: 0` is surfaced as failure instead of a false success.
- Catalog badges show absolute stored queue positions: `Queue #1`, `Queue #2`, or `Queue #1, #3` for a game group containing multiple queued campaigns. The running campaign uses only `Running`.

## Error handling

- Invalid reorder indices remain fail-closed.
- A running reorder that touches the selected campaign is rejected.
- Queue action failures use the existing single queue live region.
- Manual-view detection failures leave the previous automated transport operating; failure to inspect a user tab must not stop farming.

## Verification seams

- `QueueChips`: mouse/keyboard reorder indices and running removal controls.
- `handleReorderQueue` and `handleRemoveFromQueue`: atomic manual-order transition, running-campaign protection, and truthful removal result.
- `GameCampaignGroup`: absolute queue-position labels across multiple game groups.
- `PopupHeader` and `SessionSummary`: effective transport indicator and contextual mute visibility.
- `detectManualViewing` and farming-session transport tick: actual playback requirement, suppression during manual viewing, and automatic resume.
- Headed Chromium extension QA at 400px: drag, remove, labels, transport modes, mute visibility, and zero horizontal overflow.

## Scope boundaries

- No new preference, analytics, notification, color token, radius, scroll container, or decorative animation.
- No promise of faster progress from simultaneous Twitch sessions.
- Managed-tab remains the default preference; tabless remains an explicit user choice with managed fallback.
