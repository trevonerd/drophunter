# Favorite Auto-start And Legacy Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use test-driven development and subagent-driven execution. Work in vertical red/green slices and keep release commits separate.

**Goal:** Make starring a favorite perform an authoritative campaign sync and immediate safe auto-start, reset stale Twitch-derived state on legacy upgrades, and publish `v4.0.0-beta.36`.

**Architecture:** Route favorite changes through a fresh activation-sync trigger, preserve the favorite even when synchronization must retry, and expose a typed auto-start disposition to the popup. Add a legacy-only state transformer that whitelists durable user preferences/statistics while discarding Twitch-derived campaign/runtime state before hydration.

**Tech Stack:** WXT MV3, React 19, TypeScript, Bun, Chrome storage/runtime APIs.

## Global constraints

- Automatic playback requires authoritative farmable reward evidence and an eligible live streamer.
- Manual Twitch viewing continues to block automated playback.
- Favorite identity remains category-aware; queue identity remains campaign-aware.
- Legacy upgrades preserve user preferences, lifetime statistics, and valid favorites/hidden games.
- Modern `3.99.0.N` and `4.x` updates keep current queue-resume behavior.
- Existing tooling/config changes remain outside product and release commits.

## Tasks

- [ ] Commit the existing bounded queue recovery, preemption monitoring, and progressive-cache deduplication changes in three isolated commits after focused tests pass.
- [ ] Add a failing public-boundary regression for pristine-state star → authoritative refresh → favorite queue → farming start.
- [ ] Add `favorite-change` activation sync, candidate-scoped directory failure isolation, bounded waiting retries, and typed popup feedback until the regressions pass.
- [ ] Add failing legacy upgrade tests, then implement the legacy-only durable-state whitelist and schema bump.
- [ ] Run focused and full verification, call `vexp verify_done`, prepare `4.0.0-beta.36`, build from a clean release worktree, and publish the GitHub prerelease with Chrome and Edge ZIPs.

## Acceptance

- A valid favorite starts in the same user action without Add or Start.
- Incomplete data, absent eligible streamers, manual viewing, and refresh failures retain the favorite, explain the wait, and retry automatically.
- An unrelated directory failure cannot block a valid favorite.
- Legacy game/campaign/queue/progress/runtime data is absent before the first post-upgrade API refresh.
- `bun run release:check` and `bun audit` pass; GitHub prerelease assets match `v4.0.0-beta.36`.
