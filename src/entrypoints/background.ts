import { defineBackground } from 'wxt/utils/define-background';
import { startServiceWorker } from '../background/service-worker';

export default defineBackground({
  type: 'module',
  main() {
    startServiceWorker();
  },
});
