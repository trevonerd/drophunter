# Contributing

## Commit Metadata

- Use `trevonerd <marco.trevisani81@gmail.com>` as the only author and committer.
- Preserve historical `ImgBotApp` author and committer metadata.
- Do not add co-author trailers, generated-by trailers, or assistant/tooling attribution.
- Keep commit subjects and bodies focused on the product change.
- Use short English Conventional Commits; add a body only when it explains a useful reason.

## Checks

Use stable Bun as pinned in `package.json`. Before handoff, run both TypeScript checks and the relevant tests. Before a release, run `bun run release:check`; lint warnings fail the gate. Tests must verify intentional diagnostics rather than print or silently discard them. See `AGENTS.md` for domain and recovery rules.
