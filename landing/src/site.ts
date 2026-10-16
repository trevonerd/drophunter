export const SITE = {
  name: 'DropHunter',
  brand: 'DropHunter by Trevisoft',
  tagline: 'Auto-claim Twitch Drops while you’re away.',
  description:
    'DropHunter is a free Twitch Drops farmer extension for Chrome and Edge. Queue campaigns, farm in a hidden tab-less watch or one managed tab, auto-claim drops and channel-point bonuses, and keep everything local. Built by Trevisoft.',
  url: 'https://getdrophunter.com',
  storeUrl:
    'https://chromewebstore.google.com/detail/drophunter/nghbigapgpeicgcnolagdnnkdajjjgkj',
  githubUrl: 'https://github.com/trevonerd/drophunter',
  privacyUrl: 'https://github.com/trevonerd/drophunter/blob/main/PRIVACY.md',
  orgName: 'Trevisoft',
  orgUrl: 'https://trevisoft.dev',
  authorName: 'Marco Trevisani',
  authorUrl: 'https://github.com/trevonerd',
  version: '4.0.2',
  locale: 'en',
  disclaimer: 'Not affiliated with or endorsed by Twitch or Amazon.',
} as const;

export const STEPS = [
  {
    n: '01',
    title: 'Connect the Twitch session you already have',
    body: 'Open the popup and load Drops campaigns. DropHunter reads the Twitch session in this browser. There is no extra account and no password prompt from us.',
  },
  {
    n: '02',
    title: 'Queue campaigns — or star a favorite',
    body: 'Add campaigns and drag to reorder. Start authorizes that order. Star a game and favorite auto-start will pick up its campaigns by earliest expiry.',
  },
  {
    n: '03',
    title: 'DropHunter watches, rotates, and claims',
    body: 'Hidden farming talks to Twitch’s video CDN with no viewing tab. Managed farming reuses one tab. Progress hits the badge and the monitor. Claimable drops are claimed when you leave auto-claim on.',
  },
  {
    n: '04',
    title: 'Pause, stop, or walk away',
    body: 'Pause keeps your place. Stop ends the session until you Start again. An active session resumes after a browser restart. Your own Twitch viewing always takes priority.',
  },
] as const;

export const FEATURES = [
  {
    title: 'Campaign queue',
    body: 'Line up drops from different games. Drag to reorder. DropHunter works through authorized campaigns in order and keeps duplicate-game campaigns distinct as Game · Campaign Title.',
  },
  {
    title: 'Favorite auto-start',
    body: 'Star games to farm their campaigns by earliest expiry. Urgent favorites can interrupt a running manual queue and resume it afterward. Adding a favorite never overrides Pause or Stop on its own.',
  },
  {
    title: 'Hidden farming',
    body: 'Tab-less watch requests live audio media from Twitch’s video CDN (ttvnw.net). No viewing tab, and it never falls back to one. New installs prefer this path.',
  },
  {
    title: 'One managed tab',
    body: 'Reuse a single proved Twitch tab instead of spawning a pile of windows. Optional fallback: if a full tab-mode pass stalls, switch the watch source to hidden farming and restart the round.',
  },
  {
    title: 'Live progress',
    body: 'Popup, extension badge, and a compact monitor window stay in sync. Enable auto-open for the monitor when farming starts, or leave it shut.',
  },
  {
    title: 'Auto-claim',
    body: 'Claim completed drops across campaigns when Twitch marks them claimable. Optionally claim free channel-point bonuses on Twitch channel tabs you already have open.',
  },
  {
    title: 'Smart streamer switching',
    body: 'Stay on a valid stream until it goes offline, becomes ineligible, or progress stalls. Then pick lowest viewers, random, or most viewers. Prefer one of 30+ broadcast languages.',
  },
  {
    title: 'Recovery that tells the truth',
    body: 'Four distinct streamer attempts, then the campaign is parked and the rest of the queue continues. Unresolved rounds retry after ten minutes. Popup warnings wait for that four-streamer budget.',
  },
  {
    title: 'Local claim history',
    body: 'Review recently claimed drops grouped by campaign. Claims made outside DropHunter are logged without an alert. History never leaves this browser.',
  },
  {
    title: 'JSON backup',
    body: 'Export and restore settings, favorites, hidden games, statistics, and claim history. Credentials, session tokens, campaign progress, and queue authorization are never in the file.',
  },
  {
    title: 'Desktop or Telegram alerts',
    body: 'Optional browser notifications, or your own Telegram bot and chat after you grant host access. Farming works with both off. Credentials never ride along in an alert.',
  },
  {
    title: 'Survives restart',
    body: 'Active farming resumes after Chrome comes back. Manual Pause and Stop survive restarts and updates. Service-worker recycles do not wipe the session.',
  },
] as const;

