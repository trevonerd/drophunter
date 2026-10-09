import { defineContentScript } from 'wxt/utils/define-content-script';
import { TWITCH_MATCHES } from '../shared/extension-manifest.ts';
import { sendRuntimeMessage } from '../shared/messages.ts';

export default defineContentScript({
  matches: [...TWITCH_MATCHES],
  runAt: 'document_start',
  allFrames: true,
  main(ctx) {
    let reported = 0;
    let pending = Promise.resolve();
    const report = () => {
      pending = pending
        .then(async () => {
          const count = Number(document.documentElement?.dataset.drophunterAdsBlocked);
          if (!Number.isSafeInteger(count) || count <= reported) return;
          const response = await sendRuntimeMessage({
            type: 'TWITCH_ADS_BLOCKED',
            payload: { count: count - reported },
          });
          if (response?.success) reported = count;
        })
        .catch(() => undefined);
    };
    ctx.addEventListener(window, '__drophunter_ads_blocked__', report);
    report();
  },
});
