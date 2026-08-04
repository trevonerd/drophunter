import { defineContentScript } from 'wxt/utils/define-content-script';
import { startPlaybackKeepalive } from '../content/playback-keepalive';
import { TWITCH_MATCHES } from '../shared/extension-manifest';

export default defineContentScript({
  matches: [...TWITCH_MATCHES],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    startPlaybackKeepalive();
  },
});