export const PRIVACY_POINTS = [
  {
    title: 'No DropHunter servers',
    body: 'Operational state lives in chrome.storage on your machine. There is no analytics, telemetry, crash reporter, ad SDK, or developer-owned backend.',
  },
  {
    title: 'Twitch session stays in the browser',
    body: 'OAuth token, user id, and device id are read from the Twitch pages you already use, then sent only to Twitch. No cookies permission. No chrome.cookies fallback.',
  },
  {
    title: 'Telegram is opt-in and yours',
    body: 'Bot token and chat id stay local. Messages go to api.telegram.org for the chat you named. Off by default; optional host permission required.',
  },
] as const;

export const PERMISSIONS = [
  {
    name: 'storage',
    why: 'Keep queue, progress, settings, and recovery metadata across sessions.',
  },
  {
    name: 'scripting',
    why: 'Inject content scripts on Twitch pages to inspect and prepare playback.',
  },
  {
    name: 'alarms',
    why: 'Run the farming loop and retries after Chrome parks the service worker.',
  },
  {
    name: 'host: twitch.tv',
    why: 'Load campaigns, watch eligible streams, and claim drops with your session.',
  },
  {
    name: 'host: ttvnw.net',
    why: 'Request live stream media during hidden farming, the same CDN Twitch’s player uses.',
  },
  {
    name: 'notifications (optional)',
    why: 'Desktop alerts for claims and farming events, only after you enable them.',
  },
  {
    name: 'api.telegram.org (optional)',
    why: 'Send the Telegram alerts you configure, only after you grant access.',
  },
] as const;

export const WHY = [
  {
    title: 'Campaigns, not just games',
    body: 'Twitch can run several drop campaigns on the same title. DropHunter keys off campaign identity so the queue, labels, and completion logic do not collapse them into one game id.',
  },
  {
    title: 'A watch you can actually hide',
    body: 'Hidden farming is live HLS against Twitch’s video CDN — not a minimized tab pretending to be backgrounded. Managed-tab mode is the other explicit choice, not a silent fallback.',
  },
  {
    title: 'Local by construction',
    body: 'Install it, farm, claim, back up JSON. Nobody at Trevisoft receives your session, your queue, or your claim log. Open source, inspectable, no account with us.',
  },
  {
    title: 'Restart without losing the plot',
    body: 'MV3 workers die constantly. DropHunter persists the authorized queue, Pause, Stop, and an in-flight session so Chrome coming back is not a cold start.',
  },
] as const;

