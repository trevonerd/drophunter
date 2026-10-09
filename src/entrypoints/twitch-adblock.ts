import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { startTwitchAdblock } from '../../vendor/ttv-ab/page.js';
import workerSource from '../../vendor/ttv-ab/worker.js?raw';

export default defineUnlistedScript(() => startTwitchAdblock(workerSource));
