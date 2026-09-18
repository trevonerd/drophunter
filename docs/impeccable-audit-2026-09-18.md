# DropHunter interface audit — 2026-09-18

## Follow-up: adapt, animate, and polish

Both reported findings were addressed after the user requested the follow-up. The original audit below is retained as the before-state record; its score has not been recalculated.

- Monitor content now uses document scrolling. Header/footer metadata can wrap, including long unbroken names and narrow effective viewports under zoom.
- Reduced motion uses a static loading arc with existing text, a steady onboarding outline, and immediate progress, switch-thumb, and disclosure-chevron updates. Normal motion and color/focus feedback remain unchanged.
- Fresh Chrome checks covered seven monitor cases at widths 180, 320, 360, and 640px, including 200% text, long/unbroken labels, and empty state. Each had no horizontal overflow; keyboard End made the footer visible.
- The normal 360 × 300 monitor screenshot is pixel-identical to the audit baseline (zero differing pixels).
- Motion checks confirmed normal progress interpolation versus immediate reduced-motion updates. Two independent visual reviewers inspected all 11 captures and returned PASS without blockers.
- Sampled popup contrast measured 4.76:1 for the Start Queue label and 5.43:1 for queue metadata against the rendered background. This is a spot check, not full contrast certification.
- Validation: production Chrome build, TypeScript, lint, and all 54 focused popup/monitor tests passed. The existing layout test now enforces one document scroll owner rather than prohibiting vertical scrolling.
- The optional vexp completion check returned paths from an unrelated workspace, so its result was excluded; validation above ran directly in DropHunter.
- Evidence: `/tmp/drophunter-impeccable-audit/after/` contains screenshots, geometry/motion results, and sampled contrast results. Browser checks use current server-rendered components and production CSS, not a live Twitch session.

---

**Implementation integrity: PASS within the inspected scope.** The popup and monitor use a coherent, campaign-aware control interface, shared status semantics, and the established dark-violet design system. Impeccable's three detector warnings (violet styling once, Inter twice) are false positives against the explicit DESIGN.md contract, not reasons to replace the visual identity.

## Summary

**Provisional health score: 14/20 — Good, with weak dimensions to address.** This is an engineering assessment of the inspected source and fixtures, not a Lighthouse score or a WCAG conformance certification.

| Dimension | Score | Finding |
| --- | --- | --- |
| Accessibility | 2/4 | Enlarged monitor text becomes inaccessible; popup contrast remains unverified. |
| Performance | 3/4 | Production build succeeds; transform-based progress and conditional clocks are positive. Runtime render costs are unmeasured. |
| Responsive design | 2/4 | Popup fits 400px; monitor has no scrolling fallback for enlarged content. |
| Theming | 3/4 | Established tokens coexist with documented raw-color and utility-color debt. Dark-only is intentional. |
| Implementation integrity | 4/4 | Product-specific structure; detector warnings conflict with the approved identity. |
| **Total** | **14/20** | **Provisional; limited scenario coverage.** |

Findings: **0 P0, 1 P1, 1 P2, 0 P3**. The P1 affects both accessibility and responsive design and is counted once.

## Findings

### [P1] Monitor clips content when text is enlarged

- **Location:** `src/monitor/monitor.css:25`; window sizing in `src/background/monitor-dashboard.ts:59`.
- **Category:** Accessibility / Responsive design.
- **Evidence:** Real Chrome rendered the current MonitorView with fresh production CSS at 360 × 300 CSS pixels. Doubling each element's original computed font size pushed the short-content footer bottom to 323px and the long-content footer bottom to 696px. The viewport remained 300px high and body overflow was `hidden`. No nested scrolling container makes the hidden content reachable. The production window requests an even smaller 360 × 270 outer size.
- **Impact:** Users enlarging text can lose progress, ETA, channel, and update information below the visible window. Long campaign and reward names amplify the loss.
- **Standard:** This reproduces the content-loss pattern addressed by [WCAG 1.4.4 Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html). The test simulated text enlargement; extension-native browser zoom was not exercised, so this is not a complete conformance determination.
- **Recommendation:** Give the monitor one accessible vertical scroll owner when content exceeds its viewport. Preserve the compact default size while allowing wrapped labels and enlarged text to remain reachable. Verify short, long, and recovery notices at normal and enlarged text sizes.
- **Suggested command:** `$impeccable adapt monitor`.

