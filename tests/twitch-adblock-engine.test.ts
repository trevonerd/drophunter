import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const pageSource = readFileSync(new URL('../vendor/ttv-ab/page.js', import.meta.url), 'utf8');
const workerSource = readFileSync(new URL('../vendor/ttv-ab/worker.js', import.meta.url), 'utf8');
const nativeUrl = 'https://video-weaver.example.ttvnw.net/native.m3u8';
const backupUrl = 'https://video-weaver.example.ttvnw.net/backup.m3u8';
const playlist = (sequence: number, prefix = 'native') =>
  `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:${sequence}\n` +
  `#EXTINF:2.000,live\nhttps://video-edge.ttvnw.net/${prefix}-${sequence}.ts\n`;
const ad =
  '#EXT-X-DATERANGE:ID="stitched-ad-1",CLASS="twitch-stitched-ad",' +
  'X-TV-TWITCH-AD-RADS-TOKEN="fixture-rad",X-TV-TWITCH-AD-POD-LENGTH="1",' +
  'X-TV-TWITCH-AD-POD-POSITION="1"';

function engine(page = false) {
  let now = 100_000;
  const constants = runInContext(
    `${pageSource.slice(pageSource.indexOf('const _C ='), pageSource.indexOf('const _S ='))}\n_C;`,
    createContext(),
  );
  const context = createContext({
    URL,
    URLSearchParams,
    Request,
    Response,
    Headers,
    EventTarget,
    Event,
    AbortController,
    DOMException,
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    performance,
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    _DROPHUNTER_WORKER_SOURCE: workerSource,
    _TTVAB_WORKER_SEED: { constants, sharedState: {}, playbackCodecEntries: [] },
    postMessage: () => undefined,
  });
  context.self = context;
  context.window = page ? context : undefined;
  const source = page
    ? pageSource
        .replace(/^export function startTwitchAdblock\(_DROPHUNTER_WORKER_SOURCE\) \{\n/m, '')
        .replace(/\n_init\(\);\n}\n$/, '')
    : workerSource.replace(/_startPlaybackWorker\(_TTVAB_WORKER_SEED\);\s*$/, '');
  runInContext(source, context);
  runInContext(
    `
    _declareState(globalThis);
    __TTVAB_STATE__.PageMediaType = 'live';
    __TTVAB_STATE__.PageChannel = 'fixture';
    __TTVAB_STATE__.PageMediaKey = 'live:fixture';
    __TTVAB_STATE__.PagePlaybackContextGeneration = 1;
  `,
    context,
  );
  return {
    context,
    advance: (ms: number) => {
      now += ms;
    },
    run: (code: string) => runInContext(code, context),
  };
}

