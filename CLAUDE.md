# CLAUDE.md

@AGENTS.md

AGENTS.md is source of truth: architecture, domain rules, privacy, MV3 recovery, runtime messages, UI rules, tests.

## Commands

Bun only. No npm/yarn/pnpm.

- Install: `bun install`
- Dev: `bun run dev` / `bun run dev:edge`
- Tests: `bun test tests/`
- Typecheck: `bun run test:ts`
- Lint: `bun run lint`
- Build: `bun run build:all`
- Release check: `bun run release:check`
- Release zip: `bun run release:zip`

## Commits

Author/committer must be exactly:

`trevonerd <marco.trevisani81@gmail.com>`

No Co-Authored-By. No Generated-with. No AI/tool attribution.

## Notes

- Manifest source: `src/shared/extension-manifest.ts`
- Generated output: `.output/`; do not edit by hand
- Video assets live in separate `video/` Bun workspace
