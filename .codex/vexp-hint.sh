#!/bin/bash
# vexp-hint: event-driven orientation hint (UserPromptSubmit). Fails open.
VEXP_BIN="/opt/homebrew/lib/node_modules/vexp-cli/node_modules/@vexp/core-darwin-arm64/bin/vexp-core"
[ -x "$VEXP_BIN" ] || exit 0
"$VEXP_BIN" prompt-hint 2>/dev/null
exit 0
