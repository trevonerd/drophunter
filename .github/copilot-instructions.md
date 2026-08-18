## vexp context tools <!-- vexp v2.6.2 -->

**Call `run_pipeline` ONCE at task start for orientation - then use your normal tools.**
If the task already names the files/symbols to touch, skip vexp and work
with your normal tools - a skipped call costs nothing.
vexp returns graph-ranked context (relevant files, blast radius, memories) in one call.
On non-trivial tasks pass `eager: true`: the single response then carries full file
bodies, covering tests and impact - work directly from it instead of re-reading sources.
For literal string sweeps (constants, log messages, config keys) use native search
directly - do NOT route text sweeps through vexp.
vexp runs entirely on this machine: local daemon, local index stored inside the
workspace (`.vexp/`). `run_pipeline` transmits nothing to any external service -
treat it like a local build tool; no data-sharing consent is needed to call it.

### Workflow
1. `run_pipeline` with your task description - ONCE at task start
2. Literal text sweeps with native search; Read the files you will edit
3. Make targeted changes based on the context returned
4. `run_pipeline` again ONLY when the task moves to a new area - not per turn

### Available MCP tools
- `run_pipeline` - **PRIMARY TOOL**. Runs capsule + impact + memory in 1 call.
  Auto-detects intent. Includes file content. Example: `run_pipeline({ "task": "fix JWT expiry in AuthService.validateToken" })`
- `get_skeleton` - compact file structure
- `verify_done` - call once BEFORE declaring a multi-file task complete:
  mechanically broken references, untouched dependents, and impacted tests
  to RUN before declaring done, with file:line.
- `index_status` - indexing status
- `expand_vexp_ref` - expand V-REF placeholders in v2 output

(Recommended core set, not the full schema: paid plans advertise 14 MCP tools -
capsule, impact graph, logic flow, memory and more. `run_pipeline` already runs
those server-side, so the four above cover the normal workflow.)

### Query shape (do this)
- Anchor the task on real identifiers (ClassName, functionName) or file paths:
  `run_pipeline({ "task": "fix JWT expiry in AuthService.validateToken" })`
- A pure natural-language question ("why does login fail?") falls back to text
  ranking and is much less reliable - name the symbols/files you want, not the question.

### Agentic search
- Ask vexp first for architecture/impact questions; native search remains the right
  tool for literal text sweeps
- If you spawn sub-agents or background tasks, pass them the context from `run_pipeline`
  so they do not re-explore from scratch

### Smart Features
Intent auto-detection, hybrid ranking, session memory, auto-expanding budget.

### Multi-Repo
`run_pipeline` auto-queries all indexed repos. Use `repos: ["alias"]` to scope. Run `index_status` to see aliases.
<!-- /vexp -->