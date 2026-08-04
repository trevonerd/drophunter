# DropHunter popup information architecture redesign

## Status

Approved direction: combine concept B's hierarchy and running emphasis with concept C's density and restraint.

The approved mockups are conceptual references, not pixel targets.

The implementation must preserve the current DropHunter design system, campaign browser, campaign-aware identity, queue behavior, and popup width. It must not copy the mockups' oversized typography, illustrative game art, or icon-only queue.

## Goals

- Make Automation, farming session, and Campaigns the only normal top-level information blocks.
- Make the farming-session block the only human-readable source of runtime truth.
- Keep Automation useful but visually subordinate.
- Preserve the current campaign browser anatomy and interactions.
- Preserve queue items as understandable, reorderable blocks and make their geometry consistent.
- Give missing Twitch session state one first-priority message and action.
- Explain unmatched Twitch rewards without presenting them as a farmable campaign.

## Information architecture

Normal state, immediately below the existing popup header:

1. Automation
2. Farming session
3. Campaigns

The popup header keeps the brand and global Monitor, audio, and Settings actions. Pause, Resume, and Stop move into the farming-session block. The header does not repeat a textual `RUNNING`, `PAUSED`, or `RECOVERING` badge.

When the Twitch session is unavailable, a single priority gate appears first and replaces duplicate signed-out/session-sync messages. It contains one title, one sentence, and one `Open Twitch` action. Normal farming and campaign controls remain suppressed until the prerequisite is restored. Automation remains visible below because it is a local preference, but it does not emit activity feedback while it cannot act.

## Automation block

Automation is intentionally quieter than the farming-session block.

- Default border uses `--dh-border`, not the running accent.
- Compact padding follows the existing 8–12px rhythm.
- Heading uses the existing 12px `dh-title` scale.
- Body uses 11px `--dh-text-soft`; no large status icon.
- Copy explains only the outcome: new campaigns for favorite games are added and started automatically when enabled.
- Off state explains that automatic favorite handling is disabled without showing stale events.
- At most one recent automation event appears as a polite status line only when automation is enabled.
- The transient event remains visible for 6 seconds from the event timestamp, then disappears without reserving empty space.

Remove from the main view:

- NOW and NEXT
- next-check countdown
- watch transport and health
- priority-algorithm label
- persistent Activity history
- duplicated `lastAutomationMessage`

Detailed automation policy and transport information remain in Settings or diagnostic surfaces.

## Farming-session block

This is the visually strongest normal block.

- Running uses a 1px `--dh-border-strong` outline, matching concept B without increasing radius or adding a glow.
- Other states use semantic existing tokens: warning for paused/recovering, danger for attention-required, neutral for ready/stopped-manual.
- Typography stays within the existing compact scale: 12px heading, 11–12px subject/reward copy, 10–11px metadata. No mockup-sized headings.
- The first visible line combines runtime mode and game: `Running · ROBLOX`.
- The campaign title remains visible and campaign-aware.
- Running shows reward name, progress, elapsed/required minutes, and ETA when available.
- Paused preserves the same campaign/reward context and percentage.
- Recovering preserves context and one concise retry explanation.
- Ready/stopped contains the contextual Start action; Start is not a detached peer block.
- Pause, Resume, Stop, and Open Twitch appear only when relevant.
- One atomic polite live region owns runtime announcements.

Catalog `Running` badges retain the current active-campaign identification but do not repeat explanatory runtime copy.

## Campaigns block

Preserve the current campaign browser rather than recreating the mockup:

- Existing search field
- Existing sort and favorites filter controls
- Existing game/campaign disclosures
- Existing campaign status indicators
- Existing favorite, Add, Remove, Link, and running semantics
- Existing campaign-aware identity

Syncing, stale, failed, and first-sync feedback become compact inline states inside this block rather than peer cards.

### Queue

The queue remains text-first and reorderable. Do not replace campaigns with logo-only icons.

Queue entries become uniform full-width rows inside the Campaigns block:

- Same minimum height, padding, radius, and internal alignment for every entry
- Position number and drag grip in fixed-width leading slots
- Campaign-aware label gets the flexible middle column and truncates to one line, with its full value preserved in the accessible label and native title
- Optional favorite/status indicators occupy a fixed secondary slot
- Expiry/provenance metadata uses one consistent, single-line secondary row
- Remove action uses a fixed trailing slot
- Drag-and-drop and existing arrow-key reordering remain available
- Drop target uses the existing accent ring
- Automatic priority modes keep reorder disabled with one concise explanation
- `Clear` remains a text action with the existing confirmation behavior

The running campaign is represented by the farming-session block; the queue section labels remaining entries `Queued`, not `Up next` or `NEXT`.

### Other Drops from Twitch

`Unassigned Drops` is renamed `Other Drops from Twitch` and stays inside Campaigns.

- It is shown only in the unfiltered catalog, never in Favorites-only results.
- It is a closed disclosure after normal campaign results.
- Helper copy explains that Twitch did not match the rewards to a currently active campaign and they cannot be queued safely.
- Progress remains visible if present, but no synthetic Add action is created.
- A campaign refresh action is available when refresh is not already running.
- Event/subscription/Twitch-native reward semantics remain unchanged and are never converted to farmable watch-time progress.

## Copy ownership

- Automation owns automation policy and one temporary automation event.
- Farming session owns running/paused/recovering/stopped/ready and Twitch-session-required status.
- Campaigns owns sync, queue action feedback, filtering, and unmatched Twitch reward explanation.
- No status sentence appears in more than one owner.

## Accessibility

- Keep visible focus styles and native button/select/input semantics.
- Queue drag reordering must remain keyboard operable.
- Automation event announces once and disappears silently.
- Farming session is the only runtime `aria-live` region.
- Queue action feedback remains a separate local live region.
- Catalog counts/filtering do not repeatedly announce during polling.
- Color is never the only status carrier.

## Verification

- Source tests assert Activity, NOW/NEXT, duplicate signed-out actions, and detached Start are absent.
- Component tests cover Automation on/off and transient-event expiry.
- Session tests cover ready, running, paused, recovering, stopped, and Twitch-session-required states with campaign-aware labels.
- Queue tests cover uniform row anatomy, drag reordering, keyboard arrows, remove, clear confirmation, and automatic-priority disabled behavior.
- Campaign tests prove Favorites-only suppresses `Other Drops from Twitch`; All shows explanatory copy and refresh without Add.
- Popup is visually checked at 400px with empty, running, paused, signed-out, long-label, and multi-item queue states.
- TypeScript, lint, focused tests, full test suite, and production build pass.

## Non-goals

- No palette, font-family, radius-scale, or icon-system migration.
- No redesign of campaign disclosure rows.
- No change to campaign identity or farming semantics.
- No persistent activity log in the main popup.
- No logo-only queue.
