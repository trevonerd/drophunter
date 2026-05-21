import { browser as wxtBrowser } from 'wxt/browser';

type BrowserApi = typeof wxtBrowser;

function resolveBrowserApi(): BrowserApi {
  const globals = globalThis as typeof globalThis & {
    browser?: BrowserApi;
    chrome?: BrowserApi;
  };
  return globals.browser ?? globals.chrome ?? wxtBrowser;
}

export const browser = new Proxy({} as BrowserApi, {
  get(_target, property) {
    return resolveBrowserApi()[property as keyof BrowserApi];
  },
});
