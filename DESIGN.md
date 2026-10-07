# DropHunter interface contract

The popup and monitor are compact operational controls. Preserve their dark violet palette, typography, spacing, and restrained motion. This document records behavior and layout decisions; CSS and components are the source of exact token values.

## Sources

- Popup tokens and reusable surfaces: `src/popup/index.css`.
- Monitor tokens and dimensions: `src/monitor/monitor.css`.
- Tailwind configuration and component classes provide the remaining styling.
- Shared runtime status: `src/shared/user-status.ts` and `src/shared/recovery-presentation.ts`.

Read the current source before changing tokens. Popup and monitor have some intentional surface-specific values; do not consolidate them as part of unrelated work.

## Hierarchy and layout

- Keep connection, farming status, queue, and primary action easy to scan in a narrow extension popup.
- Show the active reward once, with a progress rail and concise time information.
- Label campaigns `Game · Campaign Title`, including when only one campaign exists for the game.
- Keep campaign browsing and queue order distinct. Adding a campaign prepares the queue; Start authorizes it.
- Each bounded list owns its scrolling. Avoid introducing additional nested scroll regions.
- Settings expose farming scope, watch source, and notification essentials first. Secondary controls stay in the native Advanced disclosure.
- Keep the monitor compact, without horizontal overflow or duplicate campaign/reward descriptions.

## Status and actions

- Popup and monitor use the same user-status model. Show one state, one reason, and an optional retry time.
- Recovery countdowns correspond to actual scheduled attempts. Show “retrying” only when work starts.
- Pause preserves queue authorization and position; Stop ends the session and clears manual authorization. Both survive restart and update.
- Active sessions resume after browser restart once Twitch is available. The retired auto-resume setting is not a user-facing control.
- Personal Twitch playback takes priority, including in background tabs. Farming waits until it stops and the grace period ends.
- Keep internal retry counters, transport details, and routine session resynchronization out of the main status flow.
- Transient action feedback clears on real responses or broadcasts; fallback timers are secondary.
- Surface failed actions in the popup instead of leaving loading indicators active.

## Messages

- Operational guidance is immediately visible, including login or the initial player click. It disappears when resolved.
- Campaign warnings sit in one native expandable Messages section with a count; one row per active episode. Previous warnings never color the current campaign orange.
- Each row has an accessible dismiss button. Dismissal persists across popup reopening and worker recycle without changing authorization, retries or external delivery receipts.
- A new browser session hides old operational warnings; a new failure may update that episode locally without repeating a successful external delivery.
- Automatic round waiting is neutral and offers Retry and Stop. Manual Pause remains a distinct state.

## Components

- Header icon buttons have accessible names and clear pressed states where relevant.
- The farming summary presents the selected campaign, active reward, progress, and appropriate Start/Pause/Resume/Stop action.
- Campaign entries show reward eligibility and expiry without treating subscription-gated rewards as farmable watch time.
- Queue updates preserve campaign identity and announce useful changes through a polite live region.
- Favorite auto-start remains independent of notification settings and does not authorize a merely prepared manual queue.
- Browser and Telegram notification controls are independent. Configuration, permission, and delivery failures get concise, local feedback.
- Claim history groups acquired rewards by campaign and uses bounded or virtualized rendering for large histories.
- Reward verification qualifiers appear only when relevant; missing evidence must not imply a claimed reward.

## Visual behavior

- Reuse existing surface, border, radius, and progress classes. Do not add ornamental gradients or a second palette.
- Use the existing font stack and size hierarchy. Check long campaign names and translations before reducing text sizes.
- Preserve focus visibility, keyboard operation, native form semantics, and accessible labels.
- Use `role="status"` and `aria-live="polite"` for non-modal status feedback.
- State remains understandable without color. Decorative icons are hidden from assistive technology.
- Respect reduced-motion preferences. Keep animations brief and avoid animating layout for routine progress updates.

## Verification

Check popup and monitor with idle, running, paused, recovery, complete, disconnected, and failed-action states. Include duplicate-game campaigns, long labels, empty queues, large claim histories, keyboard navigation, and reduced motion.

Broad redesigns, token consolidation, icon replacement, or changes to scroll ownership require focused visual verification. Routine maintenance preserves the existing language.
