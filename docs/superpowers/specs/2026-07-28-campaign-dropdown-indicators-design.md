# Campaign dropdown indicators

## Goal

Make campaign selection state visible inside the existing native dropdown without changing its interaction model.

## Behavior

- Prefix a campaign option with the existing subscription-remainder symbol only when its persisted `rewardSummary` says farming is complete and `subscription-required` is among the remaining reasons.
- Do not infer subscription-only state during an initial load. The symbol first appears after selecting and inspecting that campaign, unless the summary was already saved in `appState`.
- Prefix every campaign already present in the queue with a simple queue symbol.
- Determine queue membership with the existing campaign-aware identity helper so duplicate campaigns for one game remain distinct.
- Allow subscription and queue symbols to coexist when both states apply.

## Implementation

Extend the existing campaign-option formatter with queue membership. Keep the native `<select>` and Unicode-symbol convention. Pass queue membership from `MainView`, which already receives canonical `queueGames`.

No new persisted field, runtime message, background behavior, custom dropdown, or styling token is needed.

## Verification

- Formatter/component test: unknown subscription state has no subscription symbol.
- Formatter/component test: saved subscription-only summary shows the symbol.
- Formatter/component test: queued campaign shows the queue symbol.
- Formatter/component test: duplicate campaign identities do not leak queue state.
- Formatter/component test: queue and subscription symbols coexist.
- Run focused popup tests and TypeScript checks.
