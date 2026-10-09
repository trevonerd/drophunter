# Twitch adblock engine

Adapted from [TTV-AB](https://github.com/GosuDRM/TTV-AB), by GosuDRM,
v20.0.0 at commit `11c2a7ea17fcda83c21129e3bfddd208385be142`.
The MIT-based license with repository attribution is distributed in
`public/licenses/ttv-ab.txt`.

`page.js` contains the page bootstrap and its dependencies; `worker.js` contains
the playback worker and its dependencies, collected using upstream's
`tools/build-worker.ts`. Both are readable JavaScript adapted from upstream's
TypeScript modules. WXT embeds the worker as local text in `twitch-adblock.js`.
Neither file downloads extension code or contacts a DropHunter-owned service.

Ad blocking, ad spoofing and low-quality fallback use the upstream enabled
defaults. Playback recovery, worker message validation, stale-result guards,
quality restoration, live/VOD support and explicit pause handling are retained.
The page/extension settings bridge, logger, diagnostic collection and events,
ad/watch-time statistics, timer overlays, welcome and donation UI are removed.
Operational ad-pod and playback state remain necessary for recovery.
DropHunter counts distinct ad IDs per document and reports only the count to
its local background worker. The cumulative total appears in Advanced settings
and is excluded from portable backups.
DropHunter's exact-URL suspension marker vetoes automatic resume/reload until
an authorized playback preparation clears it; another channel cannot inherit it.

When updating, use a pinned upstream revision and preserve those removals in
both page and worker code. Recollect the worker's dependencies after adapting
the modules; do not replace it with a hand-selected list. Run
`tests/twitch-adblock-engine.test.ts`, registration tests, browser E2E and build
both browsers. Check an actual live ad break and VOD before releasing: local
fixtures cannot prove compatibility with Twitch's current delivery.