export const FAQS: { q: string; a: string }[] = [
  {
    q: 'What is DropHunter?',
    a: 'DropHunter by Trevisoft is a Chrome, Chromium, and Edge extension that farms Twitch Drops from your existing Twitch session. You queue campaigns or star favorites; it opens an eligible stream (hidden or in one managed tab), tracks watch-time progress, auto-claims rewards when Twitch allows it, and moves through the queue.',
  },
  {
    q: 'Is DropHunter a Twitch Drops farmer extension I can auto-claim with?',
    a: 'Yes. That is the product: a Twitch Drops farmer extension with auto-claim for completed drops, optional channel-point bonus claims, a campaign queue, and live progress in the popup, badge, and monitor window.',
  },
  {
    q: 'Is DropHunter free?',
    a: 'Yes. The extension is free. There is no DropHunter account, no subscription, and no in-extension store. Install it from the Chrome Web Store.',
  },
  {
    q: 'Does DropHunter need my Twitch password?',
    a: 'No. It uses the Twitch session already in the browser. Sign into twitch.tv yourself. DropHunter never asks for a password and never sends credentials anywhere except Twitch API calls made on your behalf.',
  },
  {
    q: 'Where is my data stored?',
    a: 'On your machine, in Chrome extension storage. Portable JSON backups include settings, favorites, hidden games, statistics, and claim history — never tokens, campaign progress, or queue authorization. There is no DropHunter cloud.',
  },
  {
    q: 'Which browsers are supported?',
    a: 'Chrome, other Chromium browsers, and Microsoft Edge (Manifest V3, Chrome 120+). Install from the Chrome Web Store listing; Edge loads that same Chromium extension.',
  },
  {
    q: 'What is hidden (tab-less) farming?',
    a: 'DropHunter requests a PlaybackAccessToken, the usher audio-only playlist, and the newest live segments from Twitch’s video CDN (ttvnw.net). Those requests omit cookies, OAuth, and referrer. There is no viewing tab, and hidden mode never falls back to one.',
  },
  {
    q: 'What is managed-tab farming?',
    a: 'DropHunter reuses one proved Twitch tab for playback instead of opening a new window per streamer. You can mute that tab from the popup. An optional setting falls back to hidden farming if a full tab-mode queue pass fails to play or stalls.',
  },
  {
    q: 'How does the campaign queue work?',
    a: 'Add campaigns, drag to reorder, then press Start. Start authorizes that order; merely preparing the list does not farm. Completed, expired, or vanished campaigns leave the queue. A failed campaign is parked and retried later while others continue.',
  },
  {
    q: 'How do favorites and auto-start work?',
    a: 'Star a game to include it in favorite auto-start, which discovers that game’s campaigns and farms them by earliest expiry. Urgent favorites may interrupt an authorized manual queue and resume it later. New installs enable favorite auto-start. Turning it on explicitly may clear a Pause or Stop block; simply starring a game does not.',
  },
  {
    q: 'How does streamer switching work?',
    a: 'DropHunter stays on a stream until it goes offline, is no longer eligible, or watch progress stalls. Replacement uses your picker: fewest viewers, random, or most viewers, with optional language preference across 30+ broadcast languages. Offline turnover does not spend the four-channel failure budget.',
  },
  {
    q: 'What happens if a campaign gets stuck?',
    a: 'DropHunter tries up to four distinct streamers, parks the campaign, and continues the rest of the authorized queue. Unresolved rounds retry after ten minutes. The popup and optional alerts call a campaign stuck only after that four-streamer budget is spent.',
  },
  {
    q: 'Will DropHunter farm while I watch Twitch myself?',
    a: 'Your own Twitch streams take priority, including in background tabs. Automated farming suspends until those pages stop, close, or leave the channel, plus a short grace period. DropHunter does not read general browser history.',
  },
  {
    q: 'What is the difference between Pause and Stop?',
    a: 'Pause keeps the authorized queue and current position and stops playback until you Resume or Start. Stop ends the session and clears manual queue authorization until you Start again. Both survive browser restart and extension updates.',
  },
  {
    q: 'Does an active session survive a browser restart?',
    a: 'Yes. If farming was running when the browser stopped, DropHunter resumes once Twitch is available. Pause and Stop are honored. Chrome recycling the MV3 service worker between alarms is not treated as a restart.',
  },
  {
    q: 'Can I get desktop or Telegram notifications?',
    a: 'Yes, both optional and off unless you enable them. Desktop alerts use the optional notifications permission. Telegram uses your bot token and chat id, plus optional host permission for api.telegram.org. Farming does not require either.',
  },
  {
    q: 'Is DropHunter affiliated with Twitch or with drophunter.app?',
    a: 'No. DropHunter by Trevisoft is an independent extension by Marco Trevisani. It is not affiliated with or endorsed by Twitch or Amazon. It is also unrelated to the drophunter.app service. The product site is getdrophunter.com.',
  },
  {
    q: 'Is the source code public?',
    a: 'Yes. The repository is github.com/trevonerd/drophunter. You can inspect every Twitch call, storage key, and permission use.',
  },
];

export const SCREENSHOTS = [
  {
    src: '/images/screenshots/popup-farming.webp',
    fallback: '/images/screenshots/popup-farming.png',
    width: 400,
    height: 640,
    alt: 'DropHunter popup while hidden farming is running, showing drop progress and ETA',
    caption: 'Popup · live farming',
    featured: true,
  },
  {
    src: '/images/screenshots/popup-queue.webp',
    fallback: '/images/screenshots/popup-queue.png',
    width: 400,
    height: 640,
    alt: 'DropHunter popup with a four-campaign farming queue, Marvel Rivals selected',
    caption: 'Queue',
    featured: false,
  },
  {
    src: '/images/screenshots/monitor.webp',
    fallback: '/images/screenshots/monitor.png',
    width: 360,
    height: 270,
    alt: 'DropHunter compact live monitor window showing farming status and reward progress',
    caption: 'Live monitor',
    featured: false,
  },
  {
    src: '/images/screenshots/popup-campaigns.webp',
    fallback: '/images/screenshots/popup-campaigns.png',
    width: 400,
    height: 640,
    alt: 'DropHunter campaign list showing reward progress for Marvel Rivals Season Launch Drops',
    caption: 'Campaigns',
    featured: false,
  },
  {
    src: '/images/screenshots/popup-settings.webp',
    fallback: '/images/screenshots/popup-settings.png',
    width: 400,
    height: 640,
    alt: 'DropHunter settings: farming scope, hidden watch source, and notification toggles',
    caption: 'Settings',
    featured: false,
  },
  {
    src: '/images/screenshots/popup-log.webp',
    fallback: '/images/screenshots/popup-log.png',
    width: 400,
    height: 640,
    alt: 'DropHunter local claim log grouped by campaign',
    caption: 'Claim log',
    featured: false,
  },
] as const;