describe('incorporated Twitch adblock engine', () => {
  test('tolerates pages before the Twitch React player is mounted', () => {
    const { context, run } = engine(true);
    context.document = { querySelector: () => null };
    expect(run('_findReactRoot()')).toBeNull();
    const root: Record<string, unknown> = { isConnected: true };
    context.document = { querySelector: () => root };
    expect(run('_findReactRoot()')).toBeNull();
    root._reactRootContainer = { _internalRoot: { current: { fixture: true } } };
    expect(run('_findReactRoot()')).toEqual({ fixture: true });
  });

  test('counts individual ads once across repeated playlists and playback workers', () => {
    const { context, run } = engine(true);
    const events: string[] = [];
    context.document = { documentElement: { dataset: {} } };
    context.dispatchEvent = (event: Event) => {
      events.push(event.type);
      return true;
    };
    run(`
      _mergeAdPodProgress({ mediaKey: 'live:fixture', cycleStartedAt: Date.now(), adIds: ['ad-1', 'ad-2'] });
      _mergeAdPodProgress({ mediaKey: 'live:fixture', cycleStartedAt: Date.now(), adIds: ['ad-1', 'ad-2'] });
      _mergeAdPodProgress({ mediaKey: 'live:fixture', cycleStartedAt: Date.now(), adIds: ['ad-2', 'ad-3'] });
    `);
    expect(run('document.documentElement.dataset.drophunterAdsBlocked')).toBe('3');
    expect(events).toEqual(['__drophunter_ads_blocked__', '__drophunter_ads_blocked__']);
    run(`
      __TTVAB_STATE__.IsAdStrippingEnabled = false;
      _mergeAdPodProgress({ mediaKey: 'live:fixture', cycleStartedAt: Date.now(), adIds: ['ad-4'] });
    `);
    expect(run('document.documentElement.dataset.drophunterAdsBlocked')).toBe('3');
  });

  test('passes clean playlists unchanged and removes ad segments without removing live segments', () => {
    const { context, run } = engine();
    context.clean = playlist(1).trimEnd();
    context.adPlaylist = `${playlist(1)}${ad}\n#EXTINF:2.000,live\nhttps://video-edge.ttvnw.net/stitched-ad-1.ts\n`;
    expect(run('_stripAds(clean, false, {})')).toBe(context.clean);
    const stripped: string = run('_stripAds(adPlaylist, false, {})');
    expect(stripped).toContain('native-1.ts');
    expect(stripped).not.toContain('stitched-ad-1.ts');
  });

  test('strips VOD ads while retaining the VOD playlist and identity', () => {
    const { context, run } = engine();
    context.clean = `${playlist(1)}#EXT-X-ENDLIST`;
    context.adPlaylist =
      `${playlist(1)}${ad}\n#EXTINF:2.000,ad\n` +
      'https://video-edge.ttvnw.net/stitched-ad-1.ts\n#EXT-X-ENDLIST\n';
    run('globalThis.info = _createStreamInfo({ MediaType: "vod", VodID: "12345" });');
    expect(run('_stripAds(clean, false, info)')).toBe(context.clean);
    const stripped: string = run('_stripAds(adPlaylist, false, info)');
    expect(stripped).toContain('native-1.ts');
    expect(stripped).not.toContain('stitched-ad-1.ts');
    expect(stripped).toContain('#EXT-X-ENDLIST');
    expect(run('[info.MediaType, info.MediaKey, info.VodID]')).toEqual(['vod', 'vod:12345', '12345']);
  });

  test('keeps all three defaults enabled and spoofs each ad only once to Twitch', async () => {
    const { context, run } = engine();
    const requests: { url: string; body: string }[] = [];
    context.capture = async (url: string, options: { body: string }) => {
      requests.push({ url, body: options.body });
      return Response.json({ data: {} });
    };
    context.ad = `${ad}\n`;
    run(`
      _fetchViaWorkerBridge = capture;
      globalThis.info = _createStreamInfo({ MediaType: 'live', ChannelName: 'fixture' });
    `);
    expect(
      run(`[
      __TTVAB_STATE__.IsAdStrippingEnabled,
      __TTVAB_STATE__.DisableAdSpoofing,
      __TTVAB_STATE__.DisableAutoplayBackup
    ]`),
    ).toEqual([true, false, false]);
    await run('_notifyAdComplete(ad, info)');
    const sent = requests.length;
    expect(sent).toBeGreaterThan(0);
    expect(requests.every(({ url }) => url === 'https://gql.twitch.tv/gql')).toBe(true);
    expect(requests.some(({ body }) => body.includes('video_ad_pod_complete'))).toBe(true);
    await run('_notifyAdComplete(ad, info)');
    expect(requests).toHaveLength(sent);
  });

  test('uses a clean low-quality backup and requires advancing native evidence before recovery', async () => {
    const { context, run, advance } = engine();
    context.nativeUrl = nativeUrl;
    context.backupUrl = backupUrl;
    context.backup = playlist(10, 'backup');
    context.adPlaylist = `${playlist(1)}${ad}\n#EXTINF:2.000,ad\nhttps://video-edge.ttvnw.net/stitched-ad-1.ts\n`;
    run(`
      globalThis.info = _createStreamInfo({ MediaType: 'live', ChannelName: 'fixture' });
      const native = {
        Resolution: '1920x1080', Name: 'chunked', Codecs: 'avc1.64002a,mp4a.40.2', Url: nativeUrl
      };
      info.Urls[nativeUrl] = native;
      info.ResolutionList = [native];
      __TTVAB_STATE__.StreamInfos[info.MediaKey] = info;
      __TTVAB_STATE__.StreamInfosByUrl[nativeUrl] = info;
      _notifyAdComplete = async () => {};
      _findBackupStream = async () => {
        info.LastCleanBackupM3U8 = backup;
        info.LastCleanBackupAt = Date.now();
        info.LastCleanBackupCodec = native.Codecs;
        info.LastCleanBackupCodecFamily = 'avc';
        _rememberBackupPlaylistMetadata(info, backup, 'avc', native.Codecs, {
          playerType: 'autoplay', resolution: '640x360', playlistUrl: backupUrl
        });
        return { m3u8: backup, type: 'autoplay' };
      };
    `);
    const fetch = async () => new Response(context.backup);
    context.fetchFixture = fetch;
    const output: string = await run('_processM3U8(nativeUrl, adPlaylist, fetchFixture)');
    expect(output).toContain('backup-10.ts');
    expect(output).not.toContain('stitched-ad');
    run(`
      info.IsHoldingBackupAfterAd = true;
      info.IsShowingAd = false;
      info.NativeRecoveryCandidateStartedAt = 0;
    `);
    context.clean = playlist(20);
    const advanceNative = () =>
      run(`
      _advanceExactNativeRecoveryCandidate(
        info, clean, nativeUrl, true, info.MediaKey, info.VisibleAdStartedAt
      )
    `);
    expect(advanceNative()).toBe('pending');
    advance(20_000);
    expect(advanceNative()).toBe('pending');
    for (let sequence = 21; sequence <= 28; sequence++) {
      context.clean = playlist(sequence);
      advance(2_000);
      const result = advanceNative();
      if (sequence === 28) expect(result).toBe('ready');
    }
  });

  test('retains explicit pause intent and ships no diagnostic or statistics bridge', () => {
    const { run } = engine(true);
    run(`
      _PlaybackIntentState.userPausedMediaKey = 'live:fixture';
    `);
    expect(run('_hasUserPauseIntent("fixture", "live:fixture")')).toBe(true);
    expect(pageSource + workerSource).not.toMatch(
      new RegExp(
        'console\\.|__TTVAB_LOGS__|ttvab-(?:watch-time|ad-blocked|ad-seconds|logs|bridge)' +
          '|WorkerErrorDiagnostic',
      ),
    );
  });

  test.each([false, true])('keeps owned hidden playback suspended (ad active: %p)', (adActive) => {
    const { context, run } = engine(true);
    context.adActive = adActive;
    run(`
      globalThis.location = { href: 'https://www.twitch.tv/fixture' };
      globalThis.document = { documentElement: { dataset: { drophunterPlaybackSuspended: location.href } } };
      globalThis.HTMLMediaElement = class extends EventTarget {
        paused = false;
        ended = false;
        isConnected = true;
        pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
      };
      globalThis.HTMLVideoElement = HTMLMediaElement;
      globalThis.video = new HTMLMediaElement();
      globalThis.resumeAttempts = 0;
      _getPlayerAndState = () => ({ player: { getHTMLVideoElement: () => video } });
      _getPrimaryMediaElement = () => video;
      _isObservedCleanPlaybackFailure = () => false;
      _isUnfocusedPlaybackEnvironment = () => true;
      _resumePrimaryPlaybackIfPaused = _resumeActivePlayerAfterAd = () => {
        resumeAttempts++;
        video.paused = false;
      };
      __TTVAB_STATE__.CurrentAdMediaKey = adActive ? 'live:fixture' : null;
      _syncPrimaryMediaPlaybackIntent();
      video.pause();
    `);
    expect(run('video.paused')).toBe(true);
    expect(run('resumeAttempts')).toBe(0);
    expect(run('_hasUserPauseIntent("fixture", "live:fixture")')).toBe(true);
    expect(run('_doPlayerTask(false, true, { reason: "worker-recovery" })')).toBe(false);

    run('delete document.documentElement.dataset.drophunterPlaybackSuspended; video.pause();');
    expect(run('_hasUserPauseIntent("fixture", "live:fixture")')).toBe(false);
    expect(run('resumeAttempts')).toBe(1);

    run(`
      document.documentElement.dataset.drophunterPlaybackSuspended = 'https://www.twitch.tv/previous';
      video.pause();
    `);
    expect(run('_hasUserPauseIntent("fixture", "live:fixture")')).toBe(false);
    expect(run('resumeAttempts')).toBe(2);
  });
});