### [P2] Reduced-motion behavior is a blanket duration override

- **Location:** `src/popup/index.css:517`, `src/monitor/monitor.css:227`.
- **Category:** Accessibility / Implementation quality.
- **Evidence:** Both stylesheets apply `animation-duration: 0.01ms`, one animation iteration, and `transition-duration: 0.01ms` to every element and pseudo-element. This suppresses spinner, onboarding, and progress animation indiscriminately.
- **Impact:** The setting prevents motion, but does not define intentional static alternatives for the distinct loading and onboarding cues. Future animated feedback also inherits this behavior automatically. Existing textual status mitigates the immediate impact.
- **Standard:** No standalone WCAG failure established; this is an Impeccable motion-quality finding.
- **Recommendation:** Replace broad duration manipulation with scoped reduced-motion rules: a static loading indicator with retained loading text, a steady onboarding highlight, and immediate progress updates. Preserve visible focus and state distinctions.
- **Suggested command:** `$impeccable animate popup and monitor reduced-motion states`.

## Patterns and accepted debt

- Monitor sizing assumes content remains short; text wrapping alone cannot make a fixed, non-scrolling window resilient.
- Reduced-motion handling is duplicated and generic across the two surfaces.
- Raw OKLCH values and Tailwind semantic colors coexist with shared tokens. DESIGN.md already records this debt and deliberate surface-specific alpha differences. No palette migration is warranted as part of this audit.
- Compact controls are intentional. Measured queue actions are 24 × 24px and header actions are 28 × 28px. They are below a 44px enhancement target, but their size alone does not violate [WCAG 2.5.8's 24px minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). Hidden controls with zero-size rectangles were excluded from target-size conclusions.

## Positive findings

- Campaign-aware queue labels and stable identity preserve distinct campaigns for the same game.
- Queue handles implement arrow-key reordering and describe the interaction in their accessible names.
- Icon buttons have accessible labels; status badges and notices use polite live regions.
- Monitor progress exposes a named progressbar and bounded values.
- The tested popup has no horizontal overflow at its intended 400px width.
- Progress fills animate transforms; recovery clocks are enabled only while needed.
- Native controls and disclosure patterns avoid unnecessary custom interaction machinery.

## Verification and limitations

- Fresh `bun run build:chrome`: passed. Total reported extension size: 725.69kB; this includes background and content scripts and is not the popup's transferred size.
- Impeccable detector: three warnings, all rejected as design-contract false positives.
- React Doctor 0.9.14: 39 repository-wide warnings, zero errors. Its scan includes generated builds, tests, and promotional video code; the overall 66 score is not the popup's health score. Fifteen diagnostics concern popup/monitor source, mostly complexity warnings. The sequential queue-mutation warning is not evidence that parallel mutation is safe; do not apply its Promise.all suggestion blindly. Default-array and effect warnings require runtime/context validation and are not counted as confirmed user-facing defects.
- Playwright with installed Chrome: current React components rendered to static markup with fresh production CSS. Monitor: normal and doubled text, short and long labels, at 360 × 300. Popup: queued idle state at 400 × 600.
- axe-core 4.13.0: zero violations in the normalized popup fixture and short normal monitor fixture. Popup color contrast returned an incomplete result, so no full contrast pass is claimed.
- An initial legacy popup fixture omitted the auto-start default and triggered a missing aria-checked warning. Re-rendering with createInitialState defaults removed it; it is not reported as an application defect.
- These fixtures do not exercise live extension messages, Twitch sessions, React interaction updates, all settings states, or assistive-technology announcements. No Lighthouse, runtime React Scan, or full keyboard journey result is claimed. Performance scores remain provisional.
- No application source, dependencies, PRODUCT.md, or DESIGN.md changed. Audit tooling and raw evidence reside in `/tmp/drophunter-impeccable-audit/`; React Doctor output is `/tmp/drophunter-impeccable-react-doctor.json`.

## Recommended order

1. **P1 — `$impeccable adapt monitor`:** Make overflowing and enlarged monitor content accessible.
2. **P2 — `$impeccable animate`:** Define deliberate reduced-motion states for popup and monitor.
3. **`$impeccable polish`:** Confirm the fixes preserve existing density, identity, and status legibility; complete outstanding contrast checks.

These can be run one at a time, together, or in a preferred order. Re-run `$impeccable audit` after fixes to reassess the score.
