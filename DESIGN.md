# DropHunter Design System

This is the implementation contract for the popup and live-monitor control surfaces, including the compact game/campaign browser redesign. The approved direction is fixed at DESIGN_VARIANCE: 3, MOTION_INTENSITY: 2, and VISUAL_DENSITY: 7: predictable, dense, and operational. Preserve the current dark violet language and the existing tokens below. Do not invent a new palette, type family, radius scale, or animation vocabulary for this work.

## 1. Atmosphere & Identity

DropHunter feels like a compact operations console: dark, high-signal, and calm while a farming session runs in the background. The signature is a violet-to-blue light band over layered dark-violet surfaces, with short status labels and progress rails making the current Twitch campaign state scannable in one glance. The popup is the control surface; the monitor is its always-on live readout. Density is intentionally high, but hierarchy comes from tonal shifts, borders, and concise status copy rather than ornamental cards.

This is an existing-system extraction. The source surfaces are src/popup/index.css, src/monitor/monitor.css, src/popup/App.tsx, src/popup/components/*.tsx, src/popup/components/icons.tsx, src/monitor/App.tsx, and their entrypoint HTML files. The shared runtime vocabulary comes from src/shared/runtime-status.ts, src/shared/game-selection.ts, and the reward/drop types consumed by the views.

## 2. Color

### Theme behavior

- Both surfaces set color-scheme: dark on :root.
- There is no light-mode token set, [data-theme] switch, or prefers-color-scheme: light branch. Browser controls and all product surfaces are intentionally dark today.
- Popup and monitor each declare their own :root. They share names, but the monitor changes some alpha values. Treat those differences as existing surface-specific behavior, not as permission to consolidate them during UI work.
- The popup viewport and monitor background use the same three-stop 135-degree linear gradient. The popup paints it once on `html`, fixed and non-repeating, while `body` and `.dh-view` remain transparent; the monitor adds a violet radial glow at the top-right.

### Semantic palette (exact source values)

| Role | Token | Popup value | Monitor value | Current usage |
| --- | --- | --- | --- | --- |
| Background 0 | --dh-bg-0 | oklch(0.145 0.014 292) | oklch(0.145 0.014 292) | First stop of popup/monitor page gradient |
| Background 1 | --dh-bg-1 | oklch(0.18 0.016 292) | oklch(0.18 0.016 292) | Middle gradient stop |
| Background 2 | --dh-bg-2 | oklch(0.22 0.018 292) | oklch(0.22 0.018 292) | Final gradient stop |
| Surface 1 | --dh-surface-1 | oklch(0.245 0.024 292 / 0.76) | oklch(0.245 0.024 292 / 0.88) | .glass, .dh-panel, monitor card |
| Surface 2 | --dh-surface-2 | oklch(0.285 0.03 292 / 0.82) | oklch(0.285 0.03 292 / 0.84) | .glass-dark, strong/drop/empty monitor surfaces |
| Surface 3 | --dh-surface-3 | oklch(0.34 0.04 292 / 0.48) | not declared | Subpanels, queue chips, compact controls |
| Border | --dh-border | oklch(0.48 0.05 292 / 0.36) | oklch(0.48 0.05 292 / 0.42) | Default 1px panel/divider border |
| Strong border | --dh-border-strong | oklch(0.58 0.08 292 / 0.52) | not declared | Hover/focus-adjacent input and selected-control border |
| Primary text | --dh-text | oklch(0.96 0.006 292) | oklch(0.96 0.006 292) | Headings, values, body text |
| Soft text | --dh-text-soft | oklch(0.82 0.018 292) | oklch(0.82 0.018 292) | Secondary copy and monitor idle pill |
| Muted text | --dh-muted | oklch(0.68 0.025 292) | oklch(0.68 0.025 292) | Helper text, metadata, timestamps |
| Faint text | --dh-faint | oklch(0.55 0.03 292) | not declared | Dividers-in-copy, subdued labels |
| Accent | --dh-accent | oklch(0.66 0.24 302) | oklch(0.66 0.24 302) | Primary action, progress start, queue target ring |
| Strong accent | --dh-accent-strong | oklch(0.73 0.2 305) | oklch(0.73 0.2 305) | Hover action, focus-adjacent border, scrollbar gradient |
| Accent ink | --dh-accent-ink | oklch(0.18 0.06 296) | not declared | Text/icons on the bright popup header and primary accent actions |
| Info | --dh-info | oklch(0.72 0.14 240) | not declared | Reserved informational semantic token |
| Success | --dh-success | oklch(0.72 0.16 150) | oklch(0.72 0.16 150) | Reserved success semantic token; running/claimed utilities also exist |
| Warning | --dh-warning | oklch(0.8 0.16 85) | oklch(0.8 0.16 85) | Claimable, paused/recovering, retry copy |
| Danger | --dh-danger | oklch(0.67 0.19 25) | not declared | Reserved error/destructive token |
| Focus | --dh-focus | oklch(0.86 0.12 306 / 0.88) | not declared | 2px box-shadow focus ring |

### Timing and runtime custom properties

--dh-ease is cubic-bezier(0.22, 1, 0.36, 1). Progress bars receive the inline custom property --dh-progress as a normalized 0-1 value and render it with transform: scaleX(...); it is not a color token, but it is part of the shared visual contract.

### Tailwind extension tokens used by the surfaces

tailwind.config.js extends the twitch family with these exact values:

| Utility | Value |
| --- | --- |
| twitch-purple | oklch(0.66 0.24 302) |
| twitch-purple-dark | oklch(0.56 0.25 302) |
| twitch-purple-darker | oklch(0.45 0.24 302) |
| twitch-dark | oklch(0.18 0.014 292) |
| twitch-dark-light | oklch(0.22 0.018 292) |
| twitch-dark-lighter | oklch(0.27 0.022 292) |

The affected JSX uses twitch-purple, twitch-purple/80, twitch-dark, and border-twitch-purple directly. It also uses Tailwind status aliases (blue-300, green-200/400/500, orange-400, purple-100/300/400/500, red-300/400/500, and yellow-200/300/500) with opacity modifiers. Their emitted values come from the installed Tailwind version rather than local declarations; keep these existing aliases stable until a token migration is explicitly approved.

### Existing raw OKLCH literals

The following literals are present in CSS today and must be treated as existing debt, not copied into new selectors. They cover header gradients, semantic fills, hover states, status pills, input/track fills, and the coffee action:

~~~text
oklch(0.16 0.015 292)
oklch(0.18 0.04 296 / 0.14)
oklch(0.18 0.06 296)
oklch(0.18 0.06 296 / 0.12)
oklch(0.18 0.06 296 / 0.2)
oklch(0.18 0.06 296 / 0.56)
oklch(0.2 0.03 95)
oklch(0.25 0.07 296 / 0.82)
oklch(0.34 0.08 85 / 0.5)
oklch(0.34 0.08 150 / 0.5)
oklch(0.36 0.02 292)
oklch(0.38 0.02 292)
oklch(0.38 0.02 292 / 0.52)
oklch(0.42 0.025 292 / 0.72)
oklch(0.5 0.15 246)
oklch(0.55 0.2 304 / 0.65)
oklch(0.57 0.15 246)
oklch(0.58 0.045 292 / 0.4)
oklch(0.64 0.16 150 / 0.9)
oklch(0.66 0.23 302)
oklch(0.66 0.24 302 / 0)
oklch(0.66 0.24 302 / 0.45)
oklch(0.67 0.19 25)
oklch(0.72 0.018 292)
oklch(0.72 0.14 240)
oklch(0.72 0.16 150 / 0.45)
oklch(0.73 0.19 304)
oklch(0.73 0.19 335)
oklch(0.78 0.14 150 / 0.7)
oklch(0.78 0.18 305)
oklch(0.8 0.15 304)
oklch(0.8 0.16 85)
oklch(0.8 0.16 85 / 0.45)
oklch(0.8 0.16 85 / 0.55)
oklch(0.82 0.09 304)
oklch(0.86 0.11 150)
oklch(0.86 0.12 306 / 0.18)
oklch(0.88 0.17 95 / 0.9)
oklch(0.9 0.12 85)
oklch(0.91 0.18 95)
oklch(0.97 0.008 292)
oklch(0.98 0.01 292 / 0.24)
oklch(0.55 0.03 292)
oklch(0.82 0.018 292)
oklch(0.86 0.12 306 / 0.88)
oklch(0.96 0.006 292)
~~~

The source also contains the fallback #f04f4f in var(--dh-danger,#f04f4f), transparent track/header utilities, and the CSS gradients described above. No new raw color should be added without first extending this section and the source token strategy.

## 3. Typography

### Font stack

Both surfaces use the same system stack, with Inter first:

~~~text
'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif
~~~

There is no mono or serif face. Do not load a new font for the planned indicator primitive. Inter is an existing operational choice and is recorded as debt only where it conflicts with a future brand decision.

### Observed scale

| Level in use | Size | Weight/line behavior | Examples |
| --- | --- | --- | --- |
| Statistic value | 1.125rem / 18px | font-bold, leading-none | Settings totals |
| Monitor title / drop name | 15px / 14px | 700 | monitor-title, monitor-drop-name |
| Compact body | Tailwind text-sm / 14px | 400-700 | About copy, empty-state emphasis |
| Default compact body | Tailwind text-xs / 12px | 400-700 | Panel headings, sync descriptions, reward empty state |
| Metadata / status | 11px | 400-700, sometimes leading-tight/leading-snug | Queue, progress row, helper and live status text |
| Micro-label | 10px | 400-700, often uppercase/tracked | Monitor timestamp/pill, setting labels, log counts |
| Runtime badge | 0.625rem / 10px | 700, line-height 1rem | RUNNING/PAUSED badge |

Weights observed are default 400, medium 500, semibold 600, .dh-title 650, bold 700, and extra-bold 800. Existing labels use tracking-wide or tracking-[0.14em]; there is no display tracking scale. text-[11px] is common by design because this is a dense extension surface.

The small 10-12px sizes are accepted operational density, but they are below the usual 14px body recommendation. Preserve the semantic labels and verify contrast/zoom rather than making a global size change during indicator work.

## 4. Spacing & Layout

### Base unit and existing tokens

The intended base unit is 4px (0.25rem). Only the following spacing variables exist:

| Token | Value | Typical usage |
| --- | --- | --- |
| --dh-space-1 | 0.25rem / 4px | Header action gap |
| --dh-space-2 | 0.5rem / 8px | Group gap, header grid/brand gap |
| --dh-space-3 | 0.75rem / 12px | Page stack gap and padding |
| --dh-space-4 | 1rem / 16px | Wide view horizontal padding |
| --dh-space-6 | 1.5rem / 24px | Reserved token; no dominant affected-surface declaration |

Most JSX uses Tailwind spacing utilities that resolve to the same 4px rhythm: gap-1 (4), gap-1.5 (6), gap-2 (8), gap-2.5 (10), gap-3 (12), px-2/py-2 (8), px-3/py-3 (12), px-4 (16), py-1.5 (6), and mt-3 (12). Monitor CSS additionally uses 3px, 6px, and 10px values. Those half-step and odd values are existing debt; do not silently consolidate them.

### Surface dimensions and scroll ownership

| Surface | Bounds | Fixed regions | Scroll owner |
| --- | --- | --- | --- |
| Popup | html { min-height: 100%; continuous viewport background }, body { width: 400px; }, body and #root { min-height: 128px; }, #root { width: 100%; }; no height cap | Header and the primary farming action remain in normal document flow above campaign discovery; settings/log headers are part of each view | Popup body owns the only primary vertical scroll (overflow-y: auto) and hides horizontal overflow. GameCampaignBrowser remains in document flow and must not create a second scrollbar. ClaimLogView retains its named fixed 440px virtualized-list scroll container because it is a separate view. |
| Monitor | body { min-width: 320px; min-height: 270px; }, #root { width: 100%; height: 100%; } | No sticky/fixed header; one card contains the complete readout | No scroll owner: body is overflow: hidden. Content must fit the window; clipping is a failure to investigate at narrow/long-content sizes. |

dh-page is the popup vertical stack (display: flex; flex-direction: column; gap: var(--dh-space-3); padding: var(--dh-space-3)). dh-page--wide changes only inline padding to var(--dh-space-4). dh-group is a vertical stack with an 8px gap; dh-group--loose uses 12px. dh-popup-header is a two-column shell (minmax(0, 1fr) max-content) with an 8px gap. Header actions are an inline cluster. The farming queue is a full-width top-level group between SessionSummary and Campaigns, not part of the campaign search/filter cluster and not an independent scroll pane.

## 5. Components

The following primitives and repeated components are the reusable surface language. Each must keep the existing tokens, states, and semantics when reused. The planned CampaignStatusIndicators is a documentation-level primitive for the next UI pass; it does not authorize new source tokens.

### dh-view, dh-page, dh-group, and dh-contain

- Structure: view background → vertical stack (dh-page/dh-group) → children; dh-contain adds contain: layout style to a bounded region.
- Variants: normal page, dh-page--wide, loose group.
- Spacing: --dh-space-1/2/3/4; Tailwind 4px utilities around children.
- States: normal, loading/empty/error supplied by child panels; containment must not hide focus or status text.
- Accessibility: preserve document order, reachable controls, and status text; no overflow on the stack itself.
- Motion: none; child transitions only.
- Layout/scroll: popup page participates in body scroll; monitor shell has no scrolling.

### dh-panel, dh-panel-strong, .glass, .glass-dark, and dh-subpanel

- Structure: bordered surface containing a heading, copy, controls, or list rows.
- Variants: surface 1/default, surface 2/strong, .dh-subpanel surface 3 without a border, legacy .glass and .glass-dark aliases.
- Spacing: component content supplies px-3 py-2/2.5/3; monitor card/drop/empty supply 8-10px CSS padding.
- States: default, hover/focus on contained controls, loading, empty, error; no surface hover elevation exists.
- Accessibility: keep heading/readout contrast and expose panel status through child role=status/aria-live where relevant.
- Motion: no panel animation; control transitions are 180ms.
- Layout/scroll: panels do not scroll by themselves except the explicit reward and claim-log list wrappers.

### Popup header and icon actions

- Structure: .dh-header gradient → .dh-popup-header grid → brand and a compact global-action cluster. Settings and log reuse the same header treatment with a back icon. Runtime state never appears here because SessionSummary owns it.
- Variants: every state shows Monitor and Settings; running exposes farming-tab audio only when the effective transport is a DropHunter-owned managed tab. Hidden/tabless farming never renders an audio action. Pause, resume, stop, Start, Twitch sign-in, notification configuration, and Twitch Drops access remain in their owning task surfaces.
- Spacing: 12px horizontal/8px vertical header padding; 8px brand/grid gap; 4px action gap; icon buttons are 28×28px with 6px radius.
- States: default, hover translucent light fill, active darker fill, disabled opacity, and visible 2px focus ring.
- Accessibility: every icon-only button has an aria-label and title; SVGs are aria-hidden; focus uses .dh-focus/.dh-icon-button:focus-visible.
- Motion: 180ms background/color/opacity transitions; no entry animation.
- Layout/scroll: fixed-width grid region inside the popup's body scroll owner; header itself is not sticky.

### AutomationSummary

- Structure: a compact inline control row headed `Favorite auto-start` and its switch control. The switch position and semantic on/off color indicate resting state; no duplicate On/Off text is shown. When enabled, at most one meaningful recent automation event may appear below it for exactly six seconds.
- Queue ownership: a favorite is category-level. In `priority-list-only` mode automation may own at most one queued campaign for each favorite category. A manually queued campaign already represents that category and is never removed; terminal or redundant `favorite-auto` siblings are pruned on the next evaluation.
- Copy ownership: it controls only favorite-campaign auto-start. It never repeats the active campaign, queue order, runtime state, transport mode, health, polling cadence, `Now`/`Next`, or the same activity in another panel.
- Variants: on, off, enabled with a transient event, and notification-permission denied. No event is shown while automation is off or the Twitch session is unavailable.
- Spacing and hierarchy: 12px heading, 10px event copy, compact 8px vertical/10px horizontal subpanel padding, no large icon or decorative glow.
- Accessibility: the control is a native button with `role=switch` and `aria-checked`; transient activity and permission feedback use concise polite live regions.

### SessionSummary

- Structure: one persistent compact operational section below AutomationSummary. Its first line pairs state and campaign (`Running · Game · Campaign`); a compact trailing indicator names the effective watch source (`Hidden`, `Tab`, `Fallback tab`, or `Manual tab`) without exposing health or cadence diagnostics. Running reuses the standard compact reward row and actions stay inside the section.
- Variants: ready, running, paused, recovering, complete, and attention-required. Running/complete use success accents; paused/recovering use warning accents; attention-required uses the existing danger or violet accent treatment; ready uses neutral surface tokens.
- Spacing: inline `dh-contain` panel with 12px padding and the existing 8px internal rhythm. The running variant uses `--dh-border-strong` without glow; type remains in the 10-12px compact scale.
- States: idle names the selected campaign or asks for a selection; running presents the active reward exactly once through `CompactDropCard`; paused and operational farming recovery preserve the compact progress readout while explicitly saying progress is not advancing; actual manual Twitch playback suppresses automated transport ticks and appears here as tracking or waiting until the existing TTL expires; browser-restart recovery remains internal and is never rendered; terminal states explain what happens next. Campaign sync, background Twitch-session retries, and ordinary watch-health details do not belong here.
- Actions: Start when idle; Pause and Stop while running; Resume and Stop while paused; Stop while recovering; Open Twitch for a terminal sign-in requirement.
- Accessibility: one child `role=status`, `aria-live=polite`, `aria-atomic=true` text region. Interactive controls sit outside it. Machine-readable `data-session-mode` and `data-progress-state` attributes mirror visible truth without adding announcements.
- Motion: state changes are immediate; no pulse, animation, or live dot.
- Layout/scroll: normal popup flow with no nested scroll; long campaign and reward names wrap inside `min-w-0` content.

### Farming queue and campaign browser

- Structure: Farming queue is a separate operational group between SessionSummary and Campaigns. It owns queue feedback and controls. Campaigns owns sync status, selected-campaign status, search, filters, and the existing grouped campaign browser. The queue is an ordered full-width list whose rows share fixed slots for order/grip, campaign text, indicators, metadata, and remove.
- Variants: no selection, selected campaign, selector hidden while running, onboarding pulse, selected-not-in-queue first row, draggable/reorderable future queue, running queued list that excludes and protects the current campaign, clear confirmation. The first direct reorder atomically switches automatic priority to manual order.
- Spacing: selector cluster gap 6px; control padding 8px/6px; queue rows use a consistent compact height, 8px rhythm, 8px radius, and one-line truncating text regions.
- States: default, hover border, focus ring, action loading, queue message, drag target ring, clear confirmation. Queue feedback remains visible for six seconds; a newer message replaces it and restarts dismissal. Future rows remain reorderable and removable while farming; only the current campaign is immutable.
- Accessibility: select has aria-label=Campaign; queue/remove/clear/reorder controls have explicit labels; reorder also supports arrow keys; queueMessage is role=status aria-live=polite aria-atomic=true.

### Farming actions and GameCampaignBrowser

- The full-width Start control belongs inside SessionSummary so the current state and its next action remain one unit. Pause, Resume, and Stop follow the same ownership rule. Twitch access is requested only by the dedicated gate when first connection or a terminal blocked state makes further farming impossible.
- GameCampaignBrowser groups Twitch Drops campaigns by Twitch category identity and renders each category as a compact master/detail disclosure. Every game starts collapsed. Only one game may be expanded at a time so discovery stays dense and predictable.
- The closed game row is a 40px operational summary: disclosure chevron, one-line game name, campaign count, semantic status badges, favorite star, and a compact Add action for the next eligible unqueued campaign. The row itself is the disclosure control; star and Add remain separate buttons and must not toggle it.
- Summary badges use existing semantic tokens and visible text: `Complete` when every campaign is farming-complete, `Not linked` when any campaign needs account linking, and absolute queue positions (`Queue #1`, `Queue #1, #3`) when campaigns from the game are queued. The active campaign uses only `Running`. Color never carries status alone.
- Expanding a game reveals one flat detail surface. Campaigns are separated by dividers rather than nested cards. Each campaign shows title, expiry/next-reward metadata, campaign-aware Add/Remove, and a safe external Link action when required. Farmable Drops render immediately as compact rows inside the expanded game; there is no second campaign-level accordion. Farming-complete campaigns remain one compact campaign line with a `Complete · 100%` badge and no reward rows or queue actions.
- The game-level Add action targets the first connected, farming-eligible, unqueued campaign in the current calculated order. Precise campaign choice and removal remain available inside the expanded detail. It is disabled when no eligible campaign remains.
- Favorite and Add controls use a minimum 28px square target. The disclosure control has a visible focus ring, `aria-expanded`, and `aria-controls`; its chevron rotates through transform only. Expanded content is not animated by height.
- Each category has one persistent preference: normal, favorite, or hidden. Hidden categories are omitted from Available and automation, but remain recoverable from the Hidden filter. The star remains visible; an eye-off action occupies a stable 28px slot revealed on row hover or keyboard focus.
- Hidden rows replace queue actions with Restore; the star restores directly as favorite. Hiding/restoring emits a six-second polite inline status with Undo. Existing running sessions remain untouched, and retained queue entries are never silently removed.
- Motion: onboarding pulse-glow is a 2s infinite attention cue; disclosure/action feedback uses the existing 180ms easing and transform/opacity only. Reduced-motion collapses it to an immediate state change.
- Layout/scroll: the browser remains in popup document flow. Neither the game list nor expanded campaign/Drop detail owns a scrollbar; the popup body is the sole discovery scroll owner.

### CampaignSyncPanel, OtherDropsDisclosure, and planned CampaignStatusIndicators

CampaignSyncPanel is the current sync-status panel. CampaignStatusIndicators is the planned semantic primitive for Todo 13/14 and must be expressible with this existing system only.

- Structure: CampaignSyncPanel is a compact inline status row inside Campaigns, with one concise message and either a spinner or action button. OtherDropsDisclosure is a closed disclosure after normal results for Twitch rewards that cannot be matched to an active campaign. The planned primitive may compose a compact cluster of status pills/text and a live region without changing panel geometry.
- Variants: fresh (sync row omitted), syncing, stale, failed, and empty; signed-out uses the dedicated priority TwitchSessionGate before AutomationSummary and suppresses SessionSummary and Campaigns. Planned reward variants remain pending, active, claimable, claimed, subscription-gated, and unverifiable Twitch-native.
- Token mapping: syncing/info uses existing blue/info or accent utilities; running/claimed uses --dh-success/existing green utilities; paused/recovering/claimable uses --dh-warning/existing yellow utilities; stopped/error/unverifiable-twitch uses --dh-danger/existing red utilities (or the existing warning copy when the state is informational); idle uses surface/text-soft. No new hue, alpha, radius, or shadow is permitted.
- Spacing: compact 8px inline sync row and 8px/12px stack gaps. Indicators should use the existing 10-12px status scale and pill radius only where a pill already exists.
- States: default, loading (aria-busy plus existing spinner), success/fresh omission, empty, stale cached data, and failed refresh with actionable copy. Other Drops appears only for the unfiltered All view with an empty search, preserves Twitch progress, never offers a synthetic Add action, and provides an Open Twitch Drops action.
- Accessibility: the section remains aria-label=Campaign sync status, aria-live=polite, and aria-busy while syncing. A future indicator live region should announce meaningful transitions once, not every polling tick; retain role=status and aria-atomic=true for concise action feedback.
- Motion: existing spinner only for active sync; 180ms control transitions. Status changes should be immediate or opacity/transform-only at MOTION_INTENSITY: 2.
- Layout/scroll: inline panel in the popup body; no nested scroll.

### RewardList, CompactDropCard, and progress rail

- Structure: dh-panel heading row → loading row, scrollable compact drop rows, or empty copy; completed rewards render in a native disclosure with a `Completed (N)` summary and structured list. While farming, the active reward belongs only to the Running section, Pending contains only not-yet-started rewards, and the Pending panel is omitted when that filtered group is empty. Each reward row has an image/initial fallback, name/status, and a progress rail.
- Variants: pending, loading, sync-loading (reduced opacity), empty, completed summary, claimed, claimable, active, pending, event/sub-only, and unverifiable Twitch-native reward.
- Spacing: heading px-3 py-2; row px-3 py-2 with 10px gap; progress rail uses 4px height in popup and 8px in monitor; reward list max-height 240px.
- States: default, image error fallback to reward initials, loading spinner, event-based disabled opacity, claimable warning fill, claimed green label, active blue label, pending muted label, and an explicit unverifiable qualifier that does not imply a newly available 0% reward is complete.
- Accessibility: images carry the reward name as alt text; failed images preserve initials; loading uses aria-live=polite; watch-time progress rails expose reward-specific progressbar semantics and numeric values; the completed disclosure uses native details/summary and list semantics. Do not encode event/subscription-only as watch-time progress.
- Motion: progress uses transform: scaleX(--dh-progress) with 500ms popup / 400ms monitor easing; reduced-motion media rule collapses the transition.
- Layout/scroll: reward rows are the popup's named nested scroll owner; monitor progress is contained by the card and cannot scroll.

### SettingRow, dh-switch, and Telegram form controls

- Structure: bordered dh-panel row with title/copy and a native button role=switch; Telegram extends the pattern with labeled password/text inputs, save/test actions, disclosure guide, and status message.
- Variants: on/off, disabled-before-configuration, warning/permission-denied, credentials saved/error, setup guide closed/open, streamer-selection pressed/unpressed.
- Spacing: panel px-3 py-2.5; row gap 12px; switch has a 36×28px interactive target containing a 34×20px full-pill track and 14px thumb; form groups use 8px vertical spacing.
- States: default, hover, active, focus-visible ring, on/off thumb transform, busy disabled, warning/error status, disclosure expanded/collapsed.
- Accessibility: native buttons and inputs, labels above fields, role=switch plus aria-checked, aria-expanded on guide, and role=status aria-live=polite for warnings/action feedback. Never use placeholder text as the only label.
- Motion: switch thumb translates 11px over 180ms; track background/border transition 180ms; no disclosure animation exists.
- Layout/scroll: settings content uses popup body scroll; no nested form scroll.

### Claim log virtualized list

- Structure: header/back bar → dh-panel summary/clear action → loading/error/empty state or 440px virtualized ul grouped by campaign.
- Variants: loading, fetch error, empty, populated, clear confirmation, clear error; campaign header rows and reward entry rows.
- Spacing: fixed row heights are 28px (campaign header) and 44px (entry); row padding is 12px; thumbnails are 28px.
- States: default, lazy image fallback, loading spinner, error status, empty status, clear/confirming clear.
- Accessibility: list has aria-label=Claimed drops by campaign; status states use polite live regions; clear button exposes confirm intent in its label; back action is labeled and focusable.
- Motion: only existing 180ms controls/spinner; virtualization changes position without animated layout.
- Layout/scroll: the 440px overflow-y-auto list is the sole claim-log list scroll owner; popup body remains the outer owner.

### Monitor card and live status pill

- Structure: monitor-shell → monitor-card → header/title/subtitle plus runtime pill plus nearest-drop panel or empty panel plus recovery/stop reason plus footer channel/timestamp.
- Variants: RUNNING, PAUSED, RECOVERING, STOPPED, IDLE; nearest reward vs no pending reward; active streamer vs no active streamer.
- Spacing: shell 8px, card 10px, header gap 8px, drop/empty padding 8px, progress top gap 10px, footer top gap 8px with 6px divider padding.
- States: running green pill, paused/recovering yellow pill, idle neutral pill, terminal stop reason, empty reward readout, updated timestamp, recovery retry countdown.
- Accessibility: status text is visible and concise; future updates should use one polite live region around changed status rather than repeatedly announcing the entire card. Preserve readable names and percentages.
- Motion: progress transform 400ms; recovery clock updates once per second in React while recovering; no decorative loop.
- Layout/scroll: monitor body is overflow:hidden and the card is not scrollable. This is intentional compact-window behavior but must be stress-tested for long campaign labels.

### Icon primitive

src/popup/components/icons.tsx provides small currentColor SVG icons at 12-16px. They are aria-hidden and only appear inside labeled controls or alongside text. `EyeOffIcon` represents hidden/tabless watching and the existing monitor family represents a managed tab. Keep one visual family and currentColor inheritance. The hand-authored SVG paths are existing source debt; do not introduce a second icon style while extracting or implementing indicators.

## 6. Motion & Interaction

### Existing timing contract

| Interaction | Duration/easing | Property | Meaning |
| --- | --- | --- | --- |
| Icon/header/input/action controls | 180ms, --dh-ease | background, color, border-color, opacity, box-shadow | Hover, focus, active, and disabled feedback |
| Popup progress rail | 500ms, --dh-ease | transform: scaleX(...) | Smoothly tracks watch progress |
| Monitor progress rail | 400ms, --dh-ease | transform: scaleX(...) | Compact live progress update |
| Spinner | 1s linear infinite | transform: rotate(360deg) | Indeterminate sync/loading feedback |
| Onboarding pulse | 2s --dh-ease infinite | box-shadow spread | Draws attention to the next onboarding control |
| Scrollbar hover | 180ms, --dh-ease | background (and existing width change) | Pointer feedback on the popup scrollbar |

At MOTION_INTENSITY: 2, motion is restrained and state-led. Do not add scroll choreography, parallax, magnetic behavior, or decorative looping. A new status primitive should use immediate state changes or the existing 180ms feedback; a live pulse is justified only when it communicates an active state and must remain subtle.

Both stylesheets include the same reduced-motion override:

~~~css
@media (prefers-reduced-motion: reduce) {
  *, *::before { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important;
    scroll-behavior: auto !important; transition-duration: 0.01ms !important; }
}
~~~

Respect this behavior for all new states. Prefer transform/opacity for new motion even though the extracted code also transitions colors, borders, box-shadow, and (for the scrollbar) width.

## 7. Depth & Surface

The existing strategy is mixed, led by tonal shift and 1px borders:

- Page depth comes from the three dark-violet gradient stops, the monitor's top-right radial glow, and alpha-varied surfaces.
- Panels and cards use 1px solid var(--dh-border); strong panels use --dh-border-strong. There are no resting elevation shadows on cards.
- The bright popup header is a three-stop 90-degree gradient: oklch(0.8 0.15 304), oklch(0.73 0.19 304), oklch(0.66 0.23 302) with --dh-accent-ink text.
- Focus and action feedback use box-shadow: 0 0 0 2px --dh-focus or the existing translucent accent ring. The onboarding pulse expands a violet shadow from 0 to 4px.
- .glass and .glass-dark are names for opaque/alpha tonal surfaces plus a border. They do not use backdrop-filter; do not reinterpret them as web glass.

### Radius rules

Use the existing compact scale consistently:

| Radius | Existing spelling | Usage |
| --- | --- | --- |
| 4px | Tailwind rounded | Small image fallback and text/icon controls |
| 6px | 0.375rem, Tailwind rounded-md | Icon buttons, inputs, subpanels, compact action buttons |
| 8px | 0.5rem, Tailwind rounded-lg, monitor CSS 8px | Panels, monitor card/drop/empty, primary/secondary actions, selector |
| Full pill | 999px | Runtime/status badges, switches, queue chips, progress tracks/fills, monitor pills |
| Scrollbar | 10px | Popup scrollbar thumb (existing special case) |

Do not add a new radius tier or mix a new soft card treatment into this control surface. No z-index layering system is currently needed; all surfaces remain in normal flow.

## 8. Accessibility Constraints & Accepted Debt

### Constraints

- Target WCAG 2.2 AA for the compact surface: 4.5:1 minimum for normal text, 3:1 for large text and essential UI boundaries. Existing 10-12px status text and Tailwind semantic aliases must be contrast-checked at the actual rendered background; do not assume a hue token passes.
- Every interactive element must be keyboard reachable with a visible focus indicator. .dh-focus:focus-visible and .dh-icon-button:focus-visible provide a 2px --dh-focus ring; preserve them on new controls.
- Use native semantics: button for actions, select/input with labels, role=switch plus aria-checked for toggles, aria-pressed for streamer mode buttons, and aria-expanded for the Telegram guide.
- Status feedback is polite and concise: queue actions use role=status aria-live=polite aria-atomic=true; sync panels use aria-live=polite plus aria-busy; loading/error/empty/log feedback uses polite live regions. A future CampaignStatusIndicators live region must announce meaningful transitions once and must not repeat every polling tick.
- Keep meaningful image alt text (drop.name) and preserve initials fallback on image errors. SVG icons remain aria-hidden when their surrounding button has a label.
- Queue reordering must remain keyboard operable with the existing arrow-key handler in addition to drag-and-drop. Long labels truncate inside min-w-0 regions; do not introduce horizontal scrolling to the primary popup surface.
- Honor prefers-reduced-motion: reduce exactly as the two stylesheets do. Do not make status comprehension depend on animation, color, or a decorative dot alone.
- Verify popup at its 400px width and monitor from its 320px minimum through long campaign/drop labels. Monitor has no scroll fallback today, so clipping must be treated as a failure to investigate.

### Accepted debt and boundaries

| Item | Location | Why it remains | Exit / owner |
| --- | --- | --- | --- |
| Dark-only theme; no light tokens | src/popup/index.css, src/monitor/monitor.css | Existing browser-extension language is dark violet and both roots explicitly set color-scheme: dark. | Add a light contract only if product scope requests it; UI worker must not infer one. |
| Duplicate token names with different alpha values | Both stylesheets | Popup and monitor were tuned separately; consolidation could change contrast/materiality. | Consolidate only in an approved token cleanup after visual comparison. |
| Raw OKLCH literals and Tailwind semantic aliases beside custom vars | Both stylesheets and popup JSX | Existing states predate a full semantic-token migration; changing them risks status contrast and snapshot drift. | Keep new work on listed vars/aliases; schedule migration separately. |
| 3px, 6px, 10px, 0.2rem, and other non-4px spacing | Monitor CSS and compact controls | Dense monitor geometry currently uses these values. | Revisit with a measured layout pass; do not normalize during Todo 13/14. |
| 10-12px metadata/body sizes | Popup/monitor JSX and CSS | Visual density 7 and narrow extension width require compact labels. | Contrast/zoom QA first; adjust only with a documented density decision. |
| Color/box-shadow transitions and scrollbar width animation | src/popup/index.css | Existing tactile feedback predates the GPU-only preference; removing it would alter behavior. | New motion should prefer transform/opacity; fix existing transitions only as a dedicated motion cleanup. |
| Monitor overflow:hidden with no nested scroll owner | src/monitor/monitor.css | The monitor is intended as a compact fixed-window readout. | Visual QA long/empty/unbroken content; introduce a named scroll owner only if product approves. |
| Nested reward and claim-log scroll containers | RewardList.tsx, ClaimLogView.tsx | Lists are intentionally bounded (240px/440px) to keep the popup usable. | Preserve named ownership; avoid adding another scrollbar to the same region. |
| Hand-authored SVG icon paths | src/popup/components/icons.tsx | Existing icons are small, currentColor, labeled, and visually consistent. | Replace as one icon-system migration, not piecemeal in indicator work. |
| Fallback raw #f04f4f in danger color | SettingsView.tsx | Inline fallback protects the warning when the custom var is unavailable. | Replace only when the danger token pipeline is made total. |

### Source and tooling scope

This document intentionally does not install React tooling, add dependencies, change CSS, or consolidate tokens. The frontend reference requested references/design/perfection/README.md, but that path is absent in the installed skill package; the available canonical file references/perfection/README.md was read instead. Visual QA and dependency-tooling work are outside this extraction-only change and remain opt-in for the later UI implementation.
