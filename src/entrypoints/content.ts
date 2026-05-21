import { defineContentScript } from 'wxt/utils/define-content-script';
import { startContentScript } from '../content/content-script';
import { TWITCH_MATCHES } from '../shared/extension-manifest';

export default defineContentScript({
  matches: [...TWITCH_MATCHES],
  runAt: 'document_idle',
  main() {
    startContentScript();
  },
});
