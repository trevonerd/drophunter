export const TWITCH_MATCHES = ['https://*.twitch.tv/*'] as const;

export const EXTENSION_MANIFEST = {
  name: 'DropHunter',
  short_name: 'DropHunter',
  description:
    'Automatically farm and collect Twitch Drops - queue multiple campaigns, track progress in real time, and never miss a reward.',
  homepage_url: 'https://github.com/trevonerd/drophunter',
  minimum_chrome_version: '120',
  permissions: ['storage', 'scripting', 'alarms'],
  optional_permissions: ['notifications'],
  optional_host_permissions: ['https://api.telegram.org/*'],
  host_permissions: TWITCH_MATCHES,
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self';",
  },
  action: {
    default_title: 'DropHunter',
    default_icon: {
      16: '/icons/icon16.png',
      32: '/icons/icon32.png',
      48: '/icons/icon48.png',
      128: '/icons/icon128.png',
    },
  },
  icons: {
    16: '/icons/icon16.png',
    32: '/icons/icon32.png',
    48: '/icons/icon48.png',
    128: '/icons/icon128.png',
  },
} as const;
