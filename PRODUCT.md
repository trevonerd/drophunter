# Product

DropHunter helps Twitch viewers choose campaigns, earn watch-time rewards, claim them, and continue through an authorized queue with little manual intervention. The popup explains current progress and the next action; the monitor provides a compact live readout.

## Priorities

- Preserve campaign identity, queue order, user preferences, and progress evidence.
- Recover from browser restarts and Twitch interruptions while respecting manual Pause and Stop.
- Give personal Twitch viewing priority over farming.
- Keep state local and notifications optional. Telegram uses the user's own bot and chat.
- Explain actionable problems clearly without exposing retry counters or internal diagnostics.

## Interface

Use a compact dark violet control surface with clear status, readable progress, and restrained motion. Put farming essentials first and secondary controls in Advanced. Avoid decorative metrics, oversized marketing elements, and unnecessary confirmation steps.

Use native controls, accessible labels, visible focus, and polite live regions for status changes. Color must not be the sole indicator of state. The implementation contract is in `DESIGN.md`; domain terms are in `GLOSSARY.md`.
