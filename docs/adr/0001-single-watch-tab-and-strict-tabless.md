# One managed watch tab and strict tabless farming

Date: 2026-10-07

## Context

Preparing replacements in a second Twitch tab loses the original playback gesture and creates duplicate viewing tabs. Switching hidden farming to a managed tab also contradicts the chosen transport. Neither playback health nor an accepted heartbeat proves reward acquisition.

## Decision

Keep the existing farming-session facade, queue progression and acquisition-round scheduler. Both transports use one campaign-specific budget of four distinct normalized channels and the same duration-based progress checks. Unresolved rounds wait ten minutes with a real retry alarm.

Managed transitions navigate the single proved tab, wait for loading, confirm ownership and prepare playback. Only verified absence permits recreation. Cancellation is checked inside serialized mutations; cleanup never rolls back a reused tab or pauses a newer marker. Pause, Stop, completion and switching to tabless suspend the proved player and retain its tab. Restore retains proved ownership before checking playback, so a failed or pending probe cannot hide a player from Stop. Public suspension also reconstructs the latest retained proof after a failed replacement; cancelled reconstruction cannot overwrite a newer registry entry. Suspension clears keepalive and pauses both the site's verified playing control and native video. Content preparation rechecks its authorization after asynchronous playback observation, including before a muted-play retry. Policy, self-heal and legacy opening carry the same revision guard through asynchronous proof and navigation. If Stop arrives while the first tab's final storage or marker write is pending, acquisition completes only its own ownership proof, suspends that player and returns no viable candidate.

Tabless farming has no viewing-tab fallback. Login and Drops synchronization may use separate service pages. Automatic termination requires every retained authorized target positively acquired or validly expired; missing data and failed claims remain unresolved.

## Consequences

A same-tab transition interrupts its previous page before the replacement is ready. A failed request follows normal queue order; it does not restore the old document. Warning episodes persist independently of rounds and transport health, with separate browser and Telegram receipts. Delivery is detached from farming after durable state is recorded.

Local Chrome fixture tests exercise real extension listeners and video playback. They do not establish that production Twitch credits progress; live Twitch verification remains a separate check.
