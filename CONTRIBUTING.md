# Contributing

## Commit Metadata

- Use `trevonerd <marco.trevisani81@gmail.com>` as the only author and committer.
- Preserve historical `ImgBotApp` author and committer metadata.
- Do not add co-author trailers, generated-by trailers, or assistant/tooling attribution.
- Keep commit subjects and bodies focused on the product change.
- Use short English Conventional Commits; add a body only when it explains a useful reason.

## Checks

Use stable Bun as pinned in `package.json`. Install root and `video/` dependencies before running checks. Before handoff, run both TypeScript checks, `bun run knip`, and the relevant tests. Knip covers both projects and fails `check`, pre-push, CI, and `release:check` on unused files, exports, types, dependencies, or unresolved imports. Preserve intentional facade contracts with narrowly scoped `@public` annotations; use `@alias` for compatibility aliases. Before a release, run `bun run release:check`; lint warnings fail the gate. Tests must verify intentional diagnostics rather than print or silently discard them. See `AGENTS.md` for domain and recovery rules.
