# DropHunter 2.0 Soak Test Checklist

## Goal

Verify that long unattended farming stays in `RUNNING` or `RECOVERING`, and only ends in a terminal state for real terminal reasons.

## Preflight

- Install the unpacked extension on a clean Chrome profile.
- Sign in to Twitch with a test account that has at least one active drops campaign.
- Confirm the queue has at least two farmable campaigns if available.
- Open Chrome DevTools for the service worker and keep console open.

## Core Long-Run Scenario

1. Start farming on a valid live stream with drops active.
2. Let the extension run for at least 2 hours.
3. During the run, confirm:
   - no unexpected switch to `IDLE`
   - popup and monitor show `RUNNING` or `RECOVERING`
   - progress continues to move when the stream is healthy
4. Force at least one service worker restart during the run.
5. Confirm the extension resumes with the same runtime state and does not lose recovery backoff or integrity fallback state.

## Recovery Scenarios

1. Simulate a long-run player stall while the stream stays open.
   Expected:
   - first action is in-place playback self-heal
   - later action can rotate or retry with backoff
   - extension never falls to `IDLE`
2. Simulate stream offline / wrong game / wrong channel / drops inactive.
   Expected:
   - recovery reason is visible in popup and monitor
   - retry label is visible when backoff is active
3. Close the managed Twitch tab when it is the only tab in its window.
   Expected:
   - Chrome window stays open
   - extension releases ownership safely

## Terminal Scenarios

1. Stop farming manually.
   Expected:
   - terminal stop reason is shown
   - worker stops monitoring
2. Let the queue complete naturally.
   Expected:
   - stop reason is `queue-complete`
   - no recovery loop continues afterward
3. Remove or invalidate the Twitch session while farming.
   Expected:
   - stop reason is `sign-in-required`
   - no non-terminal recovery loop hides the auth issue
