export const SITE = {
  name: 'DropHunter',
  brand: 'DropHunter by Trevisoft',
  tagline: 'Auto-claim Twitch Drops while you’re away.',
  description:
    'Free Twitch Drops farmer extension for Chrome and Edge. Queue campaigns, farm in the background, auto-claim drops. DropHunter by Trevisoft. Local only.',
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
  cta: 'Add to Chrome',
  subhead: 'Queue campaigns. It farms in the background and claims the drops.',
  privacyLine:
    'Runs on the Twitch session already in Chrome. State stays in this browser. Open source.',
} as const;

export const VIDEO = {
  id: 'hfFrD3JSW2o',
  name: 'DropHunter 4 - Twitch Drops farmed while you’re away!',
  description:
    'Promo for DropHunter by Trevisoft: queue Twitch Drops campaigns, farm in the background, and auto-claim from the Chrome session already signed into twitch.tv.',
  thumbnailUrl: 'https://i.ytimg.com/vi/hfFrD3JSW2o/maxresdefault.jpg',
  poster: '/images/video-poster.jpg',
  embedUrl: 'https://www.youtube-nocookie.com/embed/hfFrD3JSW2o',
  contentUrl: 'https://www.youtube.com/watch?v=hfFrD3JSW2o',
  watchUrl: 'https://youtu.be/hfFrD3JSW2o',
} as const;

export const FEATURES = [
  {
    title: 'Farms in the background',
    body: 'Watches eligible streams without you sitting on a tab.',
    shot: 'popup-farming',
  },
  {
    title: 'Queue and favorites',
    body: 'Line up campaigns, drag to reorder, or star a game.',
    shot: 'popup-queue',
  },
  {
    title: 'Auto-claim',
    body: 'Claims drops when Twitch marks them ready.',
    shot: 'popup-log',
  },
  {
    title: 'Progress at a glance',
    body: 'Badge, popup, and a small monitor window.',
    shot: 'monitor',
  },
] as const;

export const FAQS: { q: string; a: string }[] = [
  {
    q: 'What is DropHunter?',
    a: 'A free Chrome, Chromium, and Edge extension that farms Twitch Drops from the Twitch session already in your browser. Queue campaigns or star favorites. It watches, tracks progress, and auto-claims.',
  },
  {
    q: 'Is DropHunter a Twitch Drops farmer I can auto-claim with?',
    a: 'Yes. That is the product: a Twitch Drops farmer extension with a campaign queue, background watch, and auto-claim.',
  },
  {
    q: 'Is it free?',
    a: 'Yes. Install it from the Chrome Web Store. There is no DropHunter account.',
  },
  {
    q: 'Do you need my Twitch password?',
    a: 'No. Sign into twitch.tv yourself. DropHunter uses that browser session and sends credentials only to Twitch.',
  },
  {
    q: 'Where is my data stored?',
    a: 'On this computer, in Chrome extension storage. There is no DropHunter cloud. Optional Telegram uses your bot and chat.',
  },
  {
    q: 'How does background farming work?',
    a: 'Hidden mode requests live audio media from Twitch’s video CDN (ttvnw.net) with no viewing tab. You can use one managed Twitch tab instead.',
  },
  {
    q: 'Pause or Stop?',
    a: 'Pause keeps your queue and place. Stop ends the session until you Start again. Both survive a browser restart. Your own Twitch viewing takes priority.',
  },
  {
    q: 'Affiliated with Twitch or drophunter.app?',
    a: 'No. DropHunter by Trevisoft is an independent extension by Marco Trevisani at getdrophunter.com. Not affiliated with or endorsed by Twitch or Amazon. Unrelated to drophunter.app.',
  },
];

export const SCREENSHOTS = [
  {
    id: 'popup-farming',
    src: '/images/screenshots/popup-farming.webp',
    fallback: '/images/screenshots/popup-farming.png',
    width: 400,
    height: 640,
    alt: 'DropHunter popup while hidden farming is running, showing drop progress and ETA',
    caption: 'Farming',
    featured: true,
  },
  {
    id: 'popup-queue',
    src: '/images/screenshots/popup-queue.webp',
    fallback: '/images/screenshots/popup-queue.png',
    width: 400,
    height: 640,
    alt: 'DropHunter popup with a four-campaign farming queue, Marvel Rivals selected',
    caption: 'Queue',
    featured: false,
  },
  {
    id: 'monitor',
    src: '/images/screenshots/monitor.webp',
    fallback: '/images/screenshots/monitor.png',
    width: 360,
    height: 270,
    alt: 'DropHunter compact live monitor window showing farming status and reward progress',
    caption: 'Monitor',
    featured: false,
  },
  {
    id: 'popup-campaigns',
    src: '/images/screenshots/popup-campaigns.webp',
    fallback: '/images/screenshots/popup-campaigns.png',
    width: 400,
    height: 640,
    alt: 'DropHunter campaign list showing reward progress for Marvel Rivals Season Launch Drops',
    caption: 'Campaigns',
    featured: false,
  },
  {
    id: 'popup-settings',
    src: '/images/screenshots/popup-settings.webp',
    fallback: '/images/screenshots/popup-settings.png',
    width: 400,
    height: 640,
    alt: 'DropHunter settings: farming scope, hidden watch source, and notification toggles',
    caption: 'Settings',
    featured: false,
  },
  {
    id: 'popup-log',
    src: '/images/screenshots/popup-log.webp',
    fallback: '/images/screenshots/popup-log.png',
    width: 400,
    height: 640,
    alt: 'DropHunter local claim log grouped by campaign',
    caption: 'Claims',
    featured: false,
  },
] as const;

export const FEATURE_LIST = [
  'Background Twitch Drops farming (hidden tab-less watch or one managed tab)',
  'Campaign queue with drag reorder and favorite auto-start',
  'Auto-claim of completed Twitch Drops',
  'Progress in the popup, toolbar badge, and monitor window',
  'Optional channel-point bonus claims, claim log, JSON backup, language filter, viewer-count picker, desktop or Telegram alerts',
] as const;
