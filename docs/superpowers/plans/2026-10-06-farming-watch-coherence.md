# Farming queue, playback and progress coherence

Approved implementation scope: local verified build only, no publication, new dependencies or scheduler. Preserve campaign identity, queue authorization and manual Pause/Stop.

1. Return an explicit result for each watch start. Incumbent health cannot prove a replacement succeeded.
2. Prepare campaign, streamer and reward projection provisionally. Persist without public effects, then promote ownership and publish the matching state together. Dispose failures and superseded candidates.
3. Preserve physical incumbent playback while preparing a viable alternative; reuse existing managed ownership and safe disposal mechanisms. Retain in-place recovery for blocked/completed watches.
4. Keep campaign checks independent of active farming. Unknown directory results do not become zero availability; recent authoritative reward progress remains evidence for the incumbent. Favorite preemption retains its policy.
5. Start muted, observe video-time advancement and avoid synthetic player toggles. An explicit initial gesture wait retains its tab and exposes Start the video in the shared status model. Ticks detect recovery without rotating or fabricating reward progress.
6. Validate persisted campaign, channel, category and ownership during reconstruction. Reject stale healthy projections and reacquire the authorized campaign. Stop/Pause and late results prevent promotion.
7. Verify composed production-session/coordinator regressions, seven-campaign discovery, persistence and races, restart, and Chrome MV3 autoplay/gesture E2E. Run both TypeScript checks, lint, complete unit/E2E suites, Chrome/Edge builds and vexp verification.
8. Verify real Twitch in Brave: background reward progression across at least two observations, rotation, campaign change and worker reconstruction. Document observed results and limits in the recovery matrix; fixture success alone cannot close the AFK case.

Domain definitions are recorded in `CONTEXT.md`; executable evidence and browser observations belong in `docs/recovery-case-matrix.md`.
