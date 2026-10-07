/** Emulate Twitch's router while retaining the active browser document. */
export const twitchFixtureRouter = `
  if (!Reflect.get(globalThis, '__fixtureRouterInstalled')) {
    Reflect.set(globalThis, '__fixtureRouterInstalled', true);
    let navigation = 0;
    addEventListener('popstate', async () => {
      const revision = ++navigation;
      const target = location.href;
      try {
        const response = await fetch(target);
        const html = await response.text();
        if (revision !== navigation || location.href !== target) return;
        const replacement = new DOMParser().parseFromString(html, 'text/html');
        const main = replacement.querySelector('main') ?? document.createElement('main');
        if (!replacement.querySelector('main')) main.append(...replacement.body.childNodes);
        const scripts = [...main.querySelectorAll('script')];
        document.querySelector('main')?.replaceWith(main);
        document.title = replacement.title;
        for (const script of scripts) new Function(script.textContent ?? '')();
      } catch (error) {
        Reflect.set(globalThis, '__fixtureRouterError', String(error));
      }
    });
  }
`;
