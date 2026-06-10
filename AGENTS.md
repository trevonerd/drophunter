# Agent Notes

Fast path for future agents. Keep this file short; update only when workflow or domain rules change.

## Project
- WXT Chrome/Edge MV3 extension using React 19, TypeScript, Tailwind CSS, Bun.
- Package manager: Bun only. Use `bun install`, `bun test`, `bun run build:all`.
- Main code: `src/background/`, `src/popup/`, `src/shared/`, `src/content/`.

## Campaign Identity
- Twitch campaigns are not plain games. Prefer `campaignId` identity.
- Use shared helpers in `src/shared/game-selection.ts`: `gameIdentity`, `isSameGameIdentity`, `gameKey`, `getGameDisplayLabel`.
- Dropdown/queue/start/remove flows must not key only by `game.id`; duplicate campaigns can share game-ish IDs.
- Real campaign titles should display as `Game · Campaign Title`, even when only one campaign exists for that game.

## Work Rules
- Preserve dirty worktree changes unless user explicitly asks to revert.
- Use `rg` first for search.
- Edit manually with `apply_patch`; avoid unrelated refactors.
- Before release/store handoff run:
  - `bun run test:ts`
  - `bun run lint`
  - `bun test tests/`
  - `bun run build:all`
  - `bun audit`

## Stability Hotspots
- Queue advancement and drop refresh are regression-prone. Cover changes with `tests/queue-management.test.ts`, `tests/service-worker.test.ts`, and `tests/queue-start.test.ts`.
- Campaign labels are regression-prone. Cover with `tests/replace-games.test.ts` and `tests/campaign-selection.test.ts`.
