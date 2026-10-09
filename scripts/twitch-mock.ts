// Minimal local stand-in for gql.twitch.tv, used by scripts/store-screenshots.ts.
// Serves only the GQL operations the extension's campaign sync needs.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface MockDrop {
  readonly id: string;
  readonly name: string;
  readonly requiredMinutes: number;
  readonly currentMinutes: number;
}
export interface MockCampaign {
  readonly id: string;
  readonly gameId: string;
  readonly game: string;
  readonly name: string;
  readonly drops: readonly MockDrop[];
}

/** Deterministic placeholder artwork: a gradient tile with a simple shape, no text. */
export function mockArtUrl(name: string): string {
  return `https://www.twitch.tv/mock-art/${encodeURIComponent(name)}.svg`;
}

function artSvg(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  const shapes = [
    '<circle cx="50" cy="50" r="22" fill="white" fill-opacity=".9"/>',
    '<polygon points="50,22 78,50 50,78 22,50" fill="white" fill-opacity=".9"/>',
    '<polygon points="50,20 59,41 82,43 64,58 70,80 50,68 30,80 36,58 18,43 41,41" fill="white" fill-opacity=".9"/>',
    '<rect x="28" y="28" width="44" height="44" rx="10" fill="white" fill-opacity=".9"/>',
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 80% 60%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360} 75% 35%)"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/>${shapes[h % shapes.length]}</svg>`;
}

export async function startTwitchMock(campaigns: readonly MockCampaign[]) {
  const dir = await mkdtemp(join(tmpdir(), 'drophunter-mock-'));
  const key = join(dir, 'key.pem');
  const cert = join(dir, 'cert.pem');
  const openssl = Bun.spawnSync(
    ['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=gql.twitch.tv'],
    { stderr: 'ignore' },
  );
  if (openssl.exitCode !== 0) throw new Error('openssl failed to create the mock certificate');

  const endAt = new Date(Date.now() + 2 * 24 * 3600_000).toISOString();
  const timeBasedDrops = (c: MockCampaign) =>
    c.drops.map((d) => ({
      id: d.id,
      name: d.name,
      requiredMinutesWatched: d.requiredMinutes,
      imageURL: mockArtUrl(d.name),
      benefitEdges: [],
      self: { currentMinutesWatched: d.currentMinutes, isClaimed: false, isClaimable: false },
    }));
  const slug = (c: MockCampaign) => c.game.toLowerCase().replace(/\W+/g, '-');
  const game = (c: MockCampaign) => ({
    id: c.gameId,
    displayName: c.game,
    name: c.game,
    slug: slug(c),
    boxArtURL: mockArtUrl(c.game),
  });
  // Every game gets live channels named `<slug>_<n>`, so a channel login identifies its campaign.
  const channelsFor = (c: MockCampaign) => [1, 2, 3].map((n) => `${slug(c)}_${n}`);
  const campaignOfChannel = (login: string) => campaigns.find((c) => login.startsWith(`${slug(c)}_`));

  const answer = (op: { operationName?: string; variables?: { dropID?: string } }): unknown => {
    switch (op.operationName) {
      case 'ViewerDropsDashboard':
        return {
          data: {
            currentUser: {
              dropCampaigns: campaigns.map((c) => ({
                id: c.id, name: c.name, status: 'ACTIVE', endAt, game: game(c), timeBasedDrops: timeBasedDrops(c), eventBasedDrops: [],
              })),
            },
          },
        };
      case 'Inventory':
        return {
          data: {
            currentUser: {
              inventory: {
                dropCampaignsInProgress: campaigns.map((c) => ({
                  id: c.id, game: { displayName: c.game }, timeBasedDrops: timeBasedDrops(c),
                })),
                gameEventDrops: [],
              },
            },
          },
        };
      case 'DropCampaignDetails': {
        const c = campaigns.find((x) => x.id === op.variables?.dropID);
        if (!c) return { data: { user: { dropCampaign: null } } };
        return {
          data: {
            user: {
              dropCampaign: {
                id: c.id, name: c.name, status: 'ACTIVE', endAt, game: game(c), self: { isAccountConnected: true },
                timeBasedDrops: timeBasedDrops(c), eventBasedDrops: [],
              },
            },
          },
        };
      }
      case 'StreamInfo': {
        const login = (op as { variables?: { channel?: string } }).variables?.channel ?? '';
        const c = campaignOfChannel(login);
        if (!c) return { data: { user: null } };
        return {
          data: { user: { id: `id-${login}`, stream: { id: `broadcast-${login}`, type: 'live', game: { id: c.gameId, name: c.game } } } },
        };
      }
      case 'DirectoryPage_Game': {
        const c = campaigns.find((x) => slug(x) === (op as { variables?: { slug?: string } }).variables?.slug);
        return {
          data: {
            game: {
              streams: {
                edges: (c ? channelsFor(c) : []).map((login, i) => ({
                  node: {
                    id: `stream-${i}`,
                    broadcaster: { id: `10${i}`, login, displayName: login },
                    viewersCount: 4200 - i * 900,
                    broadcasterLanguage: 'EN',
                    title: 'Drops enabled',
                  },
                })),
              },
            },
          },
        };
      }
      default:
        return { data: {} };
    }
  };

  const server = Bun.serve({
    port: 0,
    tls: { key: Bun.file(key), cert: Bun.file(cert) },
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === '/track') return new Response(null, { status: 204 });
      if (pathname.startsWith('/mock-art/'))
        return new Response(artSvg(decodeURIComponent(pathname.slice(10, -4))), { headers: { 'content-type': 'image/svg+xml' } });
      if (req.method === 'GET') return new Response('<html><script>var c={"spade_url":"https://spade.twitch.tv/track"}</script></html>', { headers: { 'content-type': 'text/html' } });
      if (pathname === '/integrity') return Response.json({ token: 'mock-integrity-token', expiration: Date.now() + 3600_000 });
      const body: unknown = await req.json().catch(() => ({}));
      const res = Array.isArray(body) ? body.map(answer as (op: unknown) => unknown) : answer(body as never);
      return Response.json(res);
    },
  });

  return {
    port: server.port,
    async stop() {
      await server.stop(true);
      await rm(dir, { recursive: true, force: true });
    },
  };
}
