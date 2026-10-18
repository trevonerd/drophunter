import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { type Browser, chromium, devices } from '@playwright/test';
import { distRoot, ensureLandingBuilt } from './landing-build';

const viewports = [
  { name: '360', width: 360, height: 800 },
  { name: '390', width: 390, height: 844 },
  { name: '414', width: 414, height: 896 },
] as const;

const mobileProfiles = [
  { name: 'iPhone Safari', userAgent: devices['iPhone 13'].userAgent, deviceScaleFactor: 3 },
  {
    name: 'Android Chrome',
    userAgent: devices['Pixel 5'].userAgent,
    deviceScaleFactor: 2.75,
  },
] as const;

type OverflowHit = {
  tag: string;
  id: string;
  className: string;
  left: number;
  right: number;
};

type OverflowSnapshot = {
  clientWidth: number;
  scrollWidth: number;
  extraX: number;
  clientHeight: number;
  innerWidth: number;
  overflowing: OverflowHit[];
};

function measureOverflow(): OverflowSnapshot {
  const root = document.documentElement;
  const vw = root.clientWidth;
  const overflowing: OverflowHit[] = [];

  const clipsPaint = (style: CSSStyleDeclaration) => {
    const x = style.overflowX;
    return x === 'hidden' || x === 'clip' || x === 'scroll' || x === 'auto';
  };

  const clippedToViewport = (el: Element) => {
    let node = el.parentElement;
    while (node && node !== document.documentElement) {
      const style = getComputedStyle(node);
      if (clipsPaint(style)) {
        const box = node.getBoundingClientRect();
        if (box.left >= -1 && box.right <= vw + 1) return true;
      }
      node = node.parentElement;
    }
    return false;
  };

  for (const el of document.body.querySelectorAll('*')) {
    const style = getComputedStyle(el);
    if (style.position === 'fixed' || style.position === 'sticky') continue;
    if (clippedToViewport(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    const left = rect.left + window.scrollX;
    const right = rect.right + window.scrollX;
    if (right > vw + 1 || left < -1) {
      overflowing.push({
        tag: el.tagName.toLowerCase(),
        id: el.id,
        className: String(el.getAttribute('class') ?? ''),
        left: Math.round(left * 10) / 10,
        right: Math.round(right * 10) / 10,
      });
    }
  }

  return {
    clientWidth: root.clientWidth,
    scrollWidth: root.scrollWidth,
    extraX: root.scrollWidth - root.clientWidth,
    clientHeight: root.clientHeight,
    innerWidth: window.innerWidth,
    overflowing,
  };
}

const mimeByExt: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function listen(server: Server): Promise<number> {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Landing preview server did not bind a port'));
        return;
      }
      resolveListen(address.port);
    });
  });
}

function serveLandingDist(req: IncomingMessage, res: ServerResponse): void {
  void (async () => {
    let path = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
    if (path === '/') path = '/index.html';
    if (path.endsWith('/')) path += 'index.html';
    const relativePath = path.replace(/^\/+/, '');
    if (!relativePath || relativePath.split('/').includes('..')) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const filePath = join(distRoot, relativePath);
    if (!filePath.startsWith(`${distRoot}/`)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    try {
      const body = await readFile(filePath);
      const type = mimeByExt[extname(filePath)] ?? 'application/octet-stream';
      res.writeHead(200, { 'content-type': type }).end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  })();
}

describe('landing mobile viewport overflow', () => {
  let browser: Browser;
  let origin: string;
  let server: Server;

  beforeAll(async () => {
    await ensureLandingBuilt();
    server = createServer(serveLandingDist);
    const port = await listen(server);
    origin = `http://127.0.0.1:${port}`;
    browser = await chromium.launch({ headless: true });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolveClose, reject) => {
      if (!server) {
        resolveClose();
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolveClose();
      });
    });
  });

  for (const viewport of viewports) {
    for (const profile of viewport.name === '390' ? mobileProfiles : mobileProfiles.slice(0, 1)) {
      test(`${profile.name} at ${viewport.width}px does not overflow the layout viewport`, async () => {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          isMobile: true,
          hasTouch: true,
          deviceScaleFactor: profile.deviceScaleFactor,
          userAgent: profile.userAgent,
        });
        const page = await context.newPage();
        await page.goto(`${origin}/`, { waitUntil: 'networkidle', timeout: 30_000 });
        expect(await page.locator('.video-glow').count()).toBe(1);
        const snapshot = await page.evaluate(measureOverflow);
        await context.close();

        expect(snapshot.extraX, JSON.stringify(snapshot, null, 2)).toBe(0);
        expect(snapshot.scrollWidth).toBe(snapshot.clientWidth);
        expect(snapshot.innerWidth).toBe(snapshot.clientWidth);
        expect(snapshot.overflowing).toEqual([]);
      }, 30_000);
    }
  }
});
