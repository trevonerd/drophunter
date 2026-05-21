import { defineContentScript } from 'wxt/utils/define-content-script';
import { startIntegrityInterceptor } from '../content/integrity-interceptor';
import { TWITCH_MATCHES } from '../shared/extension-manifest';

export default defineContentScript({
  matches: [...TWITCH_MATCHES],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    startIntegrityInterceptor();
  },
});
