// Adapted from TTV-AB v20.0.0, GosuDRM.
// https://github.com/GosuDRM/TTV-AB/tree/11c2a7ea17fcda83c21129e3bfddd208385be142
// See public/licenses/ttv-ab.txt.
const _C = _TTVAB_WORKER_SEED.constants;
function _createWorkerBridgeMessage(message) {
  if (!message || typeof message != "object" || Array.isArray(message))
    return null;
  const key = message.key;
  return typeof key != "string" || !key ? null : {
    __ttvabWorkerBridge: !0,
    message
  };
}
function _hasWorkerMessageFields(value, fields = {}) {
  if (!value || typeof value != "object" || Array.isArray(value))
    return !1;
  const payload = value, contextFields = {
    MediaType: "string",
    mediaType: "string",
    ChannelName: "string",
    channelName: "string",
    login: "string",
    VodID: "vod",
    vodID: "vod",
    videoID: "vod",
    MediaKey: "string",
    mediaKey: "string"
  };
  for (const [field, kind] of Object.entries({ ...contextFields, ...fields })) {
    const entry = payload[field];
    if (entry !== void 0 && !(kind === "string" && (entry === null || typeof entry == "string")) && !(kind === "vod" && (entry === null || typeof entry == "string" || typeof entry == "number" && Number.isFinite(entry))) && !(kind === "boolean" && typeof entry == "boolean") && !(kind === "number" && typeof entry == "number" && Number.isFinite(entry)))
      return !1;
  }
  return !0;
}
function _getWorkerBridgeMessage(value) {
  if (!value || typeof value != "object" || Array.isArray(value))
    return null;
  const envelope = value;
  if (envelope.__ttvabWorkerBridge !== !0)
    return null;
  const message = envelope.message;
  if (!message || typeof message != "object" || Array.isArray(message) || typeof message.key != "string" || !message.key)
    return null;
  for (const field of ["channel", "mediaKey", "handoffId"])
    if (message[field] != null && typeof message[field] != "string")
      return null;
  return message;
}
function _postWorkerBridgeMessage(target, message) {
  if (!target || typeof target.postMessage != "function")
    return !1;
  const envelope = _createWorkerBridgeMessage(message);
  return envelope ? (target.postMessage(envelope), !0) : !1;
}
function _invalidateAdCycleAsyncWork(info) {
  return info ? (info.BackupSearchEpoch = Math.max(0, Number(info.BackupSearchEpoch) || 0) + 1, info._BackupSearchPromises?.clear?.(), info._BackupSearchPromise = null, info._BackupSearchKey = null, info._BackupSearchStartedAt = 0, info._BackupSearchStartToken = null, info._LastBackupSearchCompletedAt = 0, info._BackupProbation = null, info.BackupPlaylistMetadata?.clear?.(), info.LastCleanBackupM3U8 = null, info.LastCleanBackupResolution = null, info.LastCleanBackupAt = 0, info._IncompletePodCleanStartedAt = 0, info._IncompletePodCleanPlaylistCount = 0, info._IncompletePodLastMediaSequence = null, info._IncompletePodCandidateUrl = null, info.NativeRecoveryProbeEpoch = Math.max(0, Number(info.NativeRecoveryProbeEpoch) || 0) + 1, info._NativeRecoveryProbeInFlight = !1, info._NativeRecoveryProbeToken = null, info.LastNativeRecoveryProbeAt = 0, info.LastNativeRecoveryReadyPlayerType = null, info.NativeRecoveryCleanCount = 0, info.NativeRecoveryProbeStreamUrl = null, info.NativeRecoveryProbeMediaKey = null, info.NativeRecoveryProbePlayerType = null, info.NativeRecoveryProbeCycleStartedAt = 0, info.NativeRecoveryProbeLastMediaSequence = null, info.NativeRecoveryProbeLastAdvancedAt = 0, info.NativeRecoveryAdPlaylistUrls?.clear?.(), info.NativeRecoveryAdMediaKey = null, info.NativeRecoveryAdStartedAt = 0, info.NativeRecoveryCandidateUrl = null, info.NativeRecoveryCandidateMediaKey = null, info.NativeRecoveryCandidateCycleStartedAt = 0, info.NativeRecoveryCandidateStage = null, info.NativeRecoveryCandidateStartedAt = 0, info.NativeRecoveryCandidateCleanCount = 0, info.NativeRecoveryCandidateLastMediaSequence = null, info.ConsecutiveFailedNativeProbes = 0, info._FatalMediaRecoveryRequestId = null, info.RequestedAds?.clear?.(), info._AdRequestController && (info._AdRequestController.abort?.(), info._AdRequestController = null), info._AdCycleRequestController && (info._AdCycleRequestController.abort?.(), info._AdCycleRequestController = null), !0) : !1;
}
function _mergeAdPodProgress(value) {
  const mediaKey = _normalizePlaybackContext(value).MediaKey;
  if (!mediaKey)
    return null;
  (!__TTVAB_STATE__.AdPodProgressByMediaKey || typeof __TTVAB_STATE__.AdPodProgressByMediaKey != "object") && (__TTVAB_STATE__.AdPodProgressByMediaKey = /* @__PURE__ */ Object.create(null));
  const incomingCycleStartedAt = Math.max(0, Number(value?.cycleStartedAt) || 0), current = __TTVAB_STATE__.AdPodProgressByMediaKey[mediaKey] || null, currentCycleStartedAt = Math.max(0, Number(current?.cycleStartedAt) || 0);
  if (current && incomingCycleStartedAt > 0 && currentCycleStartedAt > incomingCycleStartedAt || current && currentCycleStartedAt > 0 && incomingCycleStartedAt <= 0)
    return current;
  const shouldReplace = !current || incomingCycleStartedAt > 0 && incomingCycleStartedAt > currentCycleStartedAt, adIds = new Set(shouldReplace ? [] : Array.isArray(current?.adIds) ? current.adIds : []);
  if (Array.isArray(value?.adIds))
    for (const adId of value.adIds)
      typeof adId == "string" && adId && adIds.add(adId);
  const entry = {
    adIds: Array.from(adIds).slice(-50),
    expectedPodLength: Math.max(shouldReplace ? 0 : Math.max(0, Number(current?.expectedPodLength) || 0), Math.max(0, Number(value?.expectedPodLength) || 0)),
    maxAdPodPosition: Math.max(shouldReplace ? 0 : Math.max(0, Number(current?.maxAdPodPosition) || 0), Math.max(0, Number(value?.maxAdPodPosition) || 0)),
    observedZeroAdPodPosition: !shouldReplace && current?.observedZeroAdPodPosition === !0 || value?.observedZeroAdPodPosition === !0,
    cycleStartedAt: shouldReplace ? incomingCycleStartedAt || currentCycleStartedAt || Date.now() : currentCycleStartedAt || incomingCycleStartedAt || Date.now(),
    updatedAt: Date.now()
  };
  return __TTVAB_STATE__.AdPodProgressByMediaKey[mediaKey] = entry, entry;
}
function _applyAdPodProgressToInfo(info, value) {
  if (!info)
    return null;
  const incomingCycleStartedAt = Math.max(0, Number(value?.cycleStartedAt) || 0);
  if (incomingCycleStartedAt > 0 && incomingCycleStartedAt < Math.max(0, Number(info.VisibleAdStartedAt) || 0))
    return __TTVAB_STATE__.AdPodProgressByMediaKey?.[info.MediaKey] || null;
  const entry = _mergeAdPodProgress({
    ...value,
    mediaType: info.MediaType,
    channelName: info.ChannelName,
    vodID: info.VodID,
    mediaKey: info.MediaKey
  });
  if (!entry)
    return null;
  const previousCycleStartedAt = Math.max(0, Number(info.VisibleAdStartedAt) || 0), nextCycleStartedAt = Math.max(0, Number(entry.cycleStartedAt) || 0);
  nextCycleStartedAt > 0 && nextCycleStartedAt !== previousCycleStartedAt && _invalidateAdCycleAsyncWork(info), info.ObservedAdPodIds instanceof Set || (info.ObservedAdPodIds = /* @__PURE__ */ new Set());
  for (const adId of entry.adIds)
    info.ObservedAdPodIds.add(adId);
  return info.ExpectedAdPodLength = Math.max(Math.max(0, Number(info.ExpectedAdPodLength) || 0), Math.max(0, Number(entry.expectedPodLength) || 0)), info.MaxObservedAdPodPosition = Math.max(Math.max(0, Number(info.MaxObservedAdPodPosition) || 0), Math.max(0, Number(entry.maxAdPodPosition) || 0)), info.ObservedZeroAdPodPosition = info.ObservedZeroAdPodPosition === !0 || entry.observedZeroAdPodPosition === !0, info.LastAdPodProgressAt = Math.max(0, Number(entry.updatedAt) || 0), info._IncompletePodCleanStartedAt = 0, info._IncompletePodCleanPlaylistCount = 0, info._IncompletePodLastMediaSequence = null, info._IncompletePodCandidateUrl = null, info.NativeRecoveryCandidateUrl = null, info.NativeRecoveryCandidateMediaKey = null, info.NativeRecoveryCandidateCycleStartedAt = 0, info.NativeRecoveryCandidateStage = null, info.NativeRecoveryCandidateStartedAt = 0, info.NativeRecoveryCandidateCleanCount = 0, info.NativeRecoveryCandidateLastMediaSequence = null, nextCycleStartedAt > 0 && (info.VisibleAdStartedAt = nextCycleStartedAt, (!info._AdCycleRequestController || info._AdCycleRequestController.signal?.aborted) && typeof AbortController == "function" && (info._AdCycleRequestController = new AbortController())), entry;
}
function _clearAdPodProgress(mediaKey, beforeCycleStartedAt = 0) {
  const normalizedMediaKey = _normalizeMediaKey(mediaKey);
  if (!normalizedMediaKey)
    return !1;
  const cycleBoundary = Math.max(0, Number(beforeCycleStartedAt) || 0);
  let didClear = !1;
  const progress = __TTVAB_STATE__.AdPodProgressByMediaKey?.[normalizedMediaKey];
  progress && (!cycleBoundary || Math.max(0, Number(progress.cycleStartedAt) || 0) < cycleBoundary) && (delete __TTVAB_STATE__.AdPodProgressByMediaKey[normalizedMediaKey], didClear = !0);
  const streamInfos = Object.values(__TTVAB_STATE__.StreamInfos || {});
  for (const info of streamInfos)
    _normalizeMediaKey(info?.MediaKey) === normalizedMediaKey && (cycleBoundary && Math.max(0, Number(info.VisibleAdStartedAt) || 0) >= cycleBoundary || (Math.max(0, Number(info.VisibleAdStartedAt) || 0) > 0 && _invalidateAdCycleAsyncWork(info), info.ObservedAdPodIds?.clear?.(), info.ExpectedAdPodLength = 0, info.MaxObservedAdPodPosition = 0, info.ObservedZeroAdPodPosition = !1, info.LastAdPodProgressAt = 0, info._IncompletePodCleanStartedAt = 0, info._IncompletePodCleanPlaylistCount = 0, info._IncompletePodLastMediaSequence = null, info._IncompletePodCandidateUrl = null, info.NativeRecoveryCandidateUrl = null, info.NativeRecoveryCandidateMediaKey = null, info.NativeRecoveryCandidateCycleStartedAt = 0, info.NativeRecoveryCandidateStage = null, info.NativeRecoveryCandidateStartedAt = 0, info.NativeRecoveryCandidateCleanCount = 0, info.NativeRecoveryCandidateLastMediaSequence = null, info.NativeRecoveryAdPlaylistUrls?.clear?.(), info.NativeRecoveryAdMediaKey = null, info.NativeRecoveryAdStartedAt = 0, info.VisibleAdStartedAt = 0, didClear = !0));
  return didClear;
}
function _declareState(scope) {
  scope.__TTVAB_STATE__ = {
    AdSignifier: _C.AD_SIGNIFIER,
    BackupPlayerTypes: [..._C.PLAYER_TYPES],
    FallbackPlayerType: _C.FALLBACK_TYPE,
    ForceAccessTokenPlayerType: _C.FORCE_TYPE,
    RewriteNativePlaybackAccessToken: _C.REWRITE_NATIVE_PLAYBACK_ACCESS_TOKEN ?? !1,
    PlayerBufferingDoPlayerReload: _C.PLAYER_BUFFERING_DO_PLAYER_RELOAD ?? !1,
    PlayerReloadMinimalRequestsTime: _C.RELOAD_TIME,
    PlayerReloadMinimalRequestsPlayerIndex: Math.max(0, _C.PLAYER_TYPES.indexOf("autoplay") > -1 ? _C.PLAYER_TYPES.indexOf("autoplay") : _C.PLAYER_TYPES.indexOf(_C.FALLBACK_TYPE)),
    PlayerReloadDebounceMs: _C.PLAYER_RELOAD_DEBOUNCE_MS ?? 1500,
    AdCycleStaleMs: _C.AD_CYCLE_STALE_MS ?? 3e4,
    AdEndGraceMs: _C.AD_END_GRACE_MS ?? 500,
    AdEndMaxWaitMs: _C.AD_END_MAX_WAIT_MS ?? 4e3,
    AdEndBackupHoldMaxMs: _C.AD_END_BACKUP_HOLD_MAX_MS ?? 9e4,
    AdEndBounceDebounceMs: 3e3,
    SilentBackupHoldMaxMs: 12e4,
    AdEndMinCleanPlaylists: _C.AD_END_MIN_CLEAN_PLAYLISTS ?? 3,
    AdEndMinNativeRecoveryProbes: _C.AD_END_MIN_NATIVE_RECOVERY_PROBES ?? 3,
    AdEndNativeRecoveryProbeCooldownMs: _C.AD_END_NATIVE_RECOVERY_PROBE_COOLDOWN_MS ?? 500,
    AdEndMaxFailedNativeProbes: _C.AD_END_MAX_FAILED_NATIVE_PROBES ?? 6,
    AdRecoveryReloadCooldownMs: _C.AD_RECOVERY_RELOAD_COOLDOWN_MS ?? 3e4,
    PinnedBackupStallDetectionMs: _C.PINNED_BACKUP_STALL_DETECTION_MS ?? 3e3,
    PinnedBackupStallPollMs: _C.PINNED_BACKUP_STALL_POLL_MS ?? 1500,
    BackupSearchForceRefreshAt: 0,
    LastPinnedBackupStallDetectedAt: 0,
    LqHqHoldMinMs: _C.LQ_HQ_HOLD_MIN_MS ?? 8e3,
    HasTriggeredPlayerReload: !1,
    PendingTriggeredPlayerReloadChannel: null,
    PendingTriggeredPlayerReloadMediaKey: null,
    PendingTriggeredPlayerReloadAt: 0,
    PendingTriggeredPlayerReloadCycleStartedAt: 0,
    LastPlayerReloadAt: 0,
    LastPlayerReloadAtByMediaKey: /* @__PURE__ */ Object.create(null),
    LastAdDetectedAt: 0,
    LastAdEndedAt: 0,
    LastAdEndedChannel: null,
    LastAdEndedMediaKey: null,
    LastAdEndedCycleStartedAt: 0,
    LastAdRecoveryReloadAt: 0,
    LastAdRecoveryResumeAt: 0,
    CurrentAdChannel: null,
    CurrentAdMediaKey: null,
    PinnedBackupPlayerType: null,
    PinnedBackupPlayerChannel: null,
    PinnedBackupPlayerMediaKey: null,
    ActiveCodecHandoffId: null,
    ActiveCodecHandoffChannel: null,
    ActiveCodecHandoffMediaKey: null,
    AdPodProgressByMediaKey: /* @__PURE__ */ Object.create(null),
    ShouldResumeAfterAd: !1,
    ShouldResumeAfterAdChannel: null,
    ShouldResumeAfterAdMediaKey: null,
    ShouldResumeAfterAdUntil: 0,
    StreamInfos: /* @__PURE__ */ Object.create(null),
    StreamInfosByUrl: /* @__PURE__ */ Object.create(null),
    GQLDeviceID: null,
    ClientVersion: null,
    ClientSession: null,
    ClientIntegrityHeader: null,
    AuthorizationHeader: null,
    SimulatedAdsDepth: 0,
    V2API: !1,
    IsAdStrippingEnabled: !0,
    IsBufferFixEnabled: _C.BUFFERING_FIX,
    AdSegmentCache: /* @__PURE__ */ new Map(),
    SegmentCodecOwners: /* @__PURE__ */ new Map(),
    PlayerBufferingDelay: 600,
    PlayerBufferingSameStateCount: 5,
    PlayerBufferingDangerZone: 1,
    PlayerBufferingMinRepeatDelay: 8e3,
    PlayerBufferingPrerollCheckEnabled: !1,
    PlayerBufferingPrerollCheckOffset: 5,
    AllSegmentsAreAdSegments: !1,
    PlaybackAccessTokenHash: null,
    LastNativePlaybackAccessTokenPlayerType: null,
    PageMediaType: null,
    PageChannel: null,
    PageVodID: null,
    PageMediaKey: null,
    PagePlaybackRouteKey: null,
    PagePlaybackContextGeneration: 0,
    AllowPreviewEmergencyAutoplayBackup: !1,
    PagePlaybackVisibleSinceAt: 0,
    PreferredQualityGroup: null,
    PlayerHasPlayedOnce: !1,
    PlayerIsPlaying: !1,
    PendingFetchRequests: /* @__PURE__ */ new Map(),
    FetchRequestSeq: 0,
    _AdRecoveryConsecutiveFailures: 0,
    DisableAdSpoofing: !1,
    DisableAutoplayBackup: !1
  };
}
function _getPageScopedPlaybackEventContext() {
  if (typeof __TTVAB_STATE__ > "u" || !__TTVAB_STATE__)
    return {
      pageChannel: null,
      pageMediaKey: null,
      pageContextGeneration: 0
    };
  const pageContext = _normalizePlaybackContext({
    MediaType: __TTVAB_STATE__.PageMediaType,
    ChannelName: __TTVAB_STATE__.PageChannel,
    VodID: __TTVAB_STATE__.PageVodID,
    MediaKey: __TTVAB_STATE__.PageMediaKey
  });
  return {
    pageChannel: pageContext.ChannelName,
    pageMediaKey: pageContext.MediaKey,
    pageContextGeneration: Math.max(0, Number(__TTVAB_STATE__.PagePlaybackContextGeneration) || 0)
  };
}
function _createPageScopedWorkerEvent(value) {
  const pageEventContext = _getPageScopedPlaybackEventContext();
  return {
    ...value,
    pageChannel: pageEventContext.pageChannel,
    pageMediaKey: pageEventContext.pageMediaKey,
    pageContextGeneration: pageEventContext.pageContextGeneration
  };
}
const _ATTR_REGEX = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi, _AD_METADATA_RE = /stitched-ad|X-TV-TWITCH-AD|\/adsquared\/|SCTE35-OUT|EXT-X-CUE-OUT|EXT-X-DATERANGE:(?:[^\r\n]*,)?CLASS="twitch-(?:stitched-)?ad(?:-|")|"(?:MIDROLL|midroll)"/, _EMPTY_SEGMENT_URL = "data:video/mp4;base64,AAAAHGZ0eXBtcDQyAAACAG1wNDJpc282bXA0MQAABMdtb292AAAAbG12aGQAAAAAAAAAAAAAAAAAALuAAAAAAAABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAB63RyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAACgAAAAWgAAAAAAYdtZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAAEAAAAAAAFXEAAAAAAAtaGRscgAAAAAAAAAAdmlkZQAAAAAAAAAAAAAAAFZpZGVvSGFuZGxlcgAAAAEybWluZgAAABR2bWhkAAAAAQAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAA8nN0YmwAAACmc3RzZAAAAAAAAAABAAAAlmF2YzEAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAACgAFoAEgAAABIAAAAAAAAAAEUTGF2YzYzLjEuMTAxIGxpYngyNjQAAAAAAAAAAAAAAAAY//8AAAAwYXZjQwFCwB7/4QAYZ0LAHtwKAv+XARAAAAMAEAAAAwAg8WL4AQAFaM4PEyAAAAAQcGFzcAAAAAEAAAABAAAAEHN0dHMAAAAAAAAAAAAAABBzdHNjAAAAAAAAAAAAAAAUc3RzegAAAAAAAAAAAAAAAAAAABBzdGNvAAAAAAAAAAAAAAG/dHJhawAAAFx0a2hkAAAAAwAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAABAQAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAABW21kaWEAAAAgbWRoZAAAAAAAAAAAAAAAAAAAu4AAAAAAVcQAAAAAAC1oZGxyAAAAAAAAAABzb3VuAAAAAAAAAAAAAAAAU291bmRIYW5kbGVyAAAAAQZtaW5mAAAAEHNtaGQAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAMpzdGJsAAAAfnN0c2QAAAAAAAAAAQAAAG5tcDRhAAAAAAAAAAEAAAAAAAAAAAACABAAAAAAu4AAAAAAADZlc2RzAAAAAAOAgIAlAAIABICAgBdAFQAAAAAAfQAAAH0ABYCAgAURkFblAAaAgIABAgAAABRidHJ0AAAAAAAAfQAAAH0AAAAAEHN0dHMAAAAAAAAAAAAAABBzdHNjAAAAAAAAAAAAAAAUc3RzegAAAAAAAAAAAAAAAAAAABBzdGNvAAAAAAAAAAAAAABIbXZleAAAACB0cmV4AAAAAAAAAAEAAAABAAAAAAAAAAAAAAAAAAAAIHRyZXgAAAAAAAAAAgAAAAEAAAAAAAAAAAAAAAAAAABhdWR0YQAAAFltZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAACxpbHN0AAAAJKl0b28AAAAcZGF0YQAAAAEAAAAATGF2ZjYzLjEuMTAxAAACNG1vb2YAAAAQbWZoZAAAAAAAAAABAAAAUHRyYWYAAAAcdGZoZAACADgAAAABAABBXgAABTMBAQAAAAAAFHRmZHQBAAAAAAAAAAAAAAAAAAAYdHJ1bgAAAAUAAAABAAACPAIAAAAAAAHMdHJhZgAAABx0ZmhkAAIAOAAAAAIAAAQAAAAAFQIAAAAAAAAUdGZkdAEAAAAAAAAAAAAAAAAAAZR0cnVuAAADAQAAADAAAAdvAAAEAAAAABUAAAQAAAAABgAABAAAAAAGAAAEAAAAAAYAAAQAAAAABgAABAAAAAAGAAAEAAAAAAYAAAQAAAAABgAABAAAAAAGAAAEAAAAAAYAAAQAAAAABgAABAAAAAAGAAAEAAAAAAYAAAQAAAAABgAABAAAAAAGAAAEAAAAAAYAAAQAAAAABgAABAAAAAAGAAAEAAAAAAYAAAQAAAAABgAABAAAAAAGAAAEAAAAAAYAAAQAAAAABgAABAAAAAAGAAAEAAAAAAYAAAQAAAAABgAABAAAAAAGAAAEAAAAAAYAAAQAAAAABgAABAAAAAAGAAAEAAAAAAYAAAQAAAAABgAABAAAAAAGAAAEAAAAAAYAAAQAAAAABgAABAAAAAAGAAAEAAAAAAYAAAQAAAAABgAABAAAAAAGAAAEAAAAAAYAAAQAAAAABgAABAAAAAAGAAAEAAAAAAYAAAQAAAAABgAABAAAAAAGAAAEAAAAAAYAAAQAAAAABgAAA4AAAAAGAAAGam1kYXQAAAJhBgX//13cRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIyIGIzNTYwNWEgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MCByZWY9MSBkZWJsb2NrPTE6LTM6LTMgYW5hbHlzZT0weDE6MHgxMzEgbWU9dW1oIHN1Ym1lPTEwIHBzeT0xIHBzeV9yZD0yLjAwOjAuNzAgbWl4ZWRfcmVmPTAgbWVfcmFuZ2U9MjQgY2hyb21hX21lPTEgdHJlbGxpcz0yIDh4OGRjdD0wIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS00IHRocmVhZHM9MTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0wIHdlaWdodHA9MCBrZXlpbnQ9MSBrZXlpbnRfbWluPTEgc2NlbmVjdXQ9MCBpbnRyYV9yZWZyZXNoPTAgcmM9Y3JmIG1idHJlZT0wIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4yMACAAAACymWIhAVzn///D0UAAULfJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJycnXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXgNwATGF2YzYzLjEuMTAxAEIgCMEYOCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHCEQBGCMHAAAAG5tZnJhAAAAK3RmcmEBAAAAAAAAAQAAAAAAAAABAAAAAAAAAAAAAAAAAAAE4wEBAQAAACt0ZnJhAQAAAAAAAAIAAAAAAAAAAQAAAAAAAAAAAAAAAAAABOMBAQEAAAAQbWZybwAAAAAAAABu";
function _normalizeChannelName(value) {
  if (typeof value != "string")
    return null;
  const trimmed = value.trim().toLowerCase();
  return /^[a-z0-9_]{1,25}$/.test(trimmed) ? trimmed : null;
}
function _normalizeVodID(value) {
  if (typeof value == "number" && Number.isFinite(value) && (value = String(Math.trunc(value))), typeof value != "string")
    return null;
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? trimmed : null;
}
function _buildMediaKey(mediaType, channelName = null, vodID = null) {
  if (mediaType === "vod") {
    const safeVodID = _normalizeVodID(vodID);
    return safeVodID ? `vod:${safeVodID}` : null;
  }
  const safeChannel = _normalizeChannelName(channelName);
  return safeChannel ? `live:${safeChannel}` : null;
}
function _normalizeMediaKey(value) {
  if (typeof value != "string")
    return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("live:") ? _buildMediaKey("live", trimmed.slice(5), null) : trimmed.startsWith("vod:") ? _buildMediaKey("vod", null, trimmed.slice(4)) : null;
}
function _normalizePlaybackContext(context) {
  const channelName = _normalizeChannelName(context?.ChannelName ?? context?.channelName ?? context?.login ?? null), vodID = _normalizeVodID(context?.VodID ?? context?.vodID ?? context?.videoID ?? null), explicitMediaType = context?.MediaType === "vod" || context?.mediaType === "vod" ? "vod" : context?.MediaType === "live" || context?.mediaType === "live" ? "live" : null, explicitMediaKey = _normalizeMediaKey(context?.MediaKey ?? context?.mediaKey ?? null);
  return explicitMediaKey?.startsWith("vod:") ? {
    MediaType: "vod",
    ChannelName: null,
    VodID: explicitMediaKey.slice(4),
    MediaKey: explicitMediaKey
  } : explicitMediaKey?.startsWith("live:") ? {
    MediaType: "live",
    ChannelName: explicitMediaKey.slice(5),
    VodID: null,
    MediaKey: explicitMediaKey
  } : explicitMediaType === "vod" && vodID ? {
    MediaType: "vod",
    ChannelName: null,
    VodID: vodID,
    MediaKey: _buildMediaKey("vod", null, vodID)
  } : (explicitMediaType === "live" || !explicitMediaType) && channelName ? {
    MediaType: "live",
    ChannelName: channelName,
    VodID: null,
    MediaKey: _buildMediaKey("live", channelName, null)
  } : vodID ? {
    MediaType: "vod",
    ChannelName: null,
    VodID: vodID,
    MediaKey: _buildMediaKey("vod", null, vodID)
  } : {
    MediaType: null,
    ChannelName: null,
    VodID: null,
    MediaKey: null
  };
}
function _getPlaybackContextFromUsherUrl(rawUrl) {
  let parsedUrl = null;
  try {
    const baseUrl = typeof globalThis?.location?.href == "string" ? globalThis.location.href : "https://www.twitch.tv/";
    parsedUrl = new URL(String(rawUrl || ""), baseUrl);
  } catch {
    return null;
  }
  const pathname = parsedUrl.pathname, liveMatch = pathname.match(/\/(?:api\/v2\/)?channel\/hls\/([^/?#]+)\.m3u8$/i);
  if (liveMatch?.[1])
    return _normalizePlaybackContext({
      MediaType: "live",
      ChannelName: liveMatch[1]
    });
  const vodMatch = pathname.match(/\/(?:api\/v2\/vod|vod(?:\/v2)?)\/(\d+)\.m3u8$/i);
  return vodMatch?.[1] ? _normalizePlaybackContext({
    MediaType: "vod",
    VodID: vodMatch[1]
  }) : null;
}
const _EMPTY_HOLD_SEGMENT_URL = "data:video/mp2t;base64,R0ARMAGAAELwJQABwQAA/wH/AAH8gBRIEgEGRkZtcGVnCVNlcnZpY2UwMXd8Q8r///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////9HQAAwAYAAALANAAHBAAAAAfAAKrEEsv///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////0dQADABgAACsBcAAcEAAOEA8AAb4QDwAA/hAfAAL0S5m///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////R0EAMAfQ//+E9H4AAAAB4AMCgIAFIQABAAEAAAABCfAAAAABZ2QAHqyyAUBf8uAiAAADAAgAAAMB9B4sXJAAAAABaOvDyyLAAAABBgX//2zcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIyIGIzNTYwNWEgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRHAQARZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZUcBABI9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0xMSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTAgd2VpZ2h0cD0yIGtleWludD0zMiBrRwEAE2V5aW50X21pbj0zIHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9MzIgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAABZYiEC//+9q78yyt0fpUuHVl7s1Hy6Ely/YgwfWgAAAMAAAMAAAhHAQA0hwD//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////wfqL3rmMS3ykAAABPABHAaIO0K6IuIQI4M8SwhQ6RlAAAADAAADAAADAAADAAAfsUdBADWQAP//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AAAB4AAhgIAFIQABFoEAAAABCfAAAAABQZo7EL/+jLAAAAMAAAb8R0EANowA/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////wAAAeAAJYCABSEAAS0BAAAAAQnwAAAAAUGaTwhkymEL//6MsAAAAwAABv1HQQA3iwD///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AAAHgACaAgAUhAAFDgQAAAAEJ8AAAAAFBmnJ4Q8mUwIX//oywAAADAAAG/EdAABEAALANAAHBAAAAAfAAKrEEsv//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////R1AAEQACsBcAAcEAAOEA8AAb4QDwAA/hAfAAL0S5m/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////9HQQA4iwD///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AAAHgACaAgAUhAAFaAQAAAAEJ8AAAAAFBmpJ4Q8mUwIX//oywAAADAAAG/UdBADmLAP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////wAAAeAAJoCABSEAAXCBAAAAAQnwAAAAAUGasnhDyZTAhf/+jLAAAAMAAAb9R0EAOosA////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AAAB4AAmgIAFIQABhwEAAAABCfAAAAABQZrSeEPJlMCF//6MsAAAAwAABv1HQQA7iwD///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AAAHgACaAgAUhAAGdgQAAAAEJ8AAAAAFBmvJ4Q8mUwIX//oywAAADAAAG/UdAABIAALANAAHBAAAAAfAAKrEEsv//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////R1AAEgACsBcAAcEAAOEA8AAb4QDwAA/hAfAAL0S5m/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////9HQQA8iwD///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AAAHgACaAgAUhAAG0AQAAAAEJ8AAAAAFBmxJ4Q8mUwIX//oywAAADAAAG/EdBAD2LAP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////wAAAeAAJoCABSEAAcqBAAAAAQnwAAAAAUGbMnhDyZTAhf/+jLAAAAMAAAb8R0EAPosA////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AAAB4AAmgIAFIQAB4QEAAAABCfAAAAABQZtSeEPJlMCF//6MsAAAAwAABv1HQQA/iwD///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AAAHgACaAgAUhAAH3gQAAAAEJ8AAAAAFBm3J4Q8mUwIX//oywAAADAAAG/EdBATABwAAAAcAA9ICABSEAAQAB//FMgAOf/NwATGF2YzYzLjEuMTAxAEIgCMEYOP/xTIABv/whEARgjBz/8UyAAb/8IRAEYIwc//FMgAG//CEQBGCMHP/xTIABv/whEARgjBz/8UyAAb/8IRAEYIwc//FMgAG//CEQBGCMHP/xTIABv/whEARgjBz/8UyAAb/8IRAEYIwc//FMgAG//CEQBGCMHP/xTIABv/whEARgjBz/8UyAAb/8IRAERwEBMXMA////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////YIwc//FMgAG//CEQBGCMHP/xTIABv/whEARgjBz/8UyAAb/8IRAEYIwc//FMgAG//CEQBGCMHP/xTIABv/whEARgjBxHQAATAACwDQABwQAAAAHwACqxBLL//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////0dQABMAArAXAAHBAADhAPAAG+EA8AAP4QHwAC9EuZv/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////R0EAMIsA////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AAAB4AAmgIAFIQADDgEAAAABCfAAAAABQZuSeEPJlMCF//6MsAAAAwAABvxHQQAxiwD///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AAAHgACaAgAUhAAMkgQAAAAEJ8AAAAAFBm7J4Q8mUwIX//oywAAADAAAG/UdBADKLAP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////wAAAeAAJoCABSEAAzsBAAAAAQnwAAAAAUGb0nhDyZTAhf/+jLAAAAMAAAb9R0EAM4sA////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AAAB4AAmgIAFIQADUYEAAAABCfAAAAABQZvyeEPJlMCF//6MsAAAAwAABv1HQBERAELwJQABwQAA/wH/AAH8gBRIEgEGRkZtcGVnCVNlcnZpY2UwMXd8Q8r//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////0dAABQAALANAAHBAAAAAfAAKrEEsv//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////R1AAFAACsBcAAcEAAOEA8AAb4QDwAA/hAfAAL0S5m/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////9HQQA0iwD///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AAAHgACaAgAUhAANoAQAAAAEJ8AAAAAFBmhJ4Q8mUwIX//oywAAADAAAG/EdBADWLAP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////wAAAeAAJoCABSEAA36BAAAAAQnwAAAAAUGaMnhDyZTAhf/+jLAAAAMAAAb8R0EANosA////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AAAB4AAmgIAFIQADlQEAAAABCfAAAAABQZpSeEPJlMCF//6MsAAAAwAABv1HQQA3iwD///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AAAHgACaAgAUhAAOrgQAAAAEJ8AAAAAFBmnJ4Q8mUwIX//oywAAADAAAG/EdAABUAALANAAHBAAAAAfAAKrEEsv//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////R1AAFQACsBcAAcEAAOEA8AAb4QDwAA/hAfAAL0S5m/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////9HQQA4iwD///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AAAHgACaAgAUhAAPCAQAAAAEJ8AAAAAFBmpJ4Q8mUwIX//oywAAADAAAG/EdBADmLAP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////wAAAeAAJoCABSEAA9iBAAAAAQnwAAAAAUGasnhDyZTAhf/+jLAAAAMAAAb9R0EAOosQAAAAtH4A////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AAAB4AAmgIAFIQAD7wEAAAABCfAAAAABQZrSeEPJlMCF//6MsAAAAwAABvxHQQEyAUAAAAHAAOWAgAUhAAH/Af/xTIABv/whEARgjBz/8UyAAb/8IRAEYIwc//FMgAG//CEQBGCMHP/xTIABv/whEARgjBz/8UyAAb/8IRAEYIwc//FMgAG//CEQBGCMHP/xTIABv/whEARgjBz/8UyAAb/8IRAEYIwc//FMgAG//CEQBGCMHP/xTIABv/whEARgjBz/8UyAAb/8IRAEYIwc//FMgAG//CEQBGCMHP/xTIABv/whEARgjEcBATOCAP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////xz/8UyAAb/8IRAEYIwc//FMgAG//CEQBGCMHP/xTIABv/whEARgjBz/8UyAAb/8IRAEYIwcR0EAO4sA////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AAAB4AAmgIAFIQAFBYEAAAABCfAAAAABQZryeEPJlMCF//6MsAAAAwAABv1HQAAWAACwDQABwQAAAAHwACqxBLL//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////0dQABYAArAXAAHBAADhAPAAG+EA8AAP4QHwAC9EuZv/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////R0EAPIsA////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AAAB4AAmgIAFIQAFHAEAAAABCfAAAAABQZsSeEPJlMCF//6MsAAAAwAABv1HQQA9ixAAABGUfgD///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AAAHgACaAgAUhAAUygQAAAAEJ8AAAAAFBmzJ4Q8mUwIX//oywAAADAAAG/EdBAD6LAP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////wAAAeAAJoCABSEABUkBAAAAAQnwAAAAAUGbUnhDyZTAhf/+jLAAAAMAAAb9R0EAP4sA////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AAAB4AAmgIAFIQAFX4EAAAABCfAAAAABQZtyeEPJlMCF//6MsAAAAwAABvxHQAAXAACwDQABwQAAAAHwACqxBLL//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////0dQABcAArAXAAHBAADhAPAAG+EA8AAP4QHwAC9EuZv/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////R0EAMIsQAAAidH4A////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AAAB4AAmgIAFIQAFdgEAAAABCfAAAAABQZuSeEPJlMCF//6MsAAAAwAABv1HQQAxiwD///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AAAHgACaAgAUhAAWMgQAAAAEJ8AAAAAFBm7J4Q8mUwIX//oywAAADAAAG/UdBADKLAP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////wAAAeAAJoCABSEABaMBAAAAAQnwAAAAAUGb0nhDyZTAhX/+OEAAAAMAABswR0EAM4oQAAAzVH4A//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AAAHgACeAgAUhAAW5gQAAAAEJ8AAAAAFBm/J4Q8mUwIT//fEAAAMAAAMAQcBHQQE0AUAAAAHAAL6AgAUhAAP+Af/xTIABv/whEARgjBz/8UyAAb/8IRAEYIwc//FMgAG//CEQBGCMHP/xTIABv/whEARgjBz/8UyAAb/8IRAEYIwc//FMgAG//CEQBGCMHP/xTIABv/whEARgjBz/8UyAAb/8IRAEYIwc//FMgAG//CEQBGCMHP/xTIABv/whEARgjBz/8UyAAb/8IRAEYIwc//FMgAG//CEQBGCMHP/xTIABv/whEARgjEcBATWpAP///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////xz/8UyAAb/8IRAEYIwc";
function _parseAttrs(str) {
  const result = /* @__PURE__ */ Object.create(null);
  _ATTR_REGEX.lastIndex = 0;
  let match = _ATTR_REGEX.exec(str);
  for (; match !== null; ) {
    let value = match[2];
    value && value[0] === '"' && value[value.length - 1] === '"' && (value = value.slice(1, -1)), result[match[1].toUpperCase()] = value, match = _ATTR_REGEX.exec(str);
  }
  return result;
}
function _getServerTime(m3u8) {
  return __TTVAB_STATE__.V2API ? m3u8.match(/#EXT-X-SESSION-DATA:DATA-ID="SERVER-TIME",VALUE="([^"]+)"/)?.[1] ?? null : m3u8.match(/SERVER-TIME="([0-9.]+)"/)?.[1] ?? null;
}
function _replaceServerTime(m3u8, time) {
  return time ? __TTVAB_STATE__.V2API ? m3u8.replace(/(#EXT-X-SESSION-DATA:DATA-ID="SERVER-TIME",VALUE=")[^"]+(")/, `$1${time}$2`) : m3u8.replace(/(SERVER-TIME=")[0-9.]+(")/, `$1${time}$2`) : m3u8;
}
function _hasExplicitAdMetadata(text) {
  return typeof text == "string" && _AD_METADATA_RE.test(text);
}
function _isExplicitKnownAdSegmentUrl(segmentUrl) {
  const url = String(segmentUrl || "").trim();
  return !url || /\.m3u8(?:$|\?)/.test(url) ? !1 : __TTVAB_STATE__.AdSignifier && url.includes(__TTVAB_STATE__.AdSignifier) || url.includes("/adsquared/") || url.includes("/_404/");
}
function _isKnownAdSegmentUrl(segmentUrl, options = {}) {
  const url = String(segmentUrl || "").trim();
  return url ? options.includeCached !== !1 && __TTVAB_STATE__.AdSegmentCache.has(url) || _isExplicitKnownAdSegmentUrl(url) : !1;
}
function _getTaggedPlaylistUri(line) {
  return typeof line != "string" || !line.includes('URI="') ? "" : line.match(/URI="([^"]+)"/)?.[1] || "";
}
function _isMediaPartLine(line) {
  return typeof line == "string" && line.startsWith("#EXT-X-PART:");
}
function _isPartPreloadHintLine(line) {
  return typeof line == "string" && line.startsWith("#EXT-X-PRELOAD-HINT:") && (line.includes("TYPE=PART") || line.includes('TYPE="PART"'));
}
function _getMediaSegmentUriIndex(lines, durationIndex) {
  for (let index = durationIndex + 1; index < lines.length; index++) {
    const line = lines[index]?.trim();
    if (line) {
      if (line.startsWith("#EXTINF:") || line.startsWith("#EXT-X-STREAM-INF:") || line === "#EXT-X-ENDLIST")
        return -1;
      if (!line.startsWith("#"))
        return index;
    }
  }
  return -1;
}
function _playlistLinesHaveKnownAdSegments(lines, options = {}) {
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line?.startsWith("#EXTINF") && _isKnownAdSegmentUrl(lines[_getMediaSegmentUriIndex(lines, index)], options) || line?.startsWith("#EXT-X-TWITCH-PREFETCH:") && _isKnownAdSegmentUrl(line.substring(23), options))
      return !0;
    if (_isMediaPartLine(line) || _isPartPreloadHintLine(line)) {
      const taggedUri = _getTaggedPlaylistUri(line);
      if (_isKnownAdSegmentUrl(taggedUri, options))
        return !0;
    }
  }
  return !1;
}
function _playlistHasKnownAdSegments(text, options = {}) {
  return typeof text != "string" || !text || options.includeCached === !1 && (!__TTVAB_STATE__.AdSignifier || !text.includes(__TTVAB_STATE__.AdSignifier)) && !text.includes("/adsquared/") && !text.includes("/_404/") ? !1 : _playlistLinesHaveKnownAdSegments(text.split(`
`), options);
}
function _absolutizePlaylistUrl(rawUrl, baseUrl = null, segmentUrlCollection = null) {
  const candidate = typeof rawUrl == "string" ? rawUrl.trim() : "";
  if (!candidate || !baseUrl || candidate.startsWith("#"))
    return segmentUrlCollection && (segmentUrlCollection.isComplete = !1), candidate || rawUrl;
  try {
    const parsedUrl = new URL(candidate, baseUrl), normalizedUrl = parsedUrl.href;
    return segmentUrlCollection && (parsedUrl.hash = "", segmentUrlCollection.urls.push(parsedUrl.href)), normalizedUrl;
  } catch {
    return segmentUrlCollection && (segmentUrlCollection.isComplete = !1), rawUrl;
  }
}
function _absolutizeMediaPlaylistUrls(text, baseUrl = null, segmentUrlCollection = null) {
  if (typeof text != "string" || !text || !baseUrl || !text.includes("#EXTINF") && !text.includes("#EXT-X-TWITCH-PREFETCH:") && !text.includes("#EXT-X-MAP:") && !text.includes("#EXT-X-KEY:") && !text.includes('URI="'))
    return text;
  const lines = text.split(`
`);
  let pendingMediaUriIndex = -1;
  return lines.map((line, index) => {
    if (line?.startsWith("#EXTINF:") && (pendingMediaUriIndex = _getMediaSegmentUriIndex(lines, index), segmentUrlCollection && pendingMediaUriIndex < 0 && (segmentUrlCollection.isComplete = !1)), typeof line != "string" || !line)
      return line;
    if (!line.startsWith("#"))
      return _absolutizePlaylistUrl(line, baseUrl, index === pendingMediaUriIndex ? segmentUrlCollection : null);
    if (line.startsWith("#EXT-X-TWITCH-PREFETCH:")) {
      const prefetchUrl = line.substring(23).trim();
      return `#EXT-X-TWITCH-PREFETCH:${_absolutizePlaylistUrl(prefetchUrl, baseUrl, segmentUrlCollection)}`;
    }
    if (!line.includes('URI="'))
      return line;
    const shouldCollectTaggedUrl = _isMediaPartLine(line) || _isPartPreloadHintLine(line);
    let collectedTaggedUrl = !1;
    return line.replace(/URI="([^"]+)"/g, (_match, value) => {
      const normalizedValue = _absolutizePlaylistUrl(value, baseUrl, shouldCollectTaggedUrl && !collectedTaggedUrl ? segmentUrlCollection : null);
      return shouldCollectTaggedUrl && (collectedTaggedUrl = !0), `URI="${normalizedValue}"`;
    });
  }).join(`
`);
}
function _createEmptyAdHoldPlaylist(text, info) {
  if (/(?:^|\n)\s*#EXT-X-MAP:/.test(text))
    throw new DOMException("Transport hold cannot replace media with an initialization map", "AbortError");
  const headerLines = (_extractPlaylistHeaders(text) || "#EXTM3U").split(`
`).map((line) => line.trim()).filter((line) => /^#EXTM3U$|^#EXT-X-(?:VERSION|TARGETDURATION|MEDIA-SEQUENCE):/.test(line)), versionIndex = headerLines.findIndex((line) => line.startsWith("#EXT-X-VERSION:"));
  versionIndex >= 0 && (headerLines[versionIndex] = `#EXT-X-VERSION:${Math.max(3, Number(headerLines[versionIndex].split(":")[1]) || 0)}`), headerLines.includes("#EXTM3U") || headerLines.unshift("#EXTM3U"), headerLines.some((line) => line.startsWith("#EXT-X-VERSION:")) || headerLines.splice(1, 0, "#EXT-X-VERSION:3"), headerLines.some((line) => line.startsWith("#EXT-X-TARGETDURATION:")) || headerLines.push("#EXT-X-TARGETDURATION:1");
  let mediaSequenceIndex = -1, sourceMediaSequence = 0;
  for (let i = 0; i < headerLines.length; i++) {
    const match = headerLines[i]?.match(/^#EXT-X-MEDIA-SEQUENCE:(\d+)/);
    if (match) {
      mediaSequenceIndex = i, sourceMediaSequence = Number(match[1]) || 0;
      break;
    }
  }
  const previousHoldSequence = Math.max(0, Number(info?._EmptyAdHoldMediaSequence) || 0);
  let sourceNextMediaSequence = sourceMediaSequence, hasPendingPart = !1, sourceDiscontinuitySequence = Number(text?.match(/#EXT-X-DISCONTINUITY-SEQUENCE:(\d+)/)?.[1]) || 0;
  for (const line of text.split(/\r?\n/))
    line.startsWith("#EXTINF:") || line.startsWith("#EXT-X-TWITCH-PREFETCH:") ? (sourceNextMediaSequence++, hasPendingPart = !1) : line.startsWith("#EXT-X-PART:") || _isPartPreloadHintLine(line) ? hasPendingPart = !0 : line.startsWith("#EXT-X-SKIP:") ? sourceNextMediaSequence += Number(line.match(/\bSKIPPED-SEGMENTS=(\d+)/)?.[1]) || 0 : line === "#EXT-X-DISCONTINUITY" && sourceDiscontinuitySequence++;
  const now = Date.now(), cycleStartedAt = info?.VisibleAdStartedAt || info?._PageFallbackCycleStartedAt || 0;
  let holdWindow = info?._EmptyAdHoldWindow;
  if (!holdWindow || holdWindow.cycleStartedAt !== cycleStartedAt || now < holdWindow.startedAt) {
    const servedEndTime = Number(info?._LivePlaylistTimeline?.lastEndTime) || 0, previousHoldTime = Number(info?._EmptyAdHoldProgramDateTime) || 0;
    holdWindow = {
      cycleStartedAt,
      startedAt: now,
      firstSequence: Math.max(previousHoldSequence + 1, sourceMediaSequence + 1, sourceNextMediaSequence + Number(hasPendingPart)),
      discontinuity: Math.max(sourceDiscontinuitySequence, Number(info?._EmptyAdHoldDiscontinuitySequence) || 0, Number(info?._SpliceLastDiscontinuitySequence) || 0),
      programDateTime: info?.MediaType === "live" && Number.isFinite(servedEndTime) && servedEndTime > 0 ? Math.max(servedEndTime, previousHoldTime > 0 ? previousHoldTime + 1024 : 0) : 0
    }, info && (info._EmptyAdHoldWindow = holdWindow);
  }
  const firstSlot = Math.floor((now - holdWindow.startedAt) / 1024), lastSlot = firstSlot + 2, firstSequence = holdWindow.firstSequence + firstSlot, nextHoldSequence = holdWindow.firstSequence + lastSlot;
  info && (info._EmptyAdHoldMediaSequence = nextHoldSequence, info._EmptyAdHoldDiscontinuitySequence = holdWindow.discontinuity + 1, info._EmptyAdHoldProgramDateTime = holdWindow.programDateTime ? holdWindow.programDateTime + lastSlot * 1024 : 0);
  const mediaSequenceLine = `#EXT-X-MEDIA-SEQUENCE:${firstSequence}`;
  mediaSequenceIndex >= 0 ? headerLines[mediaSequenceIndex] = mediaSequenceLine : headerLines.push(mediaSequenceLine), headerLines.push(`#EXT-X-DISCONTINUITY-SEQUENCE:${holdWindow.discontinuity + +(firstSlot > 0)}`);
  const mediaKey = typeof info?.MediaKey == "string" && info.MediaKey ? info.MediaKey : "unknown", output = [
    ...headerLines,
    ...firstSlot === 0 ? ["#EXT-X-DISCONTINUITY"] : [],
    "#EXT-X-KEY:METHOD=NONE"
  ];
  for (let slot = firstSlot; slot <= lastSlot; slot++) {
    const emptySegmentUrl = new URL("/__ttvab_empty_hold_segment.ts", "https://www.twitch.tv");
    emptySegmentUrl.searchParams.set("seq", String(holdWindow.firstSequence + slot)), emptySegmentUrl.searchParams.set("media", mediaKey), holdWindow.programDateTime > 0 && output.push(`#EXT-X-PROGRAM-DATE-TIME:${new Date(holdWindow.programDateTime + slot * 1024).toISOString()}`), output.push("#EXTINF:1.024,live", emptySegmentUrl.href);
  }
  return output.join(`
`);
}
async function _getEmptyAdHoldResponse(url, realFetch, signal = null) {
  const sequence = Number(new URL(url).searchParams.get("seq"));
  if (!Number.isSafeInteger(sequence) || sequence < 1)
    throw new Error("Invalid empty hold media sequence");
  const response = await realFetch(_EMPTY_HOLD_SEGMENT_URL, { signal }), bytes = new Uint8Array(await response.arrayBuffer());
  if (signal?.aborted)
    throw new DOMException("Empty hold request aborted", "AbortError");
  if (!bytes.length || bytes.length % 188 !== 0)
    throw new Error("Invalid empty hold transport stream");
  const timestampOffset = BigInt(sequence) * 92160n, timestampMask = 0x1ffffffffn, advanceTimestamp = (offset) => {
    const advanced = (BigInt(bytes[offset] & 14) << 29n | BigInt(bytes[offset + 1]) << 22n | BigInt(bytes[offset + 2] & 254) << 14n | BigInt(bytes[offset + 3]) << 7n | BigInt(bytes[offset + 4]) >> 1n) + timestampOffset & timestampMask;
    bytes[offset] = bytes[offset] & 241 | Number(advanced >> 29n & 14n), bytes[offset + 1] = Number(advanced >> 22n & 255n), bytes[offset + 2] = Number(advanced >> 14n & 254n) | 1, bytes[offset + 3] = Number(advanced >> 7n & 255n), bytes[offset + 4] = Number(advanced << 1n & 254n) | 1;
  };
  let hasVideoTimestamp = !1, hasAudioTimestamp = !1;
  for (let offset = 0; offset < bytes.length; offset += 188) {
    if (bytes[offset] !== 71)
      throw new Error("Invalid empty hold transport packet");
    let payload = offset + 4;
    if (bytes[offset + 3] & 32) {
      const adaptationLength = bytes[payload];
      if (adaptationLength > 183)
        throw new Error("Invalid empty hold transport timing");
      if (adaptationLength >= 7 && bytes[payload + 1] & 16) {
        const pcr = payload + 2, advanced = (BigInt(bytes[pcr]) << 25n | BigInt(bytes[pcr + 1]) << 17n | BigInt(bytes[pcr + 2]) << 9n | BigInt(bytes[pcr + 3]) << 1n | BigInt(bytes[pcr + 4]) >> 7n) + timestampOffset & timestampMask;
        bytes[pcr] = Number(advanced >> 25n & 255n), bytes[pcr + 1] = Number(advanced >> 17n & 255n), bytes[pcr + 2] = Number(advanced >> 9n & 255n), bytes[pcr + 3] = Number(advanced >> 1n & 255n), bytes[pcr + 4] = bytes[pcr + 4] & 127 | Number((advanced & 1n) << 7n);
      }
      payload += 1 + adaptationLength;
    }
    if (!(bytes[offset + 3] & 16) || !(bytes[offset + 1] & 64) || payload + 14 > offset + 188 || bytes[payload] !== 0 || bytes[payload + 1] !== 0 || bytes[payload + 2] !== 1)
      continue;
    const streamId = bytes[payload + 3], timestampFlags = bytes[payload + 7] >> 6;
    if (!(timestampFlags !== 2 && timestampFlags !== 3)) {
      if (advanceTimestamp(payload + 9), timestampFlags === 3) {
        if (payload + 19 > offset + 188)
          throw new Error("Invalid empty hold decode timestamp");
        advanceTimestamp(payload + 14);
      }
      hasVideoTimestamp ||= streamId >= 224 && streamId <= 239, hasAudioTimestamp ||= streamId >= 192 && streamId <= 223;
    }
  }
  if (!hasVideoTimestamp || !hasAudioTimestamp)
    throw new Error("Missing empty hold audio or video timing");
  return new Response(bytes, {
    status: 200,
    headers: { "Content-Type": "video/mp2t", "Cache-Control": "no-store" }
  });
}
function _isEmptyAdHoldSegmentUrl(url) {
  if (typeof url != "string" || !url)
    return !1;
  try {
    const parsed = new URL(url, "https://www.twitch.tv");
    return parsed.hostname === "www.twitch.tv" && parsed.pathname === "/__ttvab_empty_hold_segment.ts";
  } catch {
    return !1;
  }
}
function _stripAds(text, stripAll, info, _skipAutoForceStrip = !1, preserveLiveSegments = !1) {
  const lines = text.split(`
`), len = lines.length;
  let stripped = !1, i = 0, strippedMediaEntryCount = 0;
  const hasExplicitAdMetadata = _hasExplicitAdMetadata(text), hasKnownAdSegments = _playlistLinesHaveKnownAdSegments(lines), forceStripAllSegments = stripAll || __TTVAB_STATE__.AllSegmentsAreAdSegments || hasExplicitAdMetadata && !hasKnownAdSegments, canPreserveLiveSegments = preserveLiveSegments && !(hasExplicitAdMetadata && !hasKnownAdSegments);
  let adSegmentCount = 0, _liveSegmentCount = 0, mediaSequence = BigInt(text.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/)?.[1] || "0"), implicitKey = null, pendingMediaUriIndex = -1;
  const originalEncryptionKeys = /* @__PURE__ */ new Map();
  for (i = 0; i < len; i++) {
    const line = lines[i];
    if (line?.startsWith("#EXT-X-KEY:")) {
      const attributes = _parseAttrs(line);
      (!attributes.KEYFORMAT || attributes.KEYFORMAT === "identity" || attributes.METHOD === "NONE") && (implicitKey = attributes.METHOD !== "NONE" && !attributes.IV ? line.trimEnd() : null);
    }
    if (line?.startsWith("#EXT-X-SKIP:")) {
      const skipped = _parseAttrs(line)["SKIPPED-SEGMENTS"];
      /^\d+$/.test(skipped || "") && (mediaSequence += BigInt(skipped));
    }
    line?.startsWith("#EXTINF:") && (pendingMediaUriIndex = _getMediaSegmentUriIndex(lines, i));
    const completeSegment = i === pendingMediaUriIndex || line?.startsWith("#EXT-X-TWITCH-PREFETCH:");
    if (implicitKey && (completeSegment || _isMediaPartLine(line) || _isPartPreloadHintLine(line)) && originalEncryptionKeys.set(i, `${implicitKey},IV=0x${mediaSequence.toString(16).padStart(32, "0")}`), completeSegment && mediaSequence++, line?.startsWith("#EXTINF")) {
      const segmentUrl = lines[_getMediaSegmentUriIndex(lines, i)]?.trim();
      _isKnownAdSegmentUrl(segmentUrl) || forceStripAllSegments && (!canPreserveLiveSegments || !line.includes(",live")) ? adSegmentCount++ : _liveSegmentCount++;
    }
    if (_isMediaPartLine(line) || _isPartPreloadHintLine(line) || line?.startsWith("#EXT-X-TWITCH-PREFETCH:")) {
      const partUrl = line.startsWith("#EXT-X-TWITCH-PREFETCH:") ? line.substring(23).trim() : _getTaggedPlaylistUri(line);
      forceStripAllSegments || _isKnownAdSegmentUrl(partUrl) ? adSegmentCount++ : _liveSegmentCount++;
    }
  }
  const shouldStrip = (hasExplicitAdMetadata || hasKnownAdSegments || stripAll || __TTVAB_STATE__.AllSegmentsAreAdSegments) && (adSegmentCount > 0 || forceStripAllSegments);
  let previousSegmentEndIndex = -1;
  for (i = 0; i < len; i++) {
    const line = lines[i];
    if (shouldStrip && line?.startsWith("#EXT-X-TWITCH-PREFETCH:")) {
      const prefetchUrl = line.substring(23).trim();
      (forceStripAllSegments || _isKnownAdSegmentUrl(prefetchUrl)) && (stripped = !0, strippedMediaEntryCount++, lines[i] = "");
      continue;
    }
    if (shouldStrip && line?.startsWith("#EXTINF")) {
      const uriIndex = _getMediaSegmentUriIndex(lines, i), segmentTagStartIndex = previousSegmentEndIndex + 1;
      previousSegmentEndIndex = uriIndex >= 0 ? uriIndex : i;
      const segmentUrl = lines[uriIndex]?.trim();
      if ((_isKnownAdSegmentUrl(segmentUrl) || forceStripAllSegments && (!canPreserveLiveSegments || !line.includes(",live"))) && (__TTVAB_STATE__.AdSegmentCache.has(segmentUrl) || info.NumStrippedAdSegments++, strippedMediaEntryCount++, segmentUrl && (!forceStripAllSegments || _isExplicitKnownAdSegmentUrl(segmentUrl)) && __TTVAB_STATE__.AdSegmentCache.set(segmentUrl, Date.now()), stripped = !0, lines[i] = "", uriIndex >= 0)) {
        lines[uriIndex] = "";
        for (let tagIndex = segmentTagStartIndex; tagIndex < uriIndex; tagIndex++)
          /^#EXT-X-(?:BYTERANGE:|GAP\b|PROGRAM-DATE-TIME:)/.test(lines[tagIndex]) && (lines[tagIndex] = "");
      }
    }
    if (shouldStrip && (_isMediaPartLine(line) || _isPartPreloadHintLine(line))) {
      const taggedUri = _getTaggedPlaylistUri(line);
      if (forceStripAllSegments || _isKnownAdSegmentUrl(taggedUri)) {
        _isMediaPartLine(line) && taggedUri && !__TTVAB_STATE__.AdSegmentCache.has(taggedUri) && info.NumStrippedAdSegments++, strippedMediaEntryCount++, taggedUri && (!forceStripAllSegments || _isExplicitKnownAdSegmentUrl(taggedUri)) && __TTVAB_STATE__.AdSegmentCache.set(taggedUri, Date.now()), stripped = !0, lines[i] = "";
        continue;
      }
    }
    hasExplicitAdMetadata && line?.charCodeAt(0) === 35 && _AD_METADATA_RE.test(line) && (stripped = !0, lines[i] = "");
  }
  if (stripped || (info.NumStrippedAdSegments = 0), hasExplicitAdMetadata)
    for (i = 0; i < len; i++) {
      const line = lines[i];
      (line?.startsWith("#EXT-X-TWITCH-PREFETCH:") || line?.startsWith("#EXT-X-PRELOAD-HINT:")) && (lines[i] = "");
    }
  info.IsStrippingAdSegments = stripped;
  const now = Date.now();
  if (!globalThis._lastAdCachePrune || now - globalThis._lastAdCachePrune > 6e4) {
    globalThis._lastAdCachePrune = now;
    const cutoff = now - 12e4, staleKeys = [];
    __TTVAB_STATE__.AdSegmentCache.forEach((v, k) => {
      v < cutoff && staleKeys.push(k);
    });
    for (const k of staleKeys)
      __TTVAB_STATE__.AdSegmentCache.delete(k);
    if (__TTVAB_STATE__.AdSegmentCache.size > 1e3) {
      let evicted = 0;
      for (const url of __TTVAB_STATE__.AdSegmentCache.keys()) {
        if (++evicted > 200)
          break;
        __TTVAB_STATE__.AdSegmentCache.delete(url);
      }
    }
  }
  const result = [];
  let hasRemainingSegments = !1, addedIv = !1;
  for (let ri = 0; ri < len; ri++) {
    const l = lines[ri];
    if (l === "")
      continue;
    const originalKey = originalEncryptionKeys.get(ri);
    strippedMediaEntryCount > 0 && originalKey && (result.push(`${originalKey}${l.endsWith("\r") ? "\r" : ""}`), addedIv = !0), result.push(l), !hasRemainingSegments && (l?.startsWith("#EXTINF") || l?.startsWith("#EXT-X-PART:")) && (hasRemainingSegments = !0);
  }
  if (!hasRemainingSegments && strippedMediaEntryCount > 0)
    return _createEmptyAdHoldPlaylist(text, info);
  if (addedIv) {
    const versionIndex = result.findIndex((line) => line.startsWith("#EXT-X-VERSION:"));
    versionIndex < 0 ? result.splice(1, 0, "#EXT-X-VERSION:2") : Number(result[versionIndex].split(":")[1]) < 2 && (result[versionIndex] = "#EXT-X-VERSION:2");
  }
  return result.join(`
`);
}
function _extractPlaylistHeaders(text) {
  if (typeof text != "string" || !text)
    return null;
  const lines = text.split(`
`), headers = [];
  for (const line of lines) {
    if (line?.startsWith("#EXTINF") || line?.startsWith("#EXT-X-PART:") || line?.startsWith("#EXT-X-PRELOAD-HINT:") || line?.startsWith("#EXT-X-TWITCH-PREFETCH:"))
      break;
    _hasExplicitAdMetadata(line) || line?.includes("X-TV-TWITCH-AD") || line?.includes("EXT-X-CUE-OUT") || line?.includes("SCTE35-OUT") || headers.push(line);
  }
  return headers.length > 0 ? headers.join(`
`) : `#EXTM3U
`;
}
function _getStreamVariantInfo(attrs, rawUrl, variantUrl) {
  const frameRate = Number.parseFloat(attrs?.["FRAME-RATE"]), bandwidth = Number.parseInt(attrs?.BANDWIDTH, 10);
  return {
    Resolution: String(attrs.RESOLUTION || "0x0"),
    FrameRate: Number.isFinite(frameRate) ? frameRate : 0,
    Bandwidth: Number.isFinite(bandwidth) ? Math.max(0, bandwidth) : 0,
    Codecs: String(attrs.CODECS || ""),
    Audio: String(attrs.AUDIO || ""),
    Name: String(attrs.VIDEO || ""),
    Subtitles: String(attrs.SUBTITLES || ""),
    Video: String(attrs.VIDEO || ""),
    RawUrl: rawUrl,
    Url: variantUrl
  };
}
function _getStreamUrl(m3u8, res, baseUrl = null) {
  const lines = m3u8.split(`
`), len = lines.length, targetName = typeof res?.Name == "string" && res.Name.trim() ? res.Name.trim().toLowerCase() : null, [tw, th] = String(res?.Resolution || "0x0").split("x").map(Number), targetPixels = (Number.isFinite(tw) ? tw : 0) * (Number.isFinite(th) ? th : 0), targetFrameRate = Number.parseFloat(String(res?.FrameRate ?? "")), hasValidTargetPixels = Number.isFinite(targetPixels) && targetPixels > 0;
  let matchUrl = null, matchFps = !1, closeUrl = null, closeDiff = 1 / 0, highestUrl = null, highestArea = -1, firstUrl = null;
  const resolveUrl = (candidate) => {
    if (!baseUrl)
      return candidate;
    try {
      return new URL(candidate, baseUrl).href;
    } catch {
      return candidate;
    }
  };
  for (let i = 0; i < len - 1; i++) {
    const line = lines[i], nextLine = lines[i + 1]?.trim();
    if (!line?.startsWith("#EXT-X-STREAM-INF") || !nextLine || nextLine.startsWith("#"))
      continue;
    firstUrl || (firstUrl = resolveUrl(lines[i + 1]));
    const attrs = _parseAttrs(line), resolution = attrs.RESOLUTION, frameRate = attrs["FRAME-RATE"], variantName = String(attrs.VIDEO || "").trim().toLowerCase(), parsedFrameRate = Number.parseFloat(String(frameRate ?? "")), matchesFrameRate = Number.isFinite(targetFrameRate) && Number.isFinite(parsedFrameRate) ? Math.abs(parsedFrameRate - targetFrameRate) < 0.01 : String(frameRate || "") === String(res?.FrameRate || "");
    if (targetName && variantName === targetName)
      return resolveUrl(lines[i + 1]);
    if (!resolution)
      continue;
    if (resolution === res?.Resolution && (!matchUrl || !matchFps && matchesFrameRate) && (matchUrl = resolveUrl(lines[i + 1]), matchFps = matchesFrameRate, matchFps))
      return matchUrl;
    const [w, h] = String(resolution || "0x0").split("x").map(Number), area = (Number.isFinite(w) ? w : 0) * (Number.isFinite(h) ? h : 0);
    if (area > highestArea && (highestArea = area, highestUrl = resolveUrl(lines[i + 1])), hasValidTargetPixels) {
      const diff = Math.abs(area - targetPixels);
      diff < closeDiff && (closeUrl = resolveUrl(lines[i + 1]), closeDiff = diff);
    }
  }
  return matchUrl || closeUrl || highestUrl || firstUrl;
}
function _getSortedResolutionList(resolutionList) {
  return [...resolutionList].sort((a, b) => {
    const [aw, ah] = String(a?.Resolution || "0x0").split("x").map(Number), [bw, bh] = String(b?.Resolution || "0x0").split("x").map(Number), aArea = (Number.isFinite(aw) ? aw : 0) * (Number.isFinite(ah) ? ah : 0), bArea = (Number.isFinite(bw) ? bw : 0) * (Number.isFinite(bh) ? bh : 0), aFps = Number.parseFloat(String(a?.FrameRate ?? "")) || 0, bFps = Number.parseFloat(String(b?.FrameRate ?? "")) || 0, aBandwidth = Number.parseInt(String(a?.Bandwidth ?? ""), 10) || 0, bBandwidth = Number.parseInt(String(b?.Bandwidth ?? ""), 10) || 0;
    return bArea - aArea || bFps - aFps || bBandwidth - aBandwidth;
  });
}
function _getResolutionByQualityGroup(resolutionList, qualityGroup) {
  const normalizedQualityGroup = typeof qualityGroup == "string" ? qualityGroup.trim().toLowerCase() : "";
  if (!normalizedQualityGroup || normalizedQualityGroup === "auto")
    return null;
  const exactName = resolutionList.find((entry) => typeof entry?.Name == "string" && entry.Name.trim().toLowerCase() === normalizedQualityGroup);
  if (exactName)
    return exactName;
  const sorted = _getSortedResolutionList(resolutionList);
  if (normalizedQualityGroup === "chunked")
    return sorted[0] || null;
  if (normalizedQualityGroup === "audio_only")
    return sorted[sorted.length - 1] || null;
  const match = normalizedQualityGroup.match(/(\d{3,4})p(?:(\d{2,3}))?/);
  if (!match)
    return null;
  const targetHeight = Number.parseInt(match[1], 10), targetFps = match[2] ? Number.parseInt(match[2], 10) : null;
  return [...resolutionList].sort((a, b) => {
    const [, ahRaw] = String(a?.Resolution || "0x0").split("x").map(Number), [, bhRaw] = String(b?.Resolution || "0x0").split("x").map(Number), aHeight = Number.isFinite(ahRaw) ? ahRaw : 0, bHeight = Number.isFinite(bhRaw) ? bhRaw : 0, aFps = Number.parseFloat(String(a?.FrameRate ?? "")) || 0, bFps = Number.parseFloat(String(b?.FrameRate ?? "")) || 0, aScore = Math.abs(aHeight - targetHeight) * 1e3 + (targetFps !== null ? Math.abs(aFps - targetFps) * 10 : 0), bScore = Math.abs(bHeight - targetHeight) * 1e3 + (targetFps !== null ? Math.abs(bFps - targetFps) * 10 : 0);
    return aScore - bScore;
  })[0] || null;
}
function _degradeToDecodableResolution(info, entry, resolutionList) {
  if (!entry || !info?.IsUsingModifiedM3U8 || !_isEnhancedCodecString(entry?.Codecs))
    return entry;
  const heightOf = (candidate) => {
    const [, h] = String(candidate?.Resolution || "0x0").split("x").map(Number);
    return Number.isFinite(h) ? h : 0;
  }, ceiling = heightOf(entry), list = Array.isArray(resolutionList) ? resolutionList.filter(Boolean) : [];
  let best = null, bestHeight = 0;
  for (const candidate of list) {
    if (_isEnhancedCodecString(candidate?.Codecs))
      continue;
    const height = heightOf(candidate);
    height <= 0 || ceiling > 0 && height > ceiling || height > bestHeight && (best = candidate, bestHeight = height);
  }
  return best || entry;
}
function _getFallbackResolution(info, url) {
  const resolutionList = Array.isArray(info?.ResolutionList) ? info.ResolutionList.filter(Boolean) : [];
  if (resolutionList.length === 0)
    return null;
  if (url) {
    const direct = resolutionList.find((entry) => entry.Url === url || entry.RawUrl === url);
    if (direct)
      return direct;
  }
  if (info?.ActiveBackupPlayerType && typeof info?.ActiveBackupResolution == "string") {
    const active = resolutionList.find((entry) => entry.Resolution === info.ActiveBackupResolution);
    if (active)
      return active;
  }
  const preferredQualityGroup = typeof __TTVAB_STATE__ < "u" ? __TTVAB_STATE__?.PreferredQualityGroup : null, preferredResolution = _degradeToDecodableResolution(info, _getResolutionByQualityGroup(resolutionList, preferredQualityGroup), resolutionList);
  if (preferredResolution)
    return preferredResolution;
  const sorted = _getSortedResolutionList(resolutionList), isDecodable = (entry) => !info?.IsUsingModifiedM3U8 || !_isEnhancedCodecString(entry?.Codecs), heightOf = (entry) => {
    const [, h] = String(entry?.Resolution || "0x0").split("x").map(Number);
    return Number.isFinite(h) ? h : 0;
  };
  let fallback = null;
  for (const entry of sorted)
    !isDecodable(entry) || heightOf(entry) <= 0 || (!fallback || heightOf(entry) >= 360) && (fallback = entry);
  return fallback || sorted[0];
}
function _applyBackupResolutionFloor(res, resolutionList, floorHeight = 360) {
  const heightOf = (entry) => {
    const [, h] = String(entry?.Resolution || "0x0").split("x").map(Number);
    return Number.isFinite(h) ? h : 0;
  }, targetHeight = heightOf(res);
  if (targetHeight <= 0 || targetHeight >= floorHeight)
    return res;
  const list = Array.isArray(resolutionList) ? resolutionList.filter(Boolean) : [];
  let floored = null, flooredHeight = Number.POSITIVE_INFINITY;
  for (const entry of list) {
    const h = heightOf(entry);
    h >= floorHeight && h < flooredHeight && (floored = entry, flooredHeight = h);
  }
  return floored || res;
}
function _isHevcCodecString(codecs) {
  const c = _getVideoCodecIdentity(codecs) || "";
  return c.startsWith("hev") || c.startsWith("hvc");
}
function _isEnhancedCodecString(codecs) {
  const c = _getVideoCodecIdentity(codecs) || "";
  return _isHevcCodecString(c) || c.startsWith("av0");
}
function _shouldAvoidHevcBackupVariants(info) {
  if (info?.IsUsingModifiedM3U8)
    return !0;
  const enhancedDecoderCodecFamily = _getVideoCodecFamily(info?.EnhancedDecoderCodecFamily);
  if (enhancedDecoderCodecFamily === "hevc" || enhancedDecoderCodecFamily === "av1" || _isEnhancedCodecString(info?.SustainedNativeResolution?.Codecs))
    return !1;
  const list = Array.isArray(info?.ResolutionList) ? info.ResolutionList.filter(Boolean) : [];
  return !(list.length > 0 && list.every((r) => _isEnhancedCodecString(r?.Codecs)));
}
function _dropEnhancedVariantLines(lines) {
  const kept = [];
  let removed = 0, remaining = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line?.startsWith("#EXT-X-STREAM-INF")) {
      const uri = i + 1 < lines.length ? String(lines[i + 1] || "") : "", hasUri = uri.trim() && !uri.trim().startsWith("#");
      if (hasUri && _isEnhancedCodecString(String(_parseAttrs(line).CODECS || ""))) {
        removed++, i++;
        continue;
      }
      hasUri && remaining++;
    }
    kept.push(line);
  }
  return { kept, removed, remaining };
}
function _getBackupPlaybackCodec(info, targetResolution = null, codecOverride = null) {
  if (info?.IsUsingModifiedM3U8)
    return "avc";
  const explicitCodec = _getVideoCodecIdentity(codecOverride);
  if (explicitCodec)
    return explicitCodec;
  const explicitFamily = _getVideoCodecFamily(codecOverride);
  if (explicitFamily === "avc")
    return explicitFamily;
  const enhancedFamily = explicitFamily || _getVideoCodecFamily(info?.EnhancedDecoderCodec) || _getVideoCodecFamily(info?.EnhancedDecoderCodecFamily);
  for (const codec of [
    info?.EnhancedDecoderCodec,
    info?.SustainedNativeResolution?.Codecs,
    targetResolution?.Codecs
  ]) {
    const identity = _getVideoCodecIdentity(codec);
    if (identity && (!enhancedFamily || _getVideoCodecFamily(identity) === enhancedFamily))
      return identity;
  }
  return enhancedFamily || null;
}
function _stripHevcBackupVariants(info, m3u8, targetResolution = null, codecFamilyOverride = null) {
  if (typeof m3u8 != "string" || !m3u8.includes("#EXT-X-STREAM-INF"))
    return m3u8;
  const explicitCodecFamily = _getVideoCodecFamily(codecFamilyOverride), playbackCodec = _getBackupPlaybackCodec(info, targetResolution, codecFamilyOverride);
  let requestedCodecFamily = _getVideoCodecFamily(playbackCodec);
  if (!requestedCodecFamily) {
    if (!_shouldAvoidHevcBackupVariants(info))
      return m3u8;
    requestedCodecFamily = "avc";
  }
  const requiresExactCodecIdentity = requestedCodecFamily === "hevc" || requestedCodecFamily === "av1", requestedCodecIdentity = requiresExactCodecIdentity ? _getVideoCodecIdentity(playbackCodec) : null, requireExplicitCodecFamily = !!(explicitCodecFamily || info?.IsUsingModifiedM3U8 || requiresExactCodecIdentity), lines = m3u8.split(`
`);
  let matchingVariants = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i], uri = lines[i + 1]?.trim();
    if (!line?.startsWith("#EXT-X-STREAM-INF") || !uri || uri.startsWith("#"))
      continue;
    const variantCodecs = _parseAttrs(line).CODECS, variantCodecFamily = _getVideoCodecFamily(variantCodecs), variantCodecIdentity = _getVideoCodecIdentity(variantCodecs);
    variantCodecFamily === requestedCodecFamily && (!requiresExactCodecIdentity || requestedCodecIdentity && variantCodecIdentity === requestedCodecIdentity) && matchingVariants++;
  }
  const kept = [];
  let removed = 0, remaining = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line?.startsWith("#EXT-X-STREAM-INF")) {
      const uri = i + 1 < lines.length ? String(lines[i + 1] || "") : "", hasUri = uri.trim() && !uri.trim().startsWith("#"), variantCodecs = _parseAttrs(line).CODECS, variantCodecFamily = _getVideoCodecFamily(variantCodecs), variantCodecIdentity = _getVideoCodecIdentity(variantCodecs);
      if (hasUri && (variantCodecFamily ? !(variantCodecFamily === requestedCodecFamily && (!requiresExactCodecIdentity || requestedCodecIdentity && variantCodecIdentity === requestedCodecIdentity)) : requireExplicitCodecFamily)) {
        removed++, i++;
        continue;
      }
      hasUri && remaining++;
    }
    kept.push(line);
  }
  if (removed === 0)
    return m3u8;
  if (info) {
    info._LoggedWhitelistByType || (info._LoggedWhitelistByType = /* @__PURE__ */ new Set());
    const logKey = `codec-filter:${requestedCodecIdentity || requestedCodecFamily}:${remaining > 0 ? "ready" : "empty"}`;
    if (!info._LoggedWhitelistByType.has(logKey)) {
      info._LoggedWhitelistByType.add(logKey);
      const requestedLabel = (requestedCodecIdentity || requestedCodecFamily).toUpperCase();
    }
  }
  return requireExplicitCodecFamily && matchingVariants === 0 || remaining === 0 ? null : kept.join(`
`);
}
function _resolvePreferredBackupResolution(info, floorHeight = 360) {
  const resolutionList = Array.isArray(info?.ResolutionList) ? info.ResolutionList.filter(Boolean) : [];
  if (resolutionList.length === 0)
    return null;
  const preferredQualityGroup = typeof __TTVAB_STATE__ < "u" ? __TTVAB_STATE__?.PreferredQualityGroup : null;
  let target = _degradeToDecodableResolution(info, _getResolutionByQualityGroup(resolutionList, preferredQualityGroup), resolutionList);
  if (!target) {
    const sustained = _degradeToDecodableResolution(info, info?.SustainedNativeResolution, resolutionList), [, sh] = String(sustained?.Resolution || "0x0").split("x").map(Number);
    Number.isFinite(sh) && sh > 0 && (target = sustained);
  }
  return target ? _applyBackupResolutionFloor(target, resolutionList, floorHeight) : null;
}
const _GQL_URL = "https://gql.twitch.tv/gql";
function _collectPlaybackAccessTokenSources(payload) {
  const queue = Array.isArray(payload) ? [...payload] : [payload], seen = /* @__PURE__ */ new Set(), tokenSources = [], pushTokenSource = (value) => {
    !value || typeof value != "object" || tokenSources.includes(value) || tokenSources.push(value);
  };
  for (; queue.length > 0; ) {
    const current = queue.shift();
    if (!current || typeof current != "object" || seen.has(current))
      continue;
    seen.add(current), pushTokenSource(current?.data?.streamPlaybackAccessToken), pushTokenSource(current?.data?.videoPlaybackAccessToken), pushTokenSource(current?.streamPlaybackAccessToken), pushTokenSource(current?.videoPlaybackAccessToken), (current?.__typename === "PlaybackAccessToken" || typeof current?.signature == "string" || typeof current?.sig == "string" || typeof current?.value == "string" || typeof current?.token == "string") && pushTokenSource(current);
    const values = Array.isArray(current) ? current : Object.values(current);
    for (const value of values)
      value && typeof value == "object" && queue.push(value);
  }
  return tokenSources;
}
function _summarizePlaybackAccessTokenPayload(payload) {
  if (Array.isArray(payload)) {
    const firstKeys = payload[0] && typeof payload[0] == "object" ? Object.keys(payload[0]).slice(0, 6).join(",") : "";
    return `array(len=${payload.length}${firstKeys ? `, first=${firstKeys}` : ""})`;
  }
  return payload && typeof payload == "object" ? `object(${Object.keys(payload).slice(0, 8).join(",") || "no-keys"})` : typeof payload;
}
function _getPlaybackAccessTokenErrors(payload) {
  const entries = Array.isArray(payload) ? payload : [payload], messages = [];
  for (const entry of entries)
    if (Array.isArray(entry?.errors))
      for (const error of entry.errors) {
        const message = error?.message || error?.extensions?.message || error?.extensions?.error || null;
        typeof message == "string" && message && messages.push(message);
      }
  return messages;
}
function _extractPlaybackAccessToken(payload) {
  const tokenSources = _collectPlaybackAccessTokenSources(payload);
  for (const token of tokenSources) {
    const signature = token?.signature || token?.sig || null, value = token?.value || token?.token || null;
    if (signature && value)
      return { signature, value };
  }
  return {
    signature: null,
    value: null,
    hasAnySignature: tokenSources.some((token) => !!(token?.signature || token?.sig)),
    hasAnyValue: tokenSources.some((token) => !!(token?.value || token?.token)),
    errors: _getPlaybackAccessTokenErrors(payload),
    summary: _summarizePlaybackAccessTokenPayload(payload)
  };
}
function _isWorkerContext() {
  return typeof WorkerGlobalScope < "u" && typeof self < "u" && self instanceof WorkerGlobalScope;
}
function _createFetchRelayResponse(payload, requestUrl = null) {
  if (!payload || typeof payload != "object")
    throw new Error("invalid fetch relay response");
  if (payload.error)
    throw new Error(payload.error);
  const body = payload.body ?? "", nullBodyStatus = payload.status === 101 || payload.status === 204 || payload.status === 205 || payload.status === 304, response = new Response(nullBodyStatus ? null : body, {
    status: payload.status,
    statusText: payload.statusText,
    headers: payload.headers
  }), finalUrl = payload.url || requestUrl;
  return finalUrl && Object.defineProperty(response, "url", { value: finalUrl }), typeof payload.ok == "boolean" && Object.defineProperty(response, "ok", { value: payload.ok }), typeof payload.redirected == "boolean" && Object.defineProperty(response, "redirected", {
    value: payload.redirected
  }), response;
}
function _createRequestAbortError(requestSignal = null) {
  if (requestSignal?.reason instanceof Error && requestSignal.reason.name === "AbortError")
    return requestSignal.reason;
  try {
    return new DOMException("Playback request retired", "AbortError");
  } catch {
    const error = new Error("Playback request retired");
    return error.name = "AbortError", error;
  }
}
function _waitForRequestDelay(delayMs, requestSignal = null) {
  return requestSignal?.aborted ? Promise.reject(_createRequestAbortError(requestSignal)) : new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      requestSignal?.removeEventListener?.("abort", onAbort), resolve(void 0);
    }, Math.max(0, Number(delayMs) || 0)), onAbort = () => {
      clearTimeout(timeoutId), requestSignal?.removeEventListener?.("abort", onAbort), reject(_createRequestAbortError(requestSignal));
    };
    requestSignal?.addEventListener?.("abort", onAbort, { once: !0 });
  });
}
async function _fetchViaWorkerBridge(url, options, timeoutMs = 5e3, requestSignal = null) {
  if (!_isWorkerContext() || typeof self?.postMessage != "function")
    return null;
  if (requestSignal?.aborted)
    throw _createRequestAbortError(requestSignal);
  let pendingRequests = __TTVAB_STATE__.PendingFetchRequests;
  pendingRequests || (pendingRequests = /* @__PURE__ */ new Map(), __TTVAB_STATE__.PendingFetchRequests = pendingRequests);
  const nextSeq = (__TTVAB_STATE__.FetchRequestSeq || 0) + 1;
  __TTVAB_STATE__.FetchRequestSeq = nextSeq;
  const requestId = `fetch-${Date.now()}-${nextSeq}`;
  return new Promise((resolve, reject) => {
    let settled = !1, timeoutId = null;
    const relayOptions = { ...options || {} };
    delete relayOptions.signal;
    const cancelRelay = () => {
      try {
        _postWorkerBridgeMessage(self, {
          key: "CancelFetchRequest",
          value: { id: requestId }
        });
      } catch {
      }
    }, cleanup = () => {
      timeoutId !== null && clearTimeout(timeoutId), requestSignal?.removeEventListener?.("abort", onAbort), pendingRequests.delete(requestId);
    }, finish = (callback, value) => {
      settled || (settled = !0, cleanup(), callback(value));
    }, onAbort = () => {
      cancelRelay(), finish(reject, _createRequestAbortError(requestSignal));
    };
    timeoutId = setTimeout(() => {
      cancelRelay(), finish(reject, new Error("fetch relay timeout"));
    }, timeoutMs), requestSignal?.addEventListener?.("abort", onAbort, { once: !0 }), pendingRequests.set(requestId, {
      resolve: (payload) => {
        try {
          finish(resolve, _createFetchRelayResponse(payload, url));
        } catch (error) {
          finish(reject, error);
        }
      },
      reject: (error) => {
        finish(reject, error instanceof Error ? error : new Error(String(error?.message || error || "fetch relay failed")));
      }
    });
    try {
      _postWorkerBridgeMessage(self, {
        key: "FetchRequest",
        value: {
          id: requestId,
          url,
          options: relayOptions
        }
      }) || finish(reject, new Error("fetch relay unavailable"));
    } catch (error) {
      finish(reject, error);
    }
  });
}
async function _getToken(playbackContext, playerType, realFetch, omitViewerHeaders = !1, requestDeadlineAt = 0, requestSignal = null) {
  if (requestSignal?.aborted)
    throw _createRequestAbortError(requestSignal);
  const fetchFunc = realFetch || fetch, reqPlayerType = playerType, normalizedContext = _normalizePlaybackContext(typeof playbackContext == "string" ? {
    MediaType: "live",
    ChannelName: playbackContext
  } : playbackContext), isVodRequest = normalizedContext.MediaType === "vod" && !!normalizedContext.VodID, logTarget = isVodRequest ? `vod ${normalizedContext.VodID}` : normalizedContext.ChannelName || "unknown", body = {
    operationName: "PlaybackAccessToken",
    extensions: {
      persistedQuery: {
        version: 1,
        sha256Hash: __TTVAB_STATE__.PlaybackAccessTokenHash || "ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9"
      }
    },
    variables: {
      isLive: !isVodRequest,
      login: isVodRequest ? "" : normalizedContext.ChannelName || "",
      isVod: isVodRequest,
      vodID: isVodRequest && normalizedContext.VodID || "",
      playerType: reqPlayerType,
      platform: reqPlayerType === "autoplay" ? "android" : "web"
    }
  }, maxRetries = 2;
  let lastError = null;
  const deadlineAt = Math.max(0, Number(requestDeadlineAt) || 0), remainingDeadlineMs = () => deadlineAt > 0 ? Math.max(0, deadlineAt - Date.now()) : Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (requestSignal?.aborted)
      throw _createRequestAbortError(requestSignal);
    if (remainingDeadlineMs() <= 0 || attempt > 0 && (await _waitForRequestDelay(Math.min(attempt * 500, remainingDeadlineMs()), requestSignal), remainingDeadlineMs() <= 0))
      break;
    try {
      const acceptLanguage = navigator?.languages?.join(",") || navigator?.language || "en-US", headers = {
        "Client-ID": _C.CLIENT_ID,
        "X-Device-Id": __TTVAB_STATE__.GQLDeviceID || "oauth",
        "Client-Version": __TTVAB_STATE__.ClientVersion || "k8s-v1",
        "Client-Session-Id": __TTVAB_STATE__.ClientSession || "",
        "Accept-Language": acceptLanguage
      };
      !omitViewerHeaders && __TTVAB_STATE__.ClientIntegrityHeader && (headers["Client-Integrity"] = __TTVAB_STATE__.ClientIntegrityHeader), !omitViewerHeaders && __TTVAB_STATE__.AuthorizationHeader && (headers.Authorization = __TTVAB_STATE__.AuthorizationHeader);
      const requestOptions = {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      };
      let res = null;
      if (typeof _fetchViaWorkerBridge == "function")
        try {
          res = await _fetchViaWorkerBridge(_GQL_URL, requestOptions, Math.max(1, Math.min(5e3, remainingDeadlineMs())), requestSignal);
        } catch {
          if (requestSignal?.aborted)
            throw _createRequestAbortError(requestSignal);
        }
      if (!res) {
        if (remainingDeadlineMs() <= 0)
          throw new Error("token fetch deadline exceeded");
        res = await _fetchWithTimeout(fetchFunc, _GQL_URL, { ...requestOptions, signal: requestSignal }, Math.max(1, Math.min(3e3, remainingDeadlineMs())));
      }
      return res;
    } catch (e) {
      if (requestSignal?.aborted)
        throw _createRequestAbortError(requestSignal);
      if (lastError = e, attempt < maxRetries && (e.name === "AbortError" || e.name === "TimeoutError" || e.message?.includes("timeout")))
        continue;
      break;
    }
  }
  return Response.error();
}
async function _notifyAdComplete(textStr, info) {
  try {
    if (!textStr || typeof textStr != "string")
      return;
    const matches = [
      ...textStr.matchAll(/#EXT-X-DATERANGE:(ID="stitched-ad-[^\n]+)\n/g)
    ], podLenMatch = textStr.match(/X-TV-TWITCH-AD-POD-LENGTH="(\d+)"/), parsedPodLength = podLenMatch ? Number.parseInt(podLenMatch[1], 10) : 0, hasExplicitPodLength = Number.isFinite(parsedPodLength) && parsedPodLength > 0, parsedPodPositions = Array.from(textStr.matchAll(/X-TV-TWITCH-AD-POD-POSITION="(\d+)"/g), (match) => Number.parseInt(match[1], 10)), maxParsedPodPosition = Math.max(0, ...parsedPodPositions), observedZeroAdPodPosition = parsedPodPositions.includes(0);
    if (info && matches.length > 0) {
      info.ObservedAdPodIds instanceof Set || (info.ObservedAdPodIds = /* @__PURE__ */ new Set());
      for (const match of matches) {
        const idMatch = match[1].match(/^ID="([^"]+)"/);
        idMatch?.[1] && info.ObservedAdPodIds.add(idMatch[1]);
      }
      hasExplicitPodLength && (info.ExpectedAdPodLength = Math.max(Math.max(0, Number(info.ExpectedAdPodLength) || 0), parsedPodLength)), info.MaxObservedAdPodPosition = Math.max(Math.max(0, Number(info.MaxObservedAdPodPosition) || 0), maxParsedPodPosition), info.ObservedZeroAdPodPosition = !!(info.ObservedZeroAdPodPosition === !0 || observedZeroAdPodPosition), typeof self < "u" && self.postMessage && _postWorkerBridgeMessage(self, _createPageScopedWorkerEvent({
        key: "AdPodProgress",
        adIds: Array.from(info.ObservedAdPodIds),
        expectedPodLength: Math.max(0, Number(info.ExpectedAdPodLength) || 0),
        maxAdPodPosition: Math.max(0, Number(info.MaxObservedAdPodPosition) || 0),
        observedZeroAdPodPosition: info.ObservedZeroAdPodPosition === !0,
        cycleStartedAt: Math.max(0, Number(info.VisibleAdStartedAt) || 0),
        channel: info.ChannelName || null,
        mediaKey: info.MediaKey || null
      }));
    }
    if (__TTVAB_STATE__.DisableAdSpoofing || matches.length === 0)
      return;
    const spoofedSet = info?.SpoofedAdIds || null, recentSpoofedSet = info?.RecentSpoofedAdIds || null, podLength = hasExplicitPodLength ? parsedPodLength : matches.length;
    if (hasExplicitPodLength && spoofedSet && spoofedSet.size >= podLength)
      return;
    let newSpoofed = 0, firstRollType = "", podCompleteSent = !1;
    for (let i = 0; i < matches.length && !(hasExplicitPodLength && spoofedSet && spoofedSet.size >= podLength); i++) {
      const idMatch = matches[i][1].match(/^ID="([^"]+)"/), stitchedAdId = idMatch ? idMatch[1] : "";
      if (stitchedAdId && recentSpoofedSet?.has?.(stitchedAdId)) {
        spoofedSet?.add?.(stitchedAdId);
        continue;
      }
      if (spoofedSet && stitchedAdId && spoofedSet.has(stitchedAdId))
        continue;
      const attr = _parseAttrs(matches[i][1]), radToken = attr["X-TV-TWITCH-AD-RADS-TOKEN"];
      if (!radToken) {
        i === 0 && !__TTVAB_STATE__.LoggedAdSpoofNoToken && (__TTVAB_STATE__.LoggedAdSpoofNoToken = !0);
        continue;
      }
      const rollType = (attr["X-TV-TWITCH-AD-ROLL-TYPE"] || "").toLowerCase();
      firstRollType || (firstRollType = rollType);
      const adPosition = parseInt(attr["X-TV-TWITCH-AD-POD-POSITION"] || String(i), 10), adDuration = parseInt(attr["X-TV-TWITCH-AD-DURATION"] || "0", 10) || 0, payload = {
        stitched: !0,
        ad_id: stitchedAdId,
        roll_type: rollType,
        creative_id: attr["X-TV-TWITCH-AD-CREATIVE-ID"] || "",
        order_id: attr["X-TV-TWITCH-AD-ORDER-ID"] || "",
        line_item_id: attr["X-TV-TWITCH-AD-LINE-ITEM-ID"] || "",
        player_mute: !1,
        player_volume: 1,
        visible: !0,
        duration: adDuration,
        ad_position: adPosition,
        total_ads: podLength
      }, makePacket = (event, extra) => ({
        operationName: "ClientSideAdEventHandling_RecordAdEvent",
        variables: {
          input: {
            eventName: event,
            eventPayload: JSON.stringify({ ...payload, ...extra }),
            radToken
          }
        },
        extensions: {
          persistedQuery: {
            version: 1,
            sha256Hash: "7e6c69e6eb59f8ccb97ab73686f3d8b7d85a72a0298745ccd8bfc68e4054ca5b"
          }
        }
      });
      spoofedSet && stitchedAdId && spoofedSet.add(stitchedAdId);
      const batch = [
        makePacket("video_ad_impression"),
        makePacket("video_ad_quartile_complete", { quartile: 1 }),
        makePacket("video_ad_quartile_complete", { quartile: 2 }),
        makePacket("video_ad_quartile_complete", { quartile: 3 }),
        makePacket("video_ad_quartile_complete", { quartile: 4 })
      ];
      (!spoofedSet || hasExplicitPodLength && spoofedSet.size === podLength) && (batch.push(makePacket("video_ad_pod_complete")), podCompleteSent = !0);
      const headers = {
        "Client-ID": _C.CLIENT_ID,
        "X-Device-Id": __TTVAB_STATE__.GQLDeviceID || "oauth"
      };
      __TTVAB_STATE__.AuthorizationHeader && (headers.Authorization = __TTVAB_STATE__.AuthorizationHeader), __TTVAB_STATE__.ClientIntegrityHeader && (headers["Client-Integrity"] = __TTVAB_STATE__.ClientIntegrityHeader), __TTVAB_STATE__.ClientVersion && (headers["Client-Version"] = __TTVAB_STATE__.ClientVersion), __TTVAB_STATE__.ClientSession && (headers["Client-Session-Id"] = __TTVAB_STATE__.ClientSession), _fetchViaWorkerBridge(_GQL_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(batch)
      }, 5e3).then((response) => {
        response && response.status !== 200 && !__TTVAB_STATE__.LoggedAdSpoofBadStatus && (__TTVAB_STATE__.LoggedAdSpoofBadStatus = !0);
      }).catch(() => {
      }), newSpoofed++;
    }
    if (newSpoofed > 0) {
      const total = spoofedSet ? spoofedSet.size : newSpoofed, src = info?.ActiveBackupPlayerType || "primary";
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
  }
}
function _resetNativeRecoveryCandidateState(info) {
  info && (info.NativeRecoveryCandidateUrl = null, info.NativeRecoveryCandidateMediaKey = null, info.NativeRecoveryCandidateCycleStartedAt = 0, info.NativeRecoveryCandidateStage = null, info.NativeRecoveryCandidateStartedAt = 0, info.NativeRecoveryCandidateCleanCount = 0, info.NativeRecoveryCandidateLastMediaSequence = null);
}
function _reportPostAdNativeSession(info, phase) {
  try {
    const session = info?._PendingPostAdNativeMaster;
    if (!session || session.phase === phase)
      return;
    session.phase = phase, typeof self < "u" && self.postMessage;
  } catch {
  }
}
function _updatePostAdNativeMasterReload(info, reload, preparing = !1) {
  const session = info?._PendingPostAdNativeMaster;
  if (!session)
    return;
  const reloadAt = Math.max(0, Number(reload?.reloadAt) || 0), repeatedReload = reloadAt > 0 && reloadAt === session.reloadAt, countedReload = reloadAt > 0 && reloadAt === session.countedReloadAt;
  if (reload?.preserveNativeSession !== !0 || reload.reason !== "post-ad-native-restore" && reload.reason !== "ad-recovery" || reloadAt <= 0 || reloadAt < (Number(session.reloadAt) || 0) || reloadAt > Date.now() || Date.now() >= session.expiresAt || !countedReload && (Number(session.reloadCount) || 0) >= 2 || _normalizeMediaKey(reload.mediaKey) !== session.mediaKey || _normalizeMediaKey(__TTVAB_STATE__.PageMediaKey) !== session.mediaKey || __TTVAB_STATE__.CurrentAdMediaKey || _normalizeMediaKey(__TTVAB_STATE__.LastAdEndedMediaKey) !== session.mediaKey || Number(reload.cycleStartedAt) !== session.cycleStartedAt || Number(__TTVAB_STATE__.LastAdEndedCycleStartedAt) !== session.cycleStartedAt || Number(__TTVAB_STATE__.PagePlaybackContextGeneration || 0) !== Number(session.pageGeneration || 0)) {
    _reportPostAdNativeSession(info, "released"), info._PendingPostAdNativeMaster = null;
    return;
  }
  const firstReload = !session.reloadAt;
  session.reloadAt = reloadAt, !preparing && !countedReload && (session.reloadCount = (Number(session.reloadCount) || 0) + 1, session.countedReloadAt = reloadAt), repeatedReload || (session.consumed = !1, (!firstReload || Number(session.masterServedAt) < reloadAt) && (session.masterServedAt = 0)), session.loaderEpoch = Math.max(0, Number(info.NativeRecoveryLoaderEpoch) || 0), repeatedReload || _reportPostAdNativeSession(info, firstReload ? "armed" : "rearmed");
}
function _resetStreamAdState(info, preserveEmptyHoldTimelines = !1) {
  const wasUsingModifiedM3U8 = !!info?.IsUsingModifiedM3U8, wasUsingFallbackStream = !!info?.IsUsingFallbackStream, wasUsingBackupStream = !!info?.IsUsingBackupStream, hadStrippedAdSegments = Math.max(0, Number(info?.NumStrippedAdSegments) || 0) > 0, endedCodecHandoffId = _getActiveCodecHandoffIdForInfo(info), completedCodecHandoff = !!(endedCodecHandoffId && info?._CodecHandoffPendingId === endedCodecHandoffId && info?._CodecHandoffAcknowledgedId === endedCodecHandoffId);
  if (info.IsShowingAd = !1, info.IsUsingModifiedM3U8 = !1, info.IsUsingFallbackStream = !1, info.IsUsingBackupStream = !1, info.RequestedAds?.clear?.(), info.SpoofedAdIds?.size && info.RecentSpoofedAdIds?.set) {
    for (const adId of info.SpoofedAdIds)
      info.RecentSpoofedAdIds.set(adId, Date.now());
    for (; info.RecentSpoofedAdIds.size > 50; ) {
      const oldest = info.RecentSpoofedAdIds.keys().next().value;
      if (oldest === void 0)
        break;
      info.RecentSpoofedAdIds.delete(oldest);
    }
  }
  return info.SpoofedAdIds?.clear?.(), info.ObservedAdPodIds?.clear?.(), info.ExpectedAdPodLength = 0, info.MaxObservedAdPodPosition = 0, info.ObservedZeroAdPodPosition = !1, info.LastAdPodProgressAt = 0, info._IncompletePodCleanStartedAt = 0, info._IncompletePodCleanPlaylistCount = 0, info._IncompletePodLastMediaSequence = null, info._IncompletePodCandidateUrl = null, info.FailedBackupPlayerTypes?.clear?.(), info.ActiveBackupPlayerType = null, info.ActiveBackupResolution = null, info.IsMidroll = !1, info.AdRollContext = null, info.CsaiOnlyThisBreak = !1, info.IsStrippingAdSegments = !1, info.NumStrippedAdSegments = 0, info.PendingAdEndAt = 0, info.CleanPlaylistCount = 0, info.AdEndMarkerBounceLogged = !1, info.ConsecutiveFailedNativeProbes = 0, info.VisibleAdStartedAt = 0, info.IsHoldingBackupAfterAd = !1, info.SilentBackupHoldStartedAt = 0, info.LastSilentBackupHoldLogAt = 0, info.LastNativeRecoveryHoldLogAt = 0, info.NativeRecoveryProbeStreamUrl = null, info.NativeRecoveryProbeMediaKey = null, info.NativeRecoveryProbePlayerType = null, info.NativeRecoveryProbeCycleStartedAt = 0, info.NativeRecoveryProbeLastMediaSequence = null, info.NativeRecoveryProbeLastAdvancedAt = 0, info.NativeRecoveryAdPlaylistUrls?.clear?.(), info.NativeRecoveryAdMediaKey = null, info.NativeRecoveryAdStartedAt = 0, info._PendingPostAdNativeMaster = null, _resetNativeRecoveryCandidateState(info), info._PendingNativeReloadConfirmation = null, info.HevcReloadPendingAfterHold = !1, info.LastAdEndBounceAt = 0, info.LoggedBackupAdsByType = null, info._LoggedWhitelistByType = null, info._BackupSearchStartedAt = 0, info._BackupSearchStartToken = null, info._LastBackupSearchCompletedAt = 0, info._LastNoBackupProbeAt = 0, info._NoBackupRecoveryCandidates?.clear?.(), info._ForegroundQualityProbeAppliedAt = 0, info.BackupSearchEpoch = Math.max(0, Number(info.BackupSearchEpoch) || 0) + 1, info._BackupSearchPromises?.clear?.(), info._BackupSearchPromise = null, info._BackupSearchKey = null, info._BackupSelectionSequence = 0, info._BackupSelection = null, info.BackupPlaylistMetadata?.clear?.(), info._LoggedOfflineTransition = !1, info._LqHoldStartAt = 0, info._BackupProbation = null, info._EmptyAdHoldMediaSequence = 0, info._EmptyAdHoldDiscontinuitySequence = 0, info._EmptyAdHoldProgramDateTime = 0, info._EmptyAdHoldWindow = null, preserveEmptyHoldTimelines || (info._EmptyHoldTimelineByUrl?.clear?.(), info._LivePlaylistTimeline = null, info._LastServedPlaylistKind = null, info._NativePlaybackMaster = null, info._SpliceStreamId = null, info._SpliceBoundarySeq = null, info._SpliceDiscontinuityOffset = 0, info._SpliceLastDiscontinuitySequence = null, info._SpliceLastMediaSequence = null, info._NativeSpliceBoundaries?.clear?.()), info._FatalMediaRecoveryRequestId = null, _clearCodecHandoffState(info, null, completedCodecHandoff), endedCodecHandoffId && __TTVAB_STATE__?.ActiveCodecHandoffId === endedCodecHandoffId && _normalizeMediaKey(__TTVAB_STATE__?.ActiveCodecHandoffMediaKey) === _normalizeMediaKey(info?.MediaKey) && (__TTVAB_STATE__.ActiveCodecHandoffId = null, __TTVAB_STATE__.ActiveCodecHandoffChannel = null, __TTVAB_STATE__.ActiveCodecHandoffMediaKey = null), info._AdRequestController && (info._AdRequestController.abort(), info._AdRequestController = null), info._AdCycleRequestController && (info._AdCycleRequestController.abort(), info._AdCycleRequestController = null), _resetNativeRecoveryReadyState(info), {
    wasUsingModifiedM3U8,
    wasUsingFallbackStream,
    wasUsingBackupStream,
    hadStrippedAdSegments
  };
}
function _getResolvedAdEndMinCleanPlaylists() {
  return Math.max(1, Number(__TTVAB_STATE__?.AdEndMinCleanPlaylists) || 1);
}
function _getResolvedAdEndGraceMs() {
  return Math.max(0, Number(__TTVAB_STATE__?.AdEndGraceMs) || 0);
}
function _getResolvedAdEndMaxWaitMs() {
  return Math.max(0, Number(__TTVAB_STATE__?.AdEndMaxWaitMs) || 0);
}
function _getResolvedAdEndBackupHoldMaxMs() {
  return Math.max(0, Number(__TTVAB_STATE__?.AdEndBackupHoldMaxMs) || Number(_C?.AD_END_BACKUP_HOLD_MAX_MS) || 0);
}
function _getResolvedSilentBackupHoldMaxMs() {
  return Math.max(0, Number(__TTVAB_STATE__?.SilentBackupHoldMaxMs) || 12e4);
}
function _getPostAdReentryContinuationMs() {
  return 8e3;
}
function _rememberLastAdEnd(info, endedAt = Date.now(), cycleStartedAt = Math.max(0, Number(info?.VisibleAdStartedAt) || 0)) {
  const safeEndedAt = Math.max(0, Number(endedAt) || 0), endedContext = _normalizePlaybackContext({
    MediaType: info?.MediaType || __TTVAB_STATE__?.PageMediaType || null,
    ChannelName: info?.ChannelName || null,
    VodID: info?.VodID || null,
    MediaKey: info?.MediaKey || null
  });
  info && (info.LastAdEndReloadAt = safeEndedAt), __TTVAB_STATE__.LastAdEndedAt = safeEndedAt, __TTVAB_STATE__.LastAdEndedChannel = endedContext.ChannelName, __TTVAB_STATE__.LastAdEndedMediaKey = endedContext.MediaKey, __TTVAB_STATE__.LastAdEndedCycleStartedAt = Math.max(0, Number(cycleStartedAt) || 0);
}
function _doesPlaybackContextMatchInfo(info, mediaKey = null, channel = null) {
  const infoMediaKey = _normalizeMediaKey(info?.MediaKey), targetMediaKey = _normalizeMediaKey(mediaKey);
  if (infoMediaKey && targetMediaKey)
    return infoMediaKey === targetMediaKey;
  const infoChannel = _normalizeChannelName(info?.ChannelName), targetChannel = _normalizeChannelName(channel);
  return !!(infoChannel && targetChannel && infoChannel === targetChannel);
}
function _isRecentPostAdReentry(info, now = Date.now()) {
  const continuationMs = _getPostAdReentryContinuationMs();
  if (continuationMs <= 0)
    return !1;
  const localEndedAt = Math.max(0, Number(info?.LastAdEndReloadAt) || 0);
  if (localEndedAt > 0 && now - localEndedAt <= continuationMs)
    return !0;
  const sharedEndedAt = Math.max(0, Number(__TTVAB_STATE__?.LastAdEndedAt) || 0);
  return sharedEndedAt <= 0 || now - sharedEndedAt > continuationMs ? !1 : _doesPlaybackContextMatchInfo(info, __TTVAB_STATE__?.LastAdEndedMediaKey, __TTVAB_STATE__?.LastAdEndedChannel);
}
function _getBackupPlayerRetryCooldownMs(reason = "ad-marked") {
  switch (reason) {
    case "error":
    case "stream-error":
    case "token-error":
      return 1500;
    case "not-playable":
    case "no-stream-url":
      return 2e3;
    case "stalled":
      return 1e4;
    default:
      return 15e3;
  }
}
function _markBackupPlayerRetryCooldown(info, playerType, reason = "ad-marked") {
  if (!info?.FailedBackupPlayerTypes?.set || typeof playerType != "string")
    return 0;
  const retryAt = Date.now() + _getBackupPlayerRetryCooldownMs(reason);
  return info.FailedBackupPlayerTypes.set(playerType, retryAt), retryAt;
}
function _clearBackupPlayerRetryCooldown(info, playerType) {
  info?.FailedBackupPlayerTypes?.delete?.(playerType);
}
function _isBackupPlayerRetryCoolingDown(info, playerType) {
  if (!info?.FailedBackupPlayerTypes?.get || typeof playerType != "string")
    return !1;
  const retryAt = Number(info.FailedBackupPlayerTypes.get(playerType)) || 0;
  return retryAt <= 0 || retryAt <= Date.now() ? (info.FailedBackupPlayerTypes.delete?.(playerType), !1) : !0;
}
function _forceClearBackupCooldownsIfStale(info, now = Date.now()) {
  return !info?.FailedBackupPlayerTypes?.clear || now - (Number(info.LastCleanBackupAt) || 0) < 8e3 || info.FailedBackupPlayerTypes.size === 0 || ![...info.FailedBackupPlayerTypes.values()].every((retryAt) => Number(retryAt) > now) ? !1 : (info.FailedBackupPlayerTypes.clear(), info.LoggedBackupAdsByType?.clear?.(), !0);
}
function _getEarlyNoBackupRetry(info, startIdx = 0, codecs = null) {
  const now = Date.now(), cycleStartedAt = Math.max(0, Number(info?.VisibleAdStartedAt) || 0), backupSearchEpoch = Math.max(0, Number(info?.BackupSearchEpoch) || 0), searchCompletedAt = Number(info?._LastBackupSearchCompletedAt) || 0, regularRetryAt = searchCompletedAt + 15e3, deadlineAt = Math.min(now + 2500, regularRetryAt - 250), mediaKey = _normalizeMediaKey(info?.MediaKey);
  if (__TTVAB_STATE__?.IsAdStrippingEnabled !== !0 || __TTVAB_STATE__?.DisableAutoplayBackup !== !0 || info?.MediaType !== "live" || !mediaKey || _normalizeMediaKey(__TTVAB_STATE__?.PageMediaKey) !== mediaKey || cycleStartedAt <= 0 || !_isBackupSearchContextCurrent(info, backupSearchEpoch, cycleStartedAt) || info._AdCycleRequestController?.signal?.aborted || now - (Number(info._LastNoBackupProbeAt) || 0) < 1500 || info.IsUsingModifiedM3U8 || info.LastCleanBackupM3U8 || info.IsUsingBackupStream || Number(info.LastCleanBackupAt) >= cycleStartedAt || info.EnhancedDecoderCodecFamily || info.EnhancedDecoderCodec || _getVideoCodecFamily(codecs) !== "avc" || info._BackupSearchPromise || info._BackupSearchPromises?.size > 0 || searchCompletedAt <= 0 || searchCompletedAt < cycleStartedAt || now < searchCompletedAt || deadlineAt - now < 1e3 || _isRecentPostAdReentry(info) || _getPendingForegroundQualityProbeAt(info) > 0 || Number(__TTVAB_STATE__?.BackupSearchForceRefreshAt) > 0)
    return null;
  const candidates = _getOrderedBackupPlayerTypes(info, startIdx).filter((type) => ["site", "embed", "popout", "mobile_web"].includes(type)).map((playerType) => ({
    playerType,
    candidate: info._NoBackupRecoveryCandidates?.get?.(playerType)
  })).filter(({ candidate }) => candidate && candidate.cycleStartedAt === cycleStartedAt && candidate.backupSearchEpoch === backupSearchEpoch && now - candidate.createdAt <= 6e4 && now - candidate.lastProbeAt >= 900);
  for (const { candidate } of candidates)
    now - candidate.cleanStartedAt > 5e3 && (candidate.cleanStartedAt = 0, candidate.cleanMediaSequence = null);
  return candidates.sort((a, b) => +(b.candidate.cleanStartedAt > 0) - +(a.candidate.cleanStartedAt > 0) || a.candidate.lastProbeAt - b.candidate.lastProbeAt), candidates.length ? {
    ...candidates[0],
    candidates: candidates.slice(0, 4),
    mediaKey,
    pageGeneration: Number(__TTVAB_STATE__?.PagePlaybackContextGeneration) || 0,
    cycleStartedAt,
    backupSearchEpoch,
    searchCompletedAt,
    regularRetryAt,
    deadlineAt
  } : null;
}
function _startEarlyNoBackupRetry(info, realFetch, startIdx, resolution, codecs, retry) {
  _findBackupStream(info, realFetch, startIdx, resolution, codecs, retry.deadlineAt, retry).then((result) => {
    result?.m3u8 && _normalizeMediaKey(__TTVAB_STATE__?.PageMediaKey) === retry.mediaKey && (Number(__TTVAB_STATE__?.PagePlaybackContextGeneration) || 0) === retry.pageGeneration && info._LastBackupSearchCompletedAt === retry.searchCompletedAt && _isBackupSearchContextCurrent(info, retry.backupSearchEpoch, retry.cycleStartedAt) && (info._LastBackupSearchCompletedAt = 0);
  }, (error) => {
  });
}
function _getPinnedBackupPlayerTypeForInfo(info) {
  const pinnedType = typeof __TTVAB_STATE__?.PinnedBackupPlayerType == "string" && __TTVAB_STATE__.PinnedBackupPlayerType ? __TTVAB_STATE__.PinnedBackupPlayerType : null;
  if (!pinnedType)
    return null;
  const pinnedContext = _normalizePlaybackContext({
    MediaType: __TTVAB_STATE__?.PageMediaType || info?.MediaType || null,
    ChannelName: __TTVAB_STATE__?.PinnedBackupPlayerChannel || __TTVAB_STATE__?.CurrentAdChannel || info?.ChannelName || null,
    VodID: __TTVAB_STATE__?.PageVodID || info?.VodID || null,
    MediaKey: __TTVAB_STATE__?.PinnedBackupPlayerMediaKey || __TTVAB_STATE__?.CurrentAdMediaKey || info?.MediaKey || null
  }), infoContext = _normalizePlaybackContext({
    MediaType: info?.MediaType || null,
    ChannelName: info?.ChannelName || null,
    VodID: info?.VodID || null,
    MediaKey: info?.MediaKey || null
  });
  return pinnedContext.MediaKey && infoContext.MediaKey ? pinnedContext.MediaKey === infoContext.MediaKey ? pinnedType : null : pinnedContext.ChannelName && infoContext.ChannelName && pinnedContext.ChannelName === infoContext.ChannelName ? pinnedType : null;
}
function _getRecentCleanBackupPlayerTypeForInfo(info, now = Date.now()) {
  const playerType = typeof info?.LastCleanBackupPlayerType == "string" && info.LastCleanBackupPlayerType ? info.LastCleanBackupPlayerType : null;
  if (!playerType || playerType === "autoplay" || _isBackupPlayerRetryCoolingDown(info, playerType) || info?.LoggedBackupAdsByType?.has?.(playerType) || typeof info?.LastCleanBackupM3U8 != "string" || !info.LastCleanBackupM3U8)
    return null;
  const lastCleanAt = Number(info.LastCleanBackupAt) || 0, ageMs = now - lastCleanAt;
  return lastCleanAt <= 0 || ageMs < 0 || ageMs > 12e4 ? null : playerType;
}
function _recordNativeAdRollType(info, text) {
  const mediaKey = _normalizeMediaKey(info?.MediaKey), cycleStartedAt = Number(info?.VisibleAdStartedAt) || 0, pageGeneration = Number(__TTVAB_STATE__?.PagePlaybackContextGeneration) || 0;
  if (info?.MediaType !== "live" || !mediaKey || cycleStartedAt <= 0 || _normalizeMediaKey(__TTVAB_STATE__?.PageMediaKey) !== mediaKey)
    return;
  const previous = info.AdRollContext;
  let rollType = previous?.mediaKey === mediaKey && previous?.cycleStartedAt === cycleStartedAt && previous?.pageGeneration === pageGeneration ? previous.rollType : null;
  for (const match of text.matchAll(/^#EXT-X-DATERANGE:([^\r\n]*)/gm)) {
    const attrs = _parseAttrs(match[1]), type = String(attrs["X-TV-TWITCH-AD-ROLL-TYPE"] || "").toLowerCase();
    if (type === "midroll") {
      rollType = type;
      break;
    }
    type === "preroll" && rollType !== "midroll" && (rollType = type);
  }
  rollType && (info.AdRollContext = { mediaKey, cycleStartedAt, pageGeneration, rollType });
}
function _isLiveAdAutoplayBackupAllowed(info) {
  const context = info?.AdRollContext;
  return !!(__TTVAB_STATE__?.IsAdStrippingEnabled === !0 && info?.MediaType === "live" && (context?.rollType === "preroll" || context?.rollType === "midroll") && context.cycleStartedAt > 0 && context.mediaKey === _normalizeMediaKey(info.MediaKey) && context.mediaKey === _normalizeMediaKey(__TTVAB_STATE__?.PageMediaKey) && context.pageGeneration === (Number(__TTVAB_STATE__?.PagePlaybackContextGeneration) || 0) && _isBackupSearchContextCurrent(info, info.BackupSearchEpoch, context.cycleStartedAt));
}
function _isAutoplayBackupAvailableForSearch(info = null) {
  return !!(__TTVAB_STATE__?.DisableAutoplayBackup !== !0 || __TTVAB_STATE__?.AllowPreviewEmergencyAutoplayBackup === !0 || _isLiveAdAutoplayBackupAllowed(info));
}
function _getOrderedBackupPlayerTypes(info, startIdx = 0) {
  const liveAdEmergency = __TTVAB_STATE__?.DisableAutoplayBackup === !0 && _isLiveAdAutoplayBackupAllowed(info), configuredPlayerTypes = [
    ...__TTVAB_STATE__?.BackupPlayerTypes || []
  ].filter((pt) => pt !== "autoplay" || _isAutoplayBackupAvailableForSearch(info)), orderedPlayerTypes = [], pushUnique = (playerType) => {
    typeof playerType != "string" || !playerType || orderedPlayerTypes.includes(playerType) || !configuredPlayerTypes.includes(playerType) || orderedPlayerTypes.push(playerType);
  }, activePlayerType = typeof info?.ActiveBackupPlayerType == "string" && info.ActiveBackupPlayerType ? info.ActiveBackupPlayerType : null, safeStartIdx = Math.max(0, Math.min(configuredPlayerTypes.length, Number(startIdx) || 0)), shouldTryAutoplayFirst = _shouldTryAutoplayFirst(info), shouldHoldAutoplayBackup = _shouldHoldAutoplayBackupDuringAd(info), effectiveStartIdx = liveAdEmergency || activePlayerType === "autoplay" && !shouldTryAutoplayFirst && !shouldHoldAutoplayBackup ? 0 : safeStartIdx, preferredPlayerType = _getPinnedBackupPlayerTypeForInfo(info);
  pushUnique(preferredPlayerType === "autoplay" && !shouldTryAutoplayFirst && !shouldHoldAutoplayBackup ? null : preferredPlayerType), shouldTryAutoplayFirst && pushUnique("autoplay"), pushUnique(_getRecentCleanBackupPlayerTypeForInfo(info)), (activePlayerType !== "autoplay" || shouldTryAutoplayFirst || shouldHoldAutoplayBackup) && pushUnique(activePlayerType);
  for (const playerType of configuredPlayerTypes.slice(effectiveStartIdx))
    pushUnique(playerType);
  return liveAdEmergency ? [
    ...orderedPlayerTypes.filter((pt) => pt !== "autoplay"),
    ...orderedPlayerTypes.filter((pt) => pt === "autoplay")
  ] : orderedPlayerTypes;
}
function _resolvePlaybackResolutionForUrl(info, url = "") {
  let resolution = null;
  for (const alias of _getPlaylistUrlAliases(url))
    if (resolution = info?.Urls?.[alias] || null, resolution)
      break;
  return resolution || (resolution = _getFallbackResolution(info, url)), resolution;
}
function _getNativeRecoveryMaster(info, forRefresh = !1) {
  const current = {
    master: info?.EncodingsM3U8,
    masterUrl: info?.UsherBaseUrl,
    resolutionList: Array.isArray(info?.ResolutionList) ? info.ResolutionList : []
  }, saved = info?._NativePlaybackMaster, mediaKey = _normalizeMediaKey(info?.MediaKey), cycleStartedAt = Math.max(0, Number(info?.VisibleAdStartedAt) || 0), quality = __TTVAB_STATE__?.PreferredQualityGroup, requestedHeight = Number(String(quality || "").match(/^(\d+)p/)?.[1]) || 0, currentTarget = _getResolutionByQualityGroup(current.resolutionList, quality), currentHeight = Number(String(currentTarget?.Resolution || "").split("x")[1]) || 0;
  if (!saved || info.MediaType === "vod" || __TTVAB_STATE__?.IsAdStrippingEnabled !== !0 || !mediaKey || saved.mediaKey !== mediaKey || _normalizeMediaKey(__TTVAB_STATE__?.PageMediaKey) !== mediaKey || saved.pageGeneration !== (Number(__TTVAB_STATE__?.PagePlaybackContextGeneration) || 0) || saved.observedAt <= 0 || saved.observedAt > (cycleStartedAt || Date.now()) || !forRefresh && !(cycleStartedAt > 0 && saved.refreshedCycleStartedAt === cycleStartedAt && saved.refreshedAt >= cycleStartedAt && saved.refreshedAt <= Date.now() && Date.now() - saved.refreshedAt <= 6e5) && ((cycleStartedAt || Date.now()) - saved.observedAt > 6e4 || Date.now() - saved.observedAt > 6e5) || quality === "audio_only" || requestedHeight > 0 && requestedHeight <= currentHeight || cycleStartedAt > 0 && _normalizeMediaKey(__TTVAB_STATE__?.CurrentAdMediaKey) !== mediaKey)
    return current;
  const savedTarget = _getResolutionByQualityGroup(saved.resolutionList, quality) || _getResolutionByQualityGroup(saved.resolutionList, "chunked") || info.SustainedNativeResolution, savedHeight = Number(String(savedTarget?.Resolution || "").split("x")[1]) || 0, availableHeight = current.resolutionList.reduce((height, entry) => Math.max(height, Number(String(entry?.Resolution || "").split("x")[1]) || 0), 0);
  return savedHeight > (currentHeight || availableHeight) ? saved : current;
}
async function _refreshNativeRecoveryMaster(info, realFetch, requestSignal) {
  const saved = _getNativeRecoveryMaster(info, !0), cycleStartedAt = Number(info.VisibleAdStartedAt) || 0;
  if (saved !== info._NativePlaybackMaster || _getNativeRecoveryMaster(info) === saved || !info.IsHoldingBackupAfterAd || cycleStartedAt <= 0)
    return;
  if (saved.refreshAttemptCycleStartedAt === cycleStartedAt)
    return saved.refreshPromise;
  const currentMaster = info.EncodingsM3U8, currentMasterUrl = info.UsherBaseUrl, loaderEpoch = Number(info.NativeRecoveryLoaderEpoch) || 0, quality = __TTVAB_STATE__.PreferredQualityGroup, target = _getResolutionByQualityGroup(saved.resolutionList, quality) || _getResolutionByQualityGroup(saved.resolutionList, "chunked") || info.SustainedNativeResolution;
  if (!target?.Url || !saved.masterUrl)
    return;
  const deadlineAt = Date.now() + 2500, isCurrent = () => !!(!requestSignal?.aborted && Date.now() < deadlineAt && __TTVAB_STATE__.IsAdStrippingEnabled === !0 && __TTVAB_STATE__.StreamInfos[info.MediaKey] === info && _normalizeMediaKey(__TTVAB_STATE__.PageMediaKey) === saved.mediaKey && _normalizeMediaKey(__TTVAB_STATE__.CurrentAdMediaKey) === saved.mediaKey && (Number(__TTVAB_STATE__.PagePlaybackContextGeneration) || 0) === saved.pageGeneration && __TTVAB_STATE__.PreferredQualityGroup === quality && info._NativePlaybackMaster === saved && info.VisibleAdStartedAt === cycleStartedAt && info.IsHoldingBackupAfterAd && info.EncodingsM3U8 === currentMaster && info.UsherBaseUrl === currentMasterUrl && (Number(info.NativeRecoveryLoaderEpoch) || 0) === loaderEpoch);
  if (isCurrent())
    return saved.refreshAttemptCycleStartedAt = cycleStartedAt, saved.refreshPromise = (async () => {
      let stage = "master-fetch", masterOutcome = "pending", refreshed = !1;
      try {
        const masterDeadlineAt = Math.min(deadlineAt, Date.now() + 1e3), probe = await _awaitBackupProbeBeforeDeadline(_fetchWithTimeout(realFetch, saved.masterUrl, { signal: requestSignal, cache: "no-store" }, Math.max(1, masterDeadlineAt - Date.now())), masterDeadlineAt).catch(() => null);
        if (masterOutcome = probe?.completed ? `http-${probe.value.status}` : Date.now() >= masterDeadlineAt ? "deadline" : "fetch-error", !isCurrent())
          return;
        const masterAvailable = probe?.completed && probe.value.status === 200;
        stage = "master-validation";
        const master = masterAvailable ? await probe.value.text() : saved.master;
        if (!isCurrent() || !master.trimStart().startsWith("#EXTM3U") || _hasPlaylistAdMarkers(master) || _hasExplicitAdMetadata(master))
          return;
        const resolutions = [];
        let hasUnknownVideoCodec = !1;
        const lines = master.split(/\r?\n/);
        for (let index = 0; index < lines.length - 1; index++) {
          const uri = lines[index + 1]?.trim();
          if (!lines[index].startsWith("#EXT-X-STREAM-INF:") || !uri || uri.startsWith("#"))
            continue;
          const attrs = _parseAttrs(lines[index]);
          if (attrs.RESOLUTION) {
            if (!_getVideoCodecIdentity(attrs.CODECS)) {
              hasUnknownVideoCodec = !0;
              continue;
            }
            resolutions.push(_getStreamVariantInfo(attrs, uri, _getExactPlaylistUrlKey(uri, saved.masterUrl)));
          }
        }
        stage = "master-target";
        const compatibleTargets = resolutions.filter((entry) => entry.Resolution === target.Resolution && _getVideoCodecIdentity(entry.Codecs) === _getVideoCodecIdentity(target.Codecs)), targetHeight = Number(String(target.Resolution || "").split("x")[1]) || 0, reducedCatalog = resolutions.length > 0 && !hasUnknownVideoCodec && !!_getVideoCodecIdentity(target.Codecs) && resolutions.every((entry) => {
          const height = Number(String(entry.Resolution || "").split("x")[1]) || 0;
          return height > 0 && height < targetHeight;
        });
        if (!compatibleTargets.length && !reducedCatalog)
          return;
        const retainedSession = !masterAvailable || !compatibleTargets.some((entry) => entry.Url === target.Url);
        if (retainedSession) {
          let previousSequence = null;
          for (let look = 0; look < 2; look++) {
            if (stage = `media-fetch-${look + 1}`, !isCurrent())
              return;
            const mediaProbe = await _awaitBackupProbeBeforeDeadline(_fetchWithTimeout(realFetch, target.Url, { signal: requestSignal, cache: "no-store" }, Math.max(1, deadlineAt - Date.now())), deadlineAt);
            if (!mediaProbe.completed || !isCurrent() || mediaProbe.value.status !== 200)
              return;
            stage = `media-validation-${look + 1}`;
            const media = await mediaProbe.value.text();
            if (!isCurrent())
              return;
            const sequence = _parsePlaylistFirstMediaSequence(media);
            if (_hasPlaylistAdMarkers(media) || _hasExplicitAdMetadata(media) || _playlistHasKnownAdSegments(media) || !_playlistHasMediaSegments(media) || media.includes("#EXT-X-SKIP:") || media.includes("#EXT-X-ENDLIST") || sequence == null || previousSequence != null && sequence < previousSequence)
              return;
            previousSequence = sequence;
          }
        }
        info._NativePlaybackMaster = {
          ...saved,
          master: retainedSession ? saved.master : master,
          resolutionList: retainedSession ? saved.resolutionList : resolutions,
          refreshedAt: Date.now(),
          refreshedCycleStartedAt: cycleStartedAt,
          refreshPromise: null
        }, refreshed = !0;
      } catch {
      } finally {
        if (!refreshed) {
          const outcome = Date.now() >= deadlineAt ? "deadline" : isCurrent() ? "rejected" : "stale-context";
        }
        saved.refreshAttemptCycleStartedAt === cycleStartedAt && (saved.refreshPromise = null);
      }
    })(), saved.refreshPromise;
}
function _resolveAdBackupTargetResolution(info, url = "", requestedResolution = null) {
  const resolutionList = _getNativeRecoveryMaster(info, !0).resolutionList.filter(Boolean), urlResolution = _degradeToDecodableResolution(info, _resolvePlaybackResolutionForUrl(info, url), resolutionList), ownedRequestedResolution = _degradeToDecodableResolution(info, requestedResolution, resolutionList), preferredResolution = _resolvePreferredBackupResolution({
    ...info,
    ResolutionList: resolutionList
  }), heightOf = (entry) => {
    const [, h] = String(entry?.Resolution || "0x0").split("x").map(Number);
    return Number.isFinite(h) ? h : 0;
  };
  let targetResolution = null;
  for (const candidate of [
    urlResolution,
    ownedRequestedResolution,
    preferredResolution
  ])
    candidate && (!targetResolution || heightOf(candidate) > heightOf(targetResolution)) && (targetResolution = candidate);
  return targetResolution;
}
function _isBackupProbationCurrent(info, probation = info?._BackupProbation) {
  return !!(probation?.type && probation.type !== "autoplay" && probation.mediaKey === _normalizeMediaKey(info?.MediaKey) && probation.pageMediaKey === _normalizeMediaKey(__TTVAB_STATE__?.PageMediaKey) && probation.pageGeneration === (Number(__TTVAB_STATE__?.PagePlaybackContextGeneration) || 0) && probation.cycleStartedAt > 0 && _isBackupSearchContextCurrent(info, probation.backupSearchEpoch, probation.cycleStartedAt) && !info._AdCycleRequestController?.signal?.aborted && probation.cache && info.BackupEncodingsM3U8Cache?.[probation.type] === probation.cache);
}
function _isBackupProbationDue(info) {
  const probation = info?._BackupProbation;
  return !!(_isBackupProbationCurrent(info, probation) && probation.at >= probation.cycleStartedAt && Date.now() - probation.at >= 1500 && (info.ActiveBackupPlayerType === "autoplay" || info.LastCleanBackupPlayerType === "autoplay") && !_isBackupPlayerRetryCoolingDown(info, probation.type) && !info._BackupSearchPromise && !(info._BackupSearchPromises?.size > 0));
}
function _getPendingForegroundQualityProbeAt(info) {
  const visibleSinceAt = Math.max(0, Number(__TTVAB_STATE__?.PagePlaybackVisibleSinceAt) || 0), cycleStartedAt = Math.max(0, Number(info?.VisibleAdStartedAt) || 0), mediaKey = _normalizeMediaKey(info?.MediaKey);
  if (!visibleSinceAt || !cycleStartedAt || visibleSinceAt <= cycleStartedAt || !mediaKey || _normalizeMediaKey(__TTVAB_STATE__?.PageMediaKey) !== mediaKey || _normalizeMediaKey(__TTVAB_STATE__?.CurrentAdMediaKey) !== mediaKey || !info?.IsShowingAd && !info?.IsHoldingBackupAfterAd || info?.ActiveBackupPlayerType !== "autoplay" && info?.LastCleanBackupPlayerType !== "autoplay" || typeof info?.LastCleanBackupM3U8 != "string" || !info.LastCleanBackupM3U8 || Math.max(0, Number(info.LastCleanBackupAt) || 0) < cycleStartedAt)
    return 0;
  const preferredQualityGroup = typeof __TTVAB_STATE__?.PreferredQualityGroup == "string" ? __TTVAB_STATE__.PreferredQualityGroup.trim().toLowerCase() : "", explicitHeight = Number(preferredQualityGroup.match(/^(\d+)p/)?.[1]) || 0;
  if (explicitHeight > 0 && explicitHeight <= _getServedBackupBridgeHeight(info))
    return 0;
  const appliedAt = Math.max(0, Number(info._ForegroundQualityProbeAppliedAt) || 0), probationNeedsCompletion = !!(appliedAt === visibleSinceAt && _isBackupProbationDue(info));
  return appliedAt < visibleSinceAt || probationNeedsCompletion ? visibleSinceAt : 0;
}
function _startPendingBackupQualityProbe(info, realFetch, currentResolution = null, codecOverride = null) {
  return !_getPendingForegroundQualityProbeAt(info) && !_isBackupProbationDue(info) || info?._BackupSearchPromise || (Number(info?._BackupSearchPromises?.size) || 0) > 0 ? !1 : (_findBackupStream(info, realFetch, 0, currentResolution, codecOverride).catch(() => {
  }), !0);
}
function _recordSustainedNativeResolution(info, url) {
  if (!info || info.IsShowingAd || info.IsUsingBackupStream || info.IsUsingFallbackStream || info.IsHoldingBackupAfterAd)
    return;
  let resolution = null;
  for (const alias of _getPlaylistUrlAliases(url))
    if (resolution = info?.Urls?.[alias] || null, resolution)
      break;
  if (!resolution)
    return;
  const [, h] = String(resolution.Resolution || "0x0").split("x").map(Number), height = Number.isFinite(h) ? h : 0;
  if (height <= 0)
    return;
  const [, ph] = String(info.SustainedNativeResolution?.Resolution || "0x0").split("x").map(Number), prevHeight = Number.isFinite(ph) ? ph : 0, now = Date.now(), windowMs = 6e4;
  if (height < prevHeight) {
    const visibleSinceAt = Math.max(0, Number(__TTVAB_STATE__?.PagePlaybackVisibleSinceAt) || 0);
    if (!visibleSinceAt || now - visibleSinceAt < 1e4 || !(now - (Number(info.SustainedNativeResolutionAt) || 0) > windowMs))
      return;
    const lastAdEndedAt = Math.max(Number(info.LastAdEndReloadAt) || 0, Number(__TTVAB_STATE__?.LastAdEndedAt) || 0);
    if (lastAdEndedAt > 0 && now - lastAdEndedAt <= windowMs)
      return;
  }
  const prevResolution = info.SustainedNativeResolution?.Resolution || null;
  info.SustainedNativeResolution = resolution, info.SustainedNativeResolutionAt = now, resolution.Resolution && resolution.Resolution !== prevResolution && (info.SustainedNativeResolutionStartedAt = now);
}
function _isExactNativeRecoveryCandidateOwned(info, candidateUrl, candidateIsNative, requestStartMediaKey, requestStartCycleStartedAt) {
  const mediaKey = _normalizeMediaKey(info?.MediaKey), cycleStartedAt = Math.max(0, Number(info?.VisibleAdStartedAt) || 0), stage = info?.IsHoldingBackupAfterAd ? "hold" : info?.IsShowingAd ? "visible" : null, exactCandidateUrl = _getMediaPlaylistSessionKey(candidateUrl), preAdNativeText = typeof info?.LastCleanNativeM3U8 == "string" ? info.LastCleanNativeM3U8 : null, preAdNativePlaylistAt = Math.max(0, Number(info?.LastCleanNativePlaylistAt) || 0), preAdNativeLoaderEpoch = Math.max(0, Number(info?.LastCleanNativeLoaderEpoch) || 0), currentLoaderEpoch = Math.max(0, Number(info?.NativeRecoveryLoaderEpoch) || 0), ownsExactPreAdNativeUrl = !!(exactCandidateUrl && _getMediaPlaylistSessionKey(info?.LastCleanNativeUrl) === exactCandidateUrl && preAdNativeText && preAdNativePlaylistAt > 0 && preAdNativePlaylistAt <= cycleStartedAt && cycleStartedAt - preAdNativePlaylistAt <= 6e4 && preAdNativeLoaderEpoch === currentLoaderEpoch && _playlistHasMediaSegments(preAdNativeText) && !_hasPlaylistAdMarkers(preAdNativeText) && !_playlistHasKnownAdSegments(preAdNativeText, {
    includeCached: !1
  })), ownsExactAdSessionUrl = !!(exactCandidateUrl && info?.NativeRecoveryAdPlaylistUrls instanceof Set && info.NativeRecoveryAdPlaylistUrls.has(exactCandidateUrl) && _normalizeMediaKey(info.NativeRecoveryAdMediaKey) === mediaKey && Math.max(0, Number(info.NativeRecoveryAdStartedAt) || 0) === cycleStartedAt), ownsExactNativeUrl = !!(exactCandidateUrl && (info?.Urls && Object.hasOwn(info.Urls, exactCandidateUrl) || ownsExactPreAdNativeUrl || ownsExactAdSessionUrl)), isLive = info?.MediaType !== "vod" && !mediaKey?.startsWith("vod:");
  return !!(candidateIsNative === !0 && isLive && mediaKey && cycleStartedAt > 0 && _normalizeMediaKey(requestStartMediaKey) === mediaKey && Math.max(0, Number(requestStartCycleStartedAt) || 0) === cycleStartedAt && stage && ownsExactNativeUrl);
}
function _advanceExactNativeRecoveryCandidate(info, candidateText, candidateUrl, candidateIsNative, requestStartMediaKey, requestStartCycleStartedAt) {
  const mediaKey = _normalizeMediaKey(info?.MediaKey), cycleStartedAt = Math.max(0, Number(info?.VisibleAdStartedAt) || 0), stage = info?.IsHoldingBackupAfterAd ? "hold" : info?.IsShowingAd ? "visible" : null, exactCandidateUrl = _getMediaPlaylistSessionKey(candidateUrl), candidateHasAds = !!(typeof candidateText == "string" && (_hasPlaylistAdMarkers(candidateText) || _playlistHasKnownAdSegments(candidateText, {
    includeCached: !1
  })));
  if (!_isExactNativeRecoveryCandidateOwned(info, candidateUrl, candidateIsNative, requestStartMediaKey, requestStartCycleStartedAt))
    return _resetNativeRecoveryCandidateState(info), "ineligible";
  if (typeof candidateText != "string" || !_playlistHasMediaSegments(candidateText) || candidateHasAds)
    return _resetNativeRecoveryCandidateState(info), "pending";
  info.NativeRecoveryCandidateUrl === exactCandidateUrl && info.NativeRecoveryCandidateMediaKey === mediaKey && Math.max(0, Number(info.NativeRecoveryCandidateCycleStartedAt) || 0) === cycleStartedAt && info.NativeRecoveryCandidateStage === stage || (_resetNativeRecoveryCandidateState(info), info.NativeRecoveryCandidateUrl = exactCandidateUrl, info.NativeRecoveryCandidateMediaKey = mediaKey, info.NativeRecoveryCandidateCycleStartedAt = cycleStartedAt, info.NativeRecoveryCandidateStage = stage, info.NativeRecoveryCandidateStartedAt = Date.now());
  const mediaSequence = _parsePlaylistFirstMediaSequence(candidateText);
  if (mediaSequence == null)
    return _resetNativeRecoveryCandidateState(info), "pending";
  const previousMediaSequence = info.NativeRecoveryCandidateLastMediaSequence != null && Number.isFinite(Number(info.NativeRecoveryCandidateLastMediaSequence)) ? Number(info.NativeRecoveryCandidateLastMediaSequence) : null;
  if (previousMediaSequence == null)
    return info.NativeRecoveryCandidateLastMediaSequence = mediaSequence, "pending";
  if (mediaSequence < previousMediaSequence)
    return _resetNativeRecoveryCandidateState(info), info.NativeRecoveryCandidateUrl = exactCandidateUrl, info.NativeRecoveryCandidateMediaKey = mediaKey, info.NativeRecoveryCandidateCycleStartedAt = cycleStartedAt, info.NativeRecoveryCandidateStage = stage, info.NativeRecoveryCandidateStartedAt = Date.now(), info.NativeRecoveryCandidateLastMediaSequence = mediaSequence, "pending";
  if (mediaSequence === previousMediaSequence)
    return "pending";
  info.NativeRecoveryCandidateLastMediaSequence = mediaSequence, info.NativeRecoveryCandidateCleanCount = Math.max(0, Math.trunc(Number(info.NativeRecoveryCandidateCleanCount) || 0)) + 1;
  const maximumEscalation = 4, requiredCleanPlaylists = _getResolvedAdEndMinCleanPlaylists() + maximumEscalation, requiredCleanMs = _getResolvedAdEndGraceMs() + maximumEscalation * 2500;
  return info.NativeRecoveryCandidateCleanCount >= requiredCleanPlaylists && Date.now() - Math.max(0, Number(info.NativeRecoveryCandidateStartedAt) || Date.now()) >= requiredCleanMs ? "ready" : "pending";
}
function _isNativeRecoveryCodecHandoffReady(info, candidateUrl) {
  const handoffId = info?._CodecHandoffPendingId;
  if (!handoffId)
    return !0;
  const mediaKey = _normalizeMediaKey(info.MediaKey), cycleStartedAt = Math.max(0, Number(info.VisibleAdStartedAt) || 0);
  return !!(info.IsUsingModifiedM3U8 && handoffId === info._CodecHandoffAcknowledgedId && handoffId !== info._CodecHandoffFailedId && handoffId === __TTVAB_STATE__?.ActiveCodecHandoffId && mediaKey && mediaKey === _normalizeMediaKey(__TTVAB_STATE__?.ActiveCodecHandoffMediaKey) && cycleStartedAt > 0 && _getCodecHandoffCycleStartedAt(handoffId) === cycleStartedAt && _isCodecHandoffCycleCurrent(mediaKey, cycleStartedAt, info) && !info.EnhancedDecoderCodecFamily && !info.EnhancedDecoderCodec && _getVideoCodecFamily(info.Urls?.[_getMediaPlaylistSessionKey(candidateUrl)]?.Codecs) === "avc");
}
async function _isAdEndStable(info, realFetch, resolution = null, requestAdContext = null, requestSignal = null, candidateText = null, candidateUrl = null, candidateIsNative = !1) {
  if (requestAdContext && typeof requestAdContext == "object" && (requestAdContext.exactNativeRecoveryReady = !1, requestAdContext.exactNativeRecoveryOwned = !1, requestAdContext.verifiedNativeRecoveryTarget = null), !info?.IsShowingAd && !info?.IsHoldingBackupAfterAd)
    return "ended";
  const now = Date.now();
  info.PendingAdEndAt || (info.PendingAdEndAt = now, info.CleanPlaylistCount = 0, info.AdEndMarkerBounceLogged = !1), info.CleanPlaylistCount = Math.max(0, Math.trunc(Number(info.CleanPlaylistCount) || 0)) + 1;
  const elapsed = now - info.PendingAdEndAt, escalation = Math.min(4, Math.max(0, Math.trunc(Number(info.AdEndConfirmEscalation) || 0))), graceMs = _getResolvedAdEndGraceMs() + escalation * 2500, minCleanPlaylists = _getResolvedAdEndMinCleanPlaylists() + escalation, baseMaxWaitMs = _getResolvedAdEndMaxWaitMs(), maxWaitMs = baseMaxWaitMs > 0 ? baseMaxWaitMs + escalation * 2500 : baseMaxWaitMs, fastPathReady = info.CleanPlaylistCount >= minCleanPlaylists && elapsed >= graceMs, slowPathReady = maxWaitMs > 0 && elapsed >= maxWaitMs, expectedPodLength = Math.max(0, Math.trunc(Number(info.ExpectedAdPodLength) || 0)), observedPodAds = info.ObservedAdPodIds instanceof Set ? info.ObservedAdPodIds.size : 0, maxObservedPodPosition = Math.max(0, Math.trunc(Number(info.MaxObservedAdPodPosition) || 0)), observedTerminalPodPosition = expectedPodLength > 0 && (info.ObservedZeroAdPodPosition === !0 ? maxObservedPodPosition + 1 >= expectedPodLength : maxObservedPodPosition >= expectedPodLength), declaredPodIncomplete = expectedPodLength > 0 && observedPodAds < expectedPodLength && !observedTerminalPodPosition, declaredPodComplete = expectedPodLength > 0 && !declaredPodIncomplete, exactNativeRecoveryOwned = _isExactNativeRecoveryCandidateOwned(info, candidateUrl, candidateIsNative, requestAdContext?.requestStartMediaKey, requestAdContext?.requestStartCycleStartedAt);
  requestAdContext && typeof requestAdContext == "object" && (requestAdContext.exactNativeRecoveryOwned = exactNativeRecoveryOwned);
  let ownedNativeRecoveryTarget = null;
  if (info.IsHoldingBackupAfterAd && (info.IsUsingModifiedM3U8 || info.HevcReloadPendingAfterHold || !declaredPodComplete) && exactNativeRecoveryOwned && _isNativeRecoveryCodecHandoffReady(info, candidateUrl) && info.LastCleanBackupM3U8 && (info.LastCleanBackupPlayerType || info.ActiveBackupPlayerType) && typeof info.EncodingsM3U8 == "string" && info.EncodingsM3U8 && typeof info.UsherBaseUrl == "string" && info.UsherBaseUrl) {
    await _awaitM3U8RequestContext(_refreshNativeRecoveryMaster(info, realFetch, requestSignal), info, requestAdContext, requestSignal);
    const recoveryMaster = _getNativeRecoveryMaster(info), targetResolution = _getResolutionByQualityGroup(recoveryMaster.resolutionList, __TTVAB_STATE__?.PreferredQualityGroup) || (recoveryMaster === info._NativePlaybackMaster ? _getResolutionByQualityGroup(recoveryMaster.resolutionList, "chunked") : null) || info.SustainedNativeResolution || resolution, playlistUrl = _getExactPlaylistUrlKey(_getStreamUrl(recoveryMaster.master, targetResolution, recoveryMaster.masterUrl)), variant = recoveryMaster.resolutionList.find((entry) => entry.Url === playlistUrl);
    playlistUrl && variant && _getVideoCodecFamily(variant.Codecs) && (ownedNativeRecoveryTarget = {
      master: recoveryMaster.master,
      masterUrl: recoveryMaster.masterUrl,
      codec: variant.Codecs,
      resolution: variant.Resolution,
      playlistUrl,
      requestUrl: _getMediaPlaylistSessionKey(candidateUrl),
      handoffId: info._CodecHandoffPendingId || null
    });
  }
  const canUseExactNativeCandidate = !!((declaredPodComplete && !info.IsUsingModifiedM3U8 || ownedNativeRecoveryTarget && !declaredPodIncomplete) && (!info._CodecHandoffPendingId || ownedNativeRecoveryTarget) && info.LastCleanBackupM3U8 && (info.LastCleanBackupPlayerType || info.ActiveBackupPlayerType));
  let exactNativeCandidateState = null;
  if (canUseExactNativeCandidate) {
    if (exactNativeCandidateState = _advanceExactNativeRecoveryCandidate(info, candidateText, candidateUrl, candidateIsNative, requestAdContext?.requestStartMediaKey, requestAdContext?.requestStartCycleStartedAt), exactNativeCandidateState === "ready" && !ownedNativeRecoveryTarget)
      return requestAdContext && typeof requestAdContext == "object" && (requestAdContext.exactNativeRecoveryReady = !0), info.IsHoldingBackupAfterAd ? "ended" : "ended-with-backup-hold";
    if (exactNativeCandidateState === "pending")
      return "wait";
  } else
    _resetNativeRecoveryCandidateState(info);
  if (info?.MediaType !== "vod" && !_normalizeMediaKey(info?.MediaKey)?.startsWith("vod:") && (candidateIsNative === !0 || typeof candidateUrl == "string" && candidateUrl) && !exactNativeRecoveryOwned || !fastPathReady && !slowPathReady)
    return "wait";
  let incompletePodRecoveryReady = !1;
  if (declaredPodIncomplete) {
    const terminalEscapeMs = Math.max(9e4, _getResolvedAdEndBackupHoldMaxMs()), lastAdPodProgressAt = Math.max(0, Number(info.LastAdPodProgressAt) || 0, Number(info.VisibleAdStartedAt) || 0), exactCandidateUrl = _getMediaPlaylistSessionKey(candidateUrl);
    exactCandidateUrl && info._IncompletePodCandidateUrl === exactCandidateUrl || (info._IncompletePodCleanStartedAt = now, info._IncompletePodCleanPlaylistCount = 0, info._IncompletePodLastMediaSequence = null, info._IncompletePodCandidateUrl = exactCandidateUrl || null);
    const isVod = info.MediaType === "vod" || _normalizeMediaKey(info.MediaKey)?.startsWith("vod:");
    let cleanCandidateAdvanced = !1;
    if (typeof candidateText == "string" && exactCandidateUrl && isVod && candidateText.includes("#EXT-X-ENDLIST"))
      cleanCandidateAdvanced = !0;
    else if (typeof candidateText == "string" && exactCandidateUrl && !isVod) {
      const mediaSequence = _parsePlaylistFirstMediaSequence(candidateText), previousMediaSequence = typeof info._IncompletePodLastMediaSequence == "number" && Number.isFinite(info._IncompletePodLastMediaSequence) ? info._IncompletePodLastMediaSequence : null;
      previousMediaSequence !== null && mediaSequence !== null && mediaSequence > previousMediaSequence ? cleanCandidateAdvanced = !0 : previousMediaSequence !== null && mediaSequence !== null && mediaSequence < previousMediaSequence && (info._IncompletePodCleanStartedAt = now, info._IncompletePodCleanPlaylistCount = 0), info._IncompletePodLastMediaSequence = mediaSequence;
    }
    cleanCandidateAdvanced && (info._IncompletePodCleanStartedAt || (info._IncompletePodCleanStartedAt = now), info._IncompletePodCleanPlaylistCount = Math.max(0, Number(info._IncompletePodCleanPlaylistCount) || 0) + 1);
    const incompletePodEscalation = 4, incompletePodMinCleanPlaylists = _getResolvedAdEndMinCleanPlaylists() + incompletePodEscalation, incompletePodGraceMs = _getResolvedAdEndGraceMs() + incompletePodEscalation * 2500;
    incompletePodRecoveryReady = !!(lastAdPodProgressAt > 0 && now - lastAdPodProgressAt >= terminalEscapeMs && cleanCandidateAdvanced && Math.max(0, Number(info._IncompletePodCleanPlaylistCount) || 0) >= incompletePodMinCleanPlaylists && now - Math.max(0, Number(info._IncompletePodCleanStartedAt) || now) >= incompletePodGraceMs);
  }
  let hasNativeRecoveryReady = !1;
  if (declaredPodIncomplete && !incompletePodRecoveryReady) {
    info._LoggedWhitelistByType || (info._LoggedWhitelistByType = /* @__PURE__ */ new Set());
    const progressKey = `pod-incomplete:${observedPodAds}/${expectedPodLength}`;
    info._LoggedWhitelistByType.has(progressKey) || info._LoggedWhitelistByType.add(progressKey);
  } else
    hasNativeRecoveryReady = await _awaitM3U8RequestContext(_canReloadNativePlayerAfterAd(info, realFetch, resolution, declaredPodIncomplete, ownedNativeRecoveryTarget), info, requestAdContext, requestSignal), hasNativeRecoveryReady && ownedNativeRecoveryTarget && requestAdContext && (requestAdContext.verifiedNativeRecoveryTarget = ownedNativeRecoveryTarget);
  if (!info.IsShowingAd && !info.IsHoldingBackupAfterAd)
    return "wait";
  if (hasNativeRecoveryReady)
    return "ended";
  if (info.IsHoldingBackupAfterAd)
    return "wait";
  if (declaredPodIncomplete) {
    const incompletePodFailedProbeCapHit = Math.max(0, Number(info.ConsecutiveFailedNativeProbes) || 0) >= Math.max(1, Number(__TTVAB_STATE__?.AdEndMaxFailedNativeProbes) || 6), incompletePodVisibleAdStartedAt = Math.max(0, Number(info.VisibleAdStartedAt) || Number(info.PendingAdEndAt) || 0), incompletePodVisibleAdElapsed = incompletePodVisibleAdStartedAt > 0 ? now - incompletePodVisibleAdStartedAt : elapsed;
    return slowPathReady && info.LastCleanBackupM3U8 && (_getResolvedAdEndBackupHoldMaxMs() > 0 && incompletePodVisibleAdElapsed >= _getResolvedAdEndBackupHoldMaxMs() || incompletePodFailedProbeCapHit) ? "ended-with-backup-hold" : "wait";
  }
  const maxFailedProbes = Math.max(1, Number(__TTVAB_STATE__?.AdEndMaxFailedNativeProbes) || 6), failedProbeCapHit = Math.max(0, Number(info.ConsecutiveFailedNativeProbes) || 0) >= maxFailedProbes;
  if (slowPathReady) {
    if (info?.LastCleanBackupM3U8) {
      const backupHoldMaxMs = _getResolvedAdEndBackupHoldMaxMs(), visibleAdStartedAt = Math.max(0, Number(info.VisibleAdStartedAt) || Number(info.PendingAdEndAt) || 0), visibleAdElapsed = visibleAdStartedAt > 0 ? now - visibleAdStartedAt : elapsed;
      if (backupHoldMaxMs > 0 && visibleAdElapsed >= backupHoldMaxMs || failedProbeCapHit)
        return "ended-with-backup-hold";
      const lastHoldLogAt = Math.max(0, Number(info.LastNativeRecoveryHoldLogAt) || 0);
      if (now - lastHoldLogAt >= 1e4) {
        info.LastNativeRecoveryHoldLogAt = now;
        const recoveryProgressing = Math.max(0, Number(info.NativeRecoveryCleanCount) || 0) > 0;
      }
      return "wait";
    }
    return info.IsHoldingBackupAfterAd ? "wait" : "ended";
  }
  return "wait";
}
function _resetNativeRecoveryReadyState(info, preserveProbeAt = !1, preserveProbeSession = !1) {
  info && (info.NativeRecoveryProbeEpoch = (Number(info.NativeRecoveryProbeEpoch) || 0) + 1, info._NativeRecoveryProbeInFlight = !1, info._NativeRecoveryProbeToken = null, preserveProbeAt || (info.LastNativeRecoveryProbeAt = 0), info.LastNativeRecoveryReadyPlayerType = null, info.NativeRecoveryCleanCount = 0, preserveProbeSession || (info.NativeRecoveryProbeStreamUrl = null, info.NativeRecoveryProbeMediaKey = null, info.NativeRecoveryProbePlayerType = null, info.NativeRecoveryProbeCycleStartedAt = 0, info.NativeRecoveryProbeLastMediaSequence = null, info.NativeRecoveryProbeLastAdvancedAt = 0));
}
function _invalidateNativeRecoveryAfterPlayerReload(info, advanceLoaderEpoch = !1) {
  return info ? (info._PendingNativeReloadConfirmation = null, advanceLoaderEpoch && (info.NativeRecoveryLoaderEpoch = Math.max(0, Number(info.NativeRecoveryLoaderEpoch) || 0) + 1), _resetNativeRecoveryReadyState(info), _resetNativeRecoveryCandidateState(info), info.NativeRecoveryAdPlaylistUrls?.clear?.(), info.NativeRecoveryAdMediaKey = null, info.NativeRecoveryAdStartedAt = 0, info.PendingAdEndAt = 0, info.CleanPlaylistCount = 0, info.AdEndMarkerBounceLogged = !1, info.LastNativeRecoveryHoldLogAt = 0, info._IncompletePodCleanStartedAt = 0, info._IncompletePodCleanPlaylistCount = 0, info._IncompletePodLastMediaSequence = null, info._IncompletePodCandidateUrl = null, info.ConsecutiveFailedNativeProbes = 0, Math.max(0, Number(info.NativeRecoveryLoaderEpoch) || 0)) : 0;
}
function _markNativeRecoveryProbeFailed(info) {
  info.ConsecutiveFailedNativeProbes = Math.max(0, Number(info?.ConsecutiveFailedNativeProbes) || 0) + 1;
}
function _markNativeRecoveryReady(info, playerType) {
  const nextPlayerType = typeof playerType == "string" && playerType ? playerType : null;
  if (!info || !nextPlayerType)
    return _resetNativeRecoveryReadyState(info, !0), 0;
  if (info.LastNativeRecoveryReadyPlayerType !== nextPlayerType)
    return info.LastNativeRecoveryReadyPlayerType = nextPlayerType, info.NativeRecoveryCleanCount = 1, 1;
  const nextCount = Math.max(0, Math.trunc(Number(info.NativeRecoveryCleanCount) || 0)) + 1;
  return info.NativeRecoveryCleanCount = nextCount, nextCount;
}
async function _serveBounceDebouncedPlaylist(info, realFetch, text, now) {
  const lastAdEndBounceAt = Math.max(0, Number(info?.LastAdEndBounceAt) || 0), bounceDebounceMs = Math.max(3e3, Number(__TTVAB_STATE__?.AdEndBounceDebounceMs) || 0);
  if (lastAdEndBounceAt <= 0 || now - lastAdEndBounceAt >= bounceDebounceMs || (Number(__TTVAB_STATE__?.BackupSearchForceRefreshAt) || 0) > 0)
    return null;
  if (!info.LastCleanBackupM3U8)
    return _stripAds(text, !1, info, !0);
  const backupAgeMs = now - (Number(info.LastCleanBackupAt) || 0);
  if (backupAgeMs >= 0 && backupAgeMs < 900 && Number(info.LastCleanBackupAt) >= Math.max(0, Number(info.VisibleAdStartedAt) || 0))
    return info.IsUsingBackupStream = !0, info.LastCleanBackupM3U8;
  const backupSearchEpoch = Math.max(0, Number(info.BackupSearchEpoch) || 0), cycleStartedAt = Math.max(0, Number(info.VisibleAdStartedAt) || 0), refreshed = await _refreshActiveBackupMediaPlaylist(info, realFetch);
  return refreshed && _isBackupSearchContextCurrent(info, backupSearchEpoch, cycleStartedAt) ? (info.IsUsingBackupStream = !0, refreshed) : null;
}
function _shouldReloadNativePlayerAfterAdReset({ wasUsingModifiedM3U8, wasUsingFallbackStream, wasUsingBackupStream, hadStrippedAdSegments } = {}) {
  return !!(wasUsingModifiedM3U8 || wasUsingFallbackStream || wasUsingBackupStream || hadStrippedAdSegments);
}
function _getPlaylistUrlAliases(url, baseUrl = null) {
  const isAbsoluteUrl = typeof url == "string" && url.startsWith("http");
  if (isAbsoluteUrl) {
    const memo = globalThis._playlistAliasMemo;
    if (memo && memo.url === url)
      return memo.aliases;
  }
  const aliases = [], pushAlias = (value) => {
    if (typeof value != "string")
      return;
    const trimmed = value.trimEnd();
    !trimmed || aliases.indexOf(trimmed) !== -1 || aliases.push(trimmed);
  };
  pushAlias(url);
  try {
    const fallbackBase = typeof globalThis?.location?.href == "string" ? globalThis.location.href : null, parsed = new URL(String(url || ""), typeof baseUrl == "string" && baseUrl ? baseUrl : fallbackBase || void 0);
    parsed.hash = "", pushAlias(parsed.toString()), pushAlias(_getMediaPlaylistSessionKey(parsed.toString())), pushAlias(`${parsed.origin}${parsed.pathname}`), pushAlias(parsed.pathname);
  } catch {
  }
  return isAbsoluteUrl && (globalThis._playlistAliasMemo = { url, aliases }), aliases;
}
function _getStreamInfoForPlaylist(url) {
  if (typeof __TTVAB_STATE__ > "u" || !__TTVAB_STATE__)
    return null;
  for (const alias of _getPlaylistUrlAliases(url)) {
    const byUrl = __TTVAB_STATE__.StreamInfosByUrl[alias];
    if (byUrl)
      return byUrl;
  }
  const currentPageMediaKey = __TTVAB_STATE__?.PageMediaKey || null;
  try {
    const hostname = new URL(url).hostname;
    let hostnameMatch = null, hostnameMatchTime = -1;
    for (const key in __TTVAB_STATE__.StreamInfosByUrl)
      try {
        const info = __TTVAB_STATE__.StreamInfosByUrl[key];
        if (currentPageMediaKey && info?.MediaKey !== currentPageMediaKey || new URL(key).hostname !== hostname)
          continue;
        if (currentPageMediaKey)
          return info;
        const activityAt = Number(info?.LastActivityAt) || 0;
        activityAt > hostnameMatchTime && (hostnameMatchTime = activityAt, hostnameMatch = info);
      } catch {
      }
    if (hostnameMatch)
      return hostnameMatch;
  } catch {
  }
  const keys = Object.keys(__TTVAB_STATE__.StreamInfos);
  if (keys.length === 1) {
    const info = __TTVAB_STATE__.StreamInfos[keys[0]];
    if (!currentPageMediaKey || info?.MediaKey === currentPageMediaKey)
      return info;
  }
  if (keys.length > 1) {
    let best = null, bestTime = 0;
    for (const key of keys) {
      const info = __TTVAB_STATE__.StreamInfos[key];
      currentPageMediaKey && info?.MediaKey !== currentPageMediaKey || info?.LastActivityAt > bestTime && (bestTime = info.LastActivityAt, best = info);
    }
    return best;
  }
  return null;
}
function _getSyntheticPlaybackContextForPlaylist(url) {
  const urlContext = _getPlaybackContextFromUsherUrl(url);
  if (urlContext?.MediaKey)
    return urlContext;
  let parsedUrl = null;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }
  const hostname = parsedUrl.hostname.toLowerCase();
  if (!["twitch.tv", "ttvnw.net", "twitchcdn.net"].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`)) || !parsedUrl.pathname.toLowerCase().endsWith(".m3u8"))
    return null;
  const currentAdMediaKey = _normalizeMediaKey(__TTVAB_STATE__?.CurrentAdMediaKey), pageMediaKey = _normalizeMediaKey(__TTVAB_STATE__?.PageMediaKey), cycleStartedAt = Math.max(0, Number(currentAdMediaKey ? __TTVAB_STATE__?.AdPodProgressByMediaKey?.[currentAdMediaKey]?.cycleStartedAt : 0) || 0);
  return !currentAdMediaKey || currentAdMediaKey !== pageMediaKey || cycleStartedAt <= 0 ? null : {
    MediaType: __TTVAB_STATE__?.PageMediaType,
    ChannelName: __TTVAB_STATE__?.CurrentAdChannel || __TTVAB_STATE__?.PageChannel,
    VodID: __TTVAB_STATE__?.PageVodID,
    MediaKey: currentAdMediaKey
  };
}
function _hasPlaylistAdMarkers(text) {
  return _hasExplicitAdMetadata(text);
}
function _playlistHasMediaSegments(text) {
  if (typeof text != "string")
    return !1;
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "#EXTM3U")
    return !1;
  let hasPlayableMedia = !1, isGap = !1;
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index].trim();
    if (line) {
      if (line.startsWith("#EXT-X-STREAM-INF:"))
        return !1;
      if (line === "#EXT-X-GAP" && (isGap = !0), line.startsWith("#EXTINF:")) {
        const duration = Number(line.substring(8).split(",")[0]), uriIndex = _getMediaSegmentUriIndex(lines, index);
        if (!Number.isFinite(duration) || duration <= 0 || uriIndex < 0)
          return !1;
        for (let tagIndex = index + 1; tagIndex < uriIndex; tagIndex++)
          lines[tagIndex].trim() === "#EXT-X-GAP" && (isGap = !0);
        isGap || (hasPlayableMedia = !0), isGap = !1, index = uriIndex;
      } else if (_isMediaPartLine(line)) {
        const attrs = _parseAttrs(line), duration = Number(attrs.DURATION);
        if (!attrs.URI?.trim() || !Number.isFinite(duration) || duration <= 0)
          return !1;
        attrs.GAP !== "YES" && (hasPlayableMedia = !0);
      } else if (!line.startsWith("#"))
        return !1;
    }
  }
  return hasPlayableMedia;
}
function _parsePlaylistFirstMediaSequence(text) {
  if (typeof text != "string")
    return null;
  const m = text.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
  if (!m)
    return null;
  const seq = parseInt(m[1], 10);
  return Number.isNaN(seq) ? null : seq;
}
function _parsePlaylistDiscontinuitySequence(text) {
  if (typeof text != "string")
    return 0;
  const m = text.match(/#EXT-X-DISCONTINUITY-SEQUENCE:(\d+)/);
  if (!m)
    return 0;
  const seq = parseInt(m[1], 10);
  return Number.isNaN(seq) ? 0 : seq;
}
function _setPlaylistDiscontinuitySequence(lines, value) {
  for (let i = 0; i < lines.length; i++)
    if (lines[i].startsWith("#EXT-X-DISCONTINUITY-SEQUENCE:")) {
      lines[i] = `#EXT-X-DISCONTINUITY-SEQUENCE:${value}`;
      return;
    }
  let at = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
      at = i + 1;
      break;
    }
    lines[i].startsWith("#EXTM3U") && (at = i + 1);
  }
  lines.splice(at, 0, `#EXT-X-DISCONTINUITY-SEQUENCE:${value}`);
}
function _insertBoundaryDiscontinuity(text, boundarySeq, firstSeq, discontinuityOffset = 0) {
  if (typeof text != "string" || boundarySeq == null || firstSeq == null)
    return text;
  const pos = boundarySeq - firstSeq, lines = text.split(`
`), offset = Number.isFinite(Number(discontinuityOffset)) ? Math.trunc(Number(discontinuityOffset)) : 0;
  if (offset !== 0 && _setPlaylistDiscontinuitySequence(lines, Math.max(0, _parsePlaylistDiscontinuitySequence(text) + offset)), pos < 0)
    return _setPlaylistDiscontinuitySequence(lines, Math.max(0, _parsePlaylistDiscontinuitySequence(text) + offset + 1)), lines.join(`
`);
  let seen = 0, insertAt = -1;
  for (let i = 0; i < lines.length; i++)
    if (lines[i].startsWith("#EXTINF")) {
      if (seen === pos) {
        insertAt = i;
        break;
      }
      seen++;
    }
  return insertAt < 0 || insertAt > 0 && lines[insertAt - 1].trim() === "#EXT-X-DISCONTINUITY" || lines.splice(insertAt, 0, "#EXT-X-DISCONTINUITY"), lines.join(`
`);
}
function _observeServedPrefetchTimeline(info, url, text) {
  const previous = info?._LivePlaylistTimeline;
  if (info?.MediaType !== "live" || __TTVAB_STATE__?.IsAdStrippingEnabled !== !0 || !previous?.prefetchedSegments?.length || typeof text != "string" || text.includes("#EXT-X-STREAM-INF"))
    return;
  const sourceUrl = _getMediaPlaylistSessionKey(url), pending = new Set(previous.prefetchedSegments.filter((segment) => segment.sourceUrl === sourceUrl).map((segment) => segment.url));
  if (!pending.size)
    return;
  const lines = text.split(/\r?\n/);
  let time = Number.NaN, hasExplicitTime = !1, lastEndTime = previous.lastEndTime;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:") ? (time = Date.parse(line.slice(25)), hasExplicitTime = !0) : line === "#EXT-X-DISCONTINUITY" && !hasExplicitTime && (time = Number.NaN), !line.startsWith("#EXTINF:"))
      continue;
    const duration = Number.parseFloat(line.slice(8)) * 1e3, uriIndex = _getMediaSegmentUriIndex(lines, index);
    if (uriIndex < 0 || !Number.isFinite(duration) || duration <= 0)
      return;
    for (let tag = index + 1; tag < uriIndex; tag++)
      lines[tag].startsWith("#EXT-X-PROGRAM-DATE-TIME:") ? (time = Date.parse(lines[tag].slice(25)), hasExplicitTime = !0) : lines[tag] === "#EXT-X-DISCONTINUITY" && !hasExplicitTime && (time = Number.NaN);
    Number.isFinite(time) && pending.has(_getExactPlaylistUrlKey(lines[uriIndex], url)) && (lastEndTime = Math.max(lastEndTime, time + duration)), time += duration, hasExplicitTime = !1, index = uriIndex;
  }
  lastEndTime > previous.lastEndTime && (info._LivePlaylistTimeline = { ...previous, lastEndTime });
}
function _alignLivePlaylist(info, text, backupMetadata = null, commitTimeline = !0, url = "") {
  if (!info || info.MediaType === "vod" || __TTVAB_STATE__?.IsAdStrippingEnabled !== !0 || typeof text != "string" || text.includes("#EXT-X-STREAM-INF"))
    return text;
  const previous = info._LivePlaylistTimeline;
  if (text.includes("https://www.twitch.tv/__ttvab_empty_hold_segment.ts"))
    return commitTimeline && previous && !previous.afterHold && (info._LivePlaylistTimeline = { ...previous, afterHold: !0 }), text;
  const identity = backupMetadata ? JSON.stringify([
    "backup",
    backupMetadata.playerType,
    backupMetadata.resolution,
    backupMetadata.codec,
    backupMetadata.sessionUrl,
    backupMetadata.playlistUrl
  ]) : `native|${info.UsherBaseUrl || info.MediaKey}`, changedSource = previous?.identity !== identity || previous?.afterHold;
  let minimumTime = changedSource ? (backupMetadata || previous?.backup || previous?.afterHold) && previous?.lastEndTime || 0 : previous.minimumTime;
  const lines = text.split(/\r?\n/), entries = [];
  let nextTime = Number.NaN, hasExplicitTime = !1, blockStart = 0, range = null, previousRange = null, discontinuity = _parsePlaylistDiscontinuitySequence(text);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line === "#EXT-X-DISCONTINUITY" && (discontinuity++, hasExplicitTime || (nextTime = Number.NaN)), line.startsWith("#EXT-X-PROGRAM-DATE-TIME:") && (nextTime = Date.parse(line.slice(25)), hasExplicitTime = !0), !line.startsWith("#EXTINF:"))
      continue;
    const duration = Number.parseFloat(line.slice(8)) * 1e3, uriIndex = _getMediaSegmentUriIndex(lines, index);
    if (uriIndex < 0 || !Number.isFinite(duration) || duration <= 0)
      return text;
    range = null;
    for (let tag = blockStart; tag < uriIndex; tag++) {
      if (lines[tag].startsWith("#EXT-X-BYTERANGE:")) {
        const match = lines[tag].match(/^#EXT-X-BYTERANGE:(\d+)(?:@(\d+))?$/), length = Number(match?.[1]), offset = match?.[2] != null ? Number(match[2]) : previousRange?.uri === lines[uriIndex] ? previousRange.end : Number.NaN;
        range = {
          index: tag,
          length,
          offset,
          uri: lines[uriIndex],
          end: offset + length
        };
      }
      tag > index && lines[tag] === "#EXT-X-DISCONTINUITY" && (discontinuity++, hasExplicitTime || (nextTime = Number.NaN)), tag > index && lines[tag].startsWith("#EXT-X-PROGRAM-DATE-TIME:") && (nextTime = Date.parse(lines[tag].slice(25)), hasExplicitTime = !0);
    }
    entries.push({
      start: blockStart,
      uriIndex,
      time: nextTime,
      end: nextTime + duration,
      duration,
      discontinuity,
      range,
      derived: !1
    }), nextTime += duration, hasExplicitTime = !1, previousRange = range, blockStart = uriIndex + 1, index = uriIndex;
  }
  if (!entries.length)
    return text;
  for (let index = entries.length - 2; index >= 0; index--) {
    const entry = entries[index], next = entries[index + 1];
    !Number.isFinite(entry.time) && Number.isFinite(next.time) && entry.discontinuity === next.discontinuity && (entry.end = next.time, entry.time = next.time - entry.duration, entry.derived = !0);
  }
  if (entries.some((entry, index) => !Number.isFinite(entry.time) || index > 0 && entry.time < entries[index - 1].time)) {
    if (minimumTime && text.includes("#EXT-X-PROGRAM-DATE-TIME:"))
      throw new DOMException("Live handoff requires unambiguous broadcast timestamps", "AbortError");
    return text;
  }
  const nativeKey = !backupMetadata && _getMediaPlaylistSessionKey(url), nativeTimeline = nativeKey ? info._EmptyHoldTimelineByUrl?.get?.(nativeKey) : null, rawFirstSequence = _parsePlaylistFirstMediaSequence(text);
  if (nativeTimeline?.kind === "native" && Object.hasOwn(info.Urls || {}, nativeKey) && nativeTimeline.identity === JSON.stringify([
    "native",
    _getExactPlaylistUrlKey(info.UsherBaseUrl) || nativeKey
  ]) && rawFirstSequence != null && rawFirstSequence < nativeTimeline.lastRawFirstSequence) {
    const anchor = nativeTimeline.nativeAnchors?.find((entry) => entry.sequence === nativeTimeline.lastRawFirstSequence), lastAnchor = nativeTimeline.nativeAnchor;
    anchor && nativeTimeline.nativeAnchors.every((expected) => {
      const matching = entries[expected.sequence - rawFirstSequence];
      return matching?.time === expected.time && matching.duration === expected.duration && matching.discontinuity === expected.discontinuity;
    }) && lastAnchor && rawFirstSequence + entries.length - 1 > lastAnchor.sequence && entries.at(-1).end > lastAnchor.time + lastAnchor.duration && (minimumTime = Math.max(minimumTime, anchor.time));
  }
  let pendingTime = entries.at(-1).end, offeredEndTime = pendingTime, pendingHasExplicitTime = !1;
  for (const line of lines.slice(blockStart))
    if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:"))
      pendingTime = Date.parse(line.slice(25)), pendingHasExplicitTime = !0;
    else if (line === "#EXT-X-DISCONTINUITY")
      pendingHasExplicitTime || (pendingTime = Number.NaN);
    else if (line.startsWith("#EXT-X-PART:")) {
      const attributes = _parseAttrs(line), duration = Number(attributes.DURATION) * 1e3;
      attributes.URI && duration > 0 && Number.isFinite(pendingTime) && (pendingTime += duration, offeredEndTime = Math.max(offeredEndTime, pendingTime)), pendingHasExplicitTime = !1;
    } else line.startsWith("#EXT-X-TWITCH-PREFETCH:") && (pendingTime = Number.NaN, pendingHasExplicitTime = !1);
  if (text.includes("#EXT-X-SKIP:")) {
    if (minimumTime)
      throw new DOMException("Live handoff requires a full dated playlist", "AbortError");
    return text;
  }
  const handoffToleranceMs = 50, retainedIndex = entries.findIndex((entry) => entry.end > minimumTime && (entry.time >= minimumTime - handoffToleranceMs || minimumTime - entry.time < entry.end - minimumTime));
  if (retainedIndex < 0)
    throw new DOMException("Live handoff playlist is behind the served broadcast time", "AbortError");
  let output = text;
  if (retainedIndex > 0) {
    const retained = entries[retainedIndex], firstSequence = _parsePlaylistFirstMediaSequence(text) ?? 0, prefix = lines.slice(0, retained.start).filter((line) => line.startsWith("#") && !/^#EXT(?:INF:|-X-(?:PROGRAM-DATE-TIME:|BYTERANGE:|GAP(?:$|:)|DISCONTINUITY(?:$|:)|PART:|PRELOAD-HINT:|TWITCH-PREFETCH(?:-DISCONTINUITY)?[:]?))/.test(line)), tail = lines.slice(retained.start), priorDiscontinuities = tail.slice(0, retained.uriIndex - retained.start).filter((line) => line === "#EXT-X-DISCONTINUITY").length;
    _setPlaylistDiscontinuitySequence(prefix, retained.discontinuity - priorDiscontinuities);
    const sequenceIndex = prefix.findIndex((line) => line.startsWith("#EXT-X-MEDIA-SEQUENCE:")), sequenceLine = `#EXT-X-MEDIA-SEQUENCE:${firstSequence + retainedIndex}`;
    if (sequenceIndex < 0 ? prefix.splice(1, 0, sequenceLine) : prefix[sequenceIndex] = sequenceLine, retained.range) {
      if (!Number.isSafeInteger(retained.range.offset) || retained.range.offset < 0 || !Number.isSafeInteger(retained.range.length) || retained.range.length <= 0)
        throw new DOMException("Live handoff requires an explicit byte range", "AbortError");
      tail[retained.range.index - retained.start] = `#EXT-X-BYTERANGE:${retained.range.length}@${retained.range.offset}`;
    }
    tail.slice(0, retained.uriIndex - retained.start).some((line) => line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) || tail.splice(tail.findIndex((line) => line.startsWith("#EXTINF:")), 0, `#EXT-X-PROGRAM-DATE-TIME:${new Date(retained.time).toISOString()}`), output = [...prefix, ...tail].join(`
`);
  } else if (entries[0].derived) {
    const firstMediaIndex = lines.findIndex((line) => /^#EXT(?:INF:|-X-PART:)/.test(line));
    lines.splice(firstMediaIndex, 0, `#EXT-X-PROGRAM-DATE-TIME:${new Date(entries[0].time).toISOString()}`), output = lines.join(`
`);
  }
  return commitTimeline && (changedSource && minimumTime > 0, info._LivePlaylistTimeline = {
    identity,
    backup: !!backupMetadata,
    afterHold: !1,
    minimumTime,
    lastEndTime: entries.reduce((end, entry) => Math.max(end, entry.end), Math.max(previous?.lastEndTime || 0, offeredEndTime))
  }), output;
}
function _canRestoreNativeByPlaylist(info, url, text, requestContext) {
  const target = requestContext?.verifiedNativeRecoveryTarget, nativeUrl = _getMediaPlaylistSessionKey(url), native = info?.Urls?.[nativeUrl], codec = _getVideoCodecIdentity(native?.Codecs), metadata = info?.BackupPlaylistMetadata?.get?.(info.LastCleanBackupM3U8), backupAt = Number(info?.LastCleanBackupAt) || 0, backupAge = Date.now() - backupAt;
  if (requestContext?.exactNativeRecoveryOwned !== !0 || info?.MediaType !== "live" || info.IsUsingModifiedM3U8 || info.EnhancedDecoderCodecFamily || info.EnhancedDecoderCodec || info._CodecHandoffPendingId || info._LastServedPlaylistKind !== "backup" || !info._LivePlaylistTimeline?.backup || info._LivePlaylistTimeline.afterHold || !target || target.playlistUrl !== nativeUrl || !native?.Resolution || target.resolution !== native.Resolution || _getVideoCodecFamily(codec) !== "avc" || _getVideoCodecIdentity(target.codec) !== codec || !metadata?.playerType || metadata.playerType === "autoplay" || metadata.ambiguous === !0 || metadata.resolution !== native.Resolution || _getVideoCodecIdentity(metadata.codec) !== codec || !(Number(info.VisibleAdStartedAt) > 0) || backupAt < Number(info.VisibleAdStartedAt) || backupAge < 0 || backupAge > 5e3 || !text.includes("#EXT-X-PROGRAM-DATE-TIME:") || text.includes("#EXT-X-MAP:") || info.LastCleanBackupM3U8.includes("#EXT-X-MAP:") || info._LivePlaylistTimeline.identity !== JSON.stringify([
    "backup",
    metadata.playerType,
    metadata.resolution,
    metadata.codec,
    metadata.sessionUrl,
    metadata.playlistUrl
  ]))
    return !1;
  try {
    return _playlistHasMediaSegments(_alignLivePlaylist(info, text, null, !1));
  } catch {
    return !1;
  }
}
function _applyPlaylistContinuity(info, url, text, backupMetadata = null, requestContext = null) {
  _observeServedPrefetchTimeline(info, backupMetadata?.playlistUrl || url, text);
  const previous = info?._LivePlaylistTimeline;
  try {
    const aligned = _alignLivePlaylist(info, text, backupMetadata, !0, url), output = _applyEmptyHoldPlaylistContinuity(info, url, aligned, backupMetadata) ?? _applyBackupSpliceBridge(info, aligned, backupMetadata, url);
    info && info.MediaType !== "vod" && __TTVAB_STATE__?.IsAdStrippingEnabled === !0 && (info.IsShowingAd || info.IsHoldingBackupAfterAd) && backupMetadata?.playerType === "autoplay" && backupMetadata.ambiguous !== !0 && backupMetadata.playlistUrl && !info.HevcReloadPendingAfterHold && _playlistHasMediaSegments(output) && (info.HevcReloadPendingAfterHold = !0);
    const candidate = requestContext?.nativeSessionToConsume, pending = info?._PendingPostAdNativeMaster;
    if (pending && candidate?.session === pending && candidate.playlist === text && !backupMetadata && !pending.consumed) {
      const selected = info.Urls?.[_getMediaPlaylistSessionKey(url)];
      selected && (pending.codec = _getVideoCodecIdentity(selected.Codecs), pending.resolution = selected.Resolution), pending.consumed = !0, _reportPostAdNativeSession(info, "consumed");
    }
    const confirmation = info?._PendingNativeReloadConfirmation;
    if (confirmation) {
      if (!(Date.now() >= confirmation.reloadAt && Date.now() - confirmation.reloadAt < 3e4 && confirmation.mediaKey === info.MediaKey && confirmation.pageMediaKey === __TTVAB_STATE__.PageMediaKey && confirmation.pageGeneration === (Number(__TTVAB_STATE__.PagePlaybackContextGeneration) || 0) && confirmation.loaderEpoch === Math.max(0, Number(info.NativeRecoveryLoaderEpoch) || 0) && _isPageLifecycleCycleCurrent(info.MediaKey, confirmation.cycleStartedAt)))
        info._PendingNativeReloadConfirmation = null;
      else if (!confirmation.confirmed && requestContext?.nativeReloadToConfirm?.confirmation === confirmation && requestContext.nativeReloadToConfirm.playlist === text && !backupMetadata && _playlistHasMediaSegments(output) && typeof self < "u" && self.postMessage)
        try {
          _postWorkerBridgeMessage(self, _createPageScopedWorkerEvent({
            key: "PostAdNativeReloadReady",
            channel: info.ChannelName,
            mediaKey: info.MediaKey,
            cycleStartedAt: confirmation.cycleStartedAt,
            reloadAt: confirmation.reloadAt,
            confirmedAt: Date.now(),
            loaderEpoch: confirmation.loaderEpoch
          })), confirmation.confirmed = !0;
        } catch {
        }
    }
    info && __TTVAB_STATE__?.IsAdStrippingEnabled === !0 && (info._LastServedPlaylistKind = output.includes("https://www.twitch.tv/__ttvab_empty_hold_segment.ts") ? "hold" : backupMetadata ? "backup" : "native"), info && info._LastServedPlaylistKind !== "hold" && (info._EmptyAdHoldWindow = null), info?.MediaType === "live" && info.IsHoldingBackupAfterAd && __TTVAB_STATE__?.IsAdStrippingEnabled === !0 && __TTVAB_STATE__.CurrentAdMediaKey === info.MediaKey && Number(info.VisibleAdStartedAt) > 0 && backupMetadata?.playerType && backupMetadata.playlistUrl && backupMetadata.ambiguous !== !0 && info._LastServedPlaylistKind === "backup" && _playlistHasMediaSegments(output) && (__TTVAB_STATE__.PinnedBackupPlayerType !== backupMetadata.playerType || __TTVAB_STATE__.PinnedBackupPlayerMediaKey !== info.MediaKey) && (__TTVAB_STATE__.PinnedBackupPlayerType = backupMetadata.playerType, __TTVAB_STATE__.PinnedBackupPlayerChannel = info.ChannelName || null, __TTVAB_STATE__.PinnedBackupPlayerMediaKey = info.MediaKey, typeof self < "u" && self.postMessage && _postWorkerBridgeMessage(self, _createPageScopedWorkerEvent({
      key: "BackupPlayerTypeSelected",
      value: backupMetadata.playerType,
      channel: info.ChannelName,
      mediaKey: info.MediaKey,
      cycleStartedAt: Number(info.VisibleAdStartedAt)
    })));
    const timeline = info?._LivePlaylistTimeline;
    if (timeline && timeline !== previous && !timeline.afterHold && info.MediaType === "live") {
      const sourceUrl = _getMediaPlaylistSessionKey(backupMetadata?.playlistUrl || url), prefetched = new Map((timeline.identity === previous?.identity ? previous.prefetchedSegments || [] : []).map((segment) => [
        JSON.stringify([segment.sourceUrl, segment.url]),
        segment
      ]));
      for (const line of output.split(/\r?\n/)) {
        if (!line.startsWith("#EXT-X-TWITCH-PREFETCH:"))
          continue;
        const segmentUrl = _getExactPlaylistUrlKey(line.slice(23), sourceUrl);
        if (segmentUrl) {
          const key = JSON.stringify([sourceUrl, segmentUrl]);
          prefetched.delete(key), prefetched.set(key, { sourceUrl, url: segmentUrl });
        }
      }
      timeline.prefetchedSegments = [...prefetched.values()].slice(-32);
    }
    return output;
  } catch (error) {
    throw info && (info._LivePlaylistTimeline = previous), error;
  }
}
function _applyBackupSpliceBridge(info, text, backupMetadata = null, url = "") {
  if (!info || typeof text != "string" || !text)
    return text;
  const getDiscontinuityRange = (playlist) => {
    let current = _parsePlaylistDiscontinuitySequence(playlist), sequence = _parsePlaylistFirstMediaSequence(playlist) ?? 0, first = null, last = null, lastSequence = null;
    for (const line of playlist.split(/\r?\n/)) {
      const trimmed = line.trim();
      trimmed === "#EXT-X-DISCONTINUITY" ? current++ : trimmed.startsWith("#EXT-X-SKIP:") ? sequence += Number(_parseAttrs(trimmed)["SKIPPED-SEGMENTS"]) || 0 : (trimmed.startsWith("#EXTINF:") || trimmed.startsWith("#EXT-X-TWITCH-PREFETCH:") || trimmed.startsWith("#EXT-X-PART:") || _isPartPreloadHintLine(trimmed)) && (first ??= current, last = current, lastSequence = sequence, (trimmed.startsWith("#EXTINF:") || trimmed.startsWith("#EXT-X-TWITCH-PREFETCH:")) && sequence++);
    }
    return { first, last, lastSequence };
  };
  if (text.includes("https://www.twitch.tv/__ttvab_empty_hold_segment.ts"))
    return info._SpliceStreamId = "empty-hold", info._SpliceBoundarySeq = null, info._SpliceDiscontinuityOffset = 0, info._SpliceLastDiscontinuitySequence = _parsePlaylistDiscontinuitySequence(text) + 1, info._NativeSpliceBoundaries?.clear?.(), text;
  const servingBackup = !!info.IsUsingBackupStream, preserveNativeSplice = info.MediaType === "live" && __TTVAB_STATE__?.IsAdStrippingEnabled === !0 && info._SpliceStreamId && Number.isFinite(info._SpliceLastDiscontinuitySequence);
  if (!servingBackup && !preserveNativeSplice) {
    info._SpliceStreamId = null, info._SpliceBoundarySeq = null, info._SpliceDiscontinuityOffset = 0;
    const native = getDiscontinuityRange(text), retainNative = info.MediaType === "live" && __TTVAB_STATE__?.IsAdStrippingEnabled === !0;
    return info._SpliceLastDiscontinuitySequence = retainNative ? Math.max(info._SpliceLastDiscontinuitySequence ?? 0, native.last ?? 0) : null, info._SpliceLastMediaSequence = retainNative ? Math.max(info._SpliceLastMediaSequence ?? 0, native.lastSequence ?? 0) : null, info._NativeSpliceBoundaries?.clear?.(), text;
  }
  if (!_playlistHasMediaSegments(text))
    return text;
  const metadata = backupMetadata || info.BackupPlaylistMetadata?.get?.(text), backupCodec = _getVideoCodecIdentity(metadata?.codec || info.LastCleanBackupCodec) || _getVideoCodecFamily(metadata?.codecFamily || info.LastCleanBackupCodecFamily) || "?", sessionIdentity = metadata?.playlistUrl ? `|${metadata.sessionUrl || ""}|${metadata.playlistUrl}` : "", identity = servingBackup ? `${metadata?.playerType || info.ActiveBackupPlayerType || "?"}|${metadata?.resolution || info.ActiveBackupResolution || "?"}|${backupCodec}${sessionIdentity}` : `native|${info.UsherBaseUrl || info.MediaKey}`, firstSeq = _parsePlaylistFirstMediaSequence(text);
  if (firstSeq == null)
    return text;
  if (info._SpliceStreamId !== identity) {
    const previousLast = info._SpliceLastDiscontinuitySequence;
    if (info._SpliceStreamId = identity, info._SpliceBoundarySeq = firstSeq, info._SpliceDiscontinuityOffset = 0, info._NativeSpliceBoundaries?.clear?.(), Number.isFinite(previousLast)) {
      const candidate = _insertBoundaryDiscontinuity(text, firstSeq, firstSeq), candidateFirst = getDiscontinuityRange(candidate).first;
      Number.isFinite(candidateFirst) && (info._SpliceDiscontinuityOffset = previousLast + 1 - candidateFirst);
    }
  }
  let boundarySequence = info._SpliceBoundarySeq;
  if (!servingBackup && url) {
    const key = _getMediaPlaylistSessionKey(url);
    for (info._NativeSpliceBoundaries instanceof Map || (info._NativeSpliceBoundaries = /* @__PURE__ */ new Map()), info._NativeSpliceBoundaries.has(key) || info._NativeSpliceBoundaries.set(key, firstSeq), boundarySequence = info._NativeSpliceBoundaries.get(key); info._NativeSpliceBoundaries.size > 32; )
      info._NativeSpliceBoundaries.delete(info._NativeSpliceBoundaries.keys().next().value);
  }
  const output = _insertBoundaryDiscontinuity(text, boundarySequence, firstSeq, info._SpliceDiscontinuityOffset), outputRange = getDiscontinuityRange(output), outputLast = outputRange.last;
  return Number.isFinite(outputLast) && (info._SpliceLastDiscontinuitySequence = Math.max(info._SpliceLastDiscontinuitySequence ?? 0, outputLast)), Number.isFinite(outputRange.lastSequence) && (info._SpliceLastMediaSequence = Math.max(info._SpliceLastMediaSequence ?? 0, outputRange.lastSequence)), output;
}
function _getMediaPlaylistSessionKey(url) {
  const exactUrl = _getExactPlaylistUrlKey(url);
  if (!/[?&]_HLS_(?:msn|part|skip)(?:=|&|$)/.test(exactUrl))
    return exactUrl;
  try {
    const parsed = new URL(exactUrl);
    return parsed.search = parsed.search.slice(1).split("&").filter((parameter) => !/^_HLS_(?:msn|part|skip)(?:=|$)/.test(parameter)).join("&"), parsed.href;
  } catch {
    return exactUrl;
  }
}
function _getEmptyHoldUpstreamUrl(info, url) {
  if (__TTVAB_STATE__?.IsAdStrippingEnabled !== !0 || !info?._EmptyHoldTimelineByUrl?.size)
    return url;
  const timeline = info._EmptyHoldTimelineByUrl.get(_getMediaPlaylistSessionKey(url));
  if (!timeline)
    return url;
  try {
    const parsed = new URL(url), requestedSequence = parsed.searchParams.get("_HLS_msn"), nativeSequence = Number(requestedSequence) - timeline.mediaOffset, canTranslate = timeline.kind === "native" && /^\d+$/.test(requestedSequence || "") && Number.isSafeInteger(nativeSequence) && nativeSequence >= 0;
    return parsed.search = parsed.search.slice(1).split("&").flatMap((parameter) => /^_HLS_skip(?:=|$)/.test(parameter) ? [] : /^_HLS_msn(?:=|$)/.test(parameter) ? canTranslate ? [`_HLS_msn=${nativeSequence}`] : [] : /^_HLS_part(?:=|$)/.test(parameter) && !canTranslate ? [] : [parameter]).join("&"), parsed.href;
  } catch {
    return url;
  }
}
function _applyEmptyHoldPlaylistContinuity(info, url, text, backupMetadata = null) {
  if (!info || typeof text != "string" || __TTVAB_STATE__?.IsAdStrippingEnabled !== !0)
    return null;
  const isHold = text.includes("https://www.twitch.tv/__ttvab_empty_hold_segment.ts");
  if (!isHold && !info._EmptyHoldTimelineByUrl?.size && !(info.MediaType === "live" && backupMetadata?.playlistUrl && backupMetadata.ambiguous !== !0))
    return null;
  const key = _getMediaPlaylistSessionKey(url);
  if (!key || text.includes("#EXT-X-STREAM-INF"))
    return null;
  const previous = info._EmptyHoldTimelineByUrl?.get?.(key) || null, isOwnedNativeVariant = !!(info.Urls && Object.hasOwn(info.Urls, key));
  if (!isHold && !previous && !isOwnedNativeVariant)
    return null;
  if (/#EXT-X-SKIP:/.test(text))
    throw new DOMException("Empty hold recovery requires a full playlist", "AbortError");
  const firstSequence = _parsePlaylistFirstMediaSequence(text) ?? 0, lines = text.split(/\r?\n/);
  let sequence = firstSequence, firstDiscontinuity = null, lastSequence = null, discontinuity = _parsePlaylistDiscontinuitySequence(text);
  const baseDiscontinuity = discontinuity, nativeAnchors = [];
  let segmentTime = Number.NaN, segmentDuration = 0, segmentSequence = null, hasExplicitTime = !1;
  for (const line of lines)
    line === "#EXT-X-DISCONTINUITY" && (discontinuity++, hasExplicitTime || (segmentTime = Number.NaN)), line.startsWith("#EXT-X-PROGRAM-DATE-TIME:") && (segmentTime = Date.parse(line.slice(25)), hasExplicitTime = !0), line.startsWith("#EXTINF:") ? (segmentDuration = Number.parseFloat(line.slice(8)) * 1e3, segmentSequence = sequence) : line && !line.startsWith("#") && segmentSequence !== null && (Number.isFinite(segmentTime) && segmentDuration > 0 && nativeAnchors.push({
      time: segmentTime,
      duration: segmentDuration,
      sequence: segmentSequence,
      discontinuity
    }), segmentTime += segmentDuration, segmentSequence = null, hasExplicitTime = !1), (line.startsWith("#EXTINF:") || line.startsWith("#EXT-X-TWITCH-PREFETCH:") || line.startsWith("#EXT-X-PART:") || line.startsWith("#EXT-X-PRELOAD-HINT:") && _parseAttrs(line).TYPE === "PART") && (firstDiscontinuity ??= discontinuity, lastSequence = sequence), (line.startsWith("#EXTINF:") || line.startsWith("#EXT-X-TWITCH-PREFETCH:")) && sequence++;
  if (lastSequence == null)
    return null;
  const metadata = backupMetadata || info.BackupPlaylistMetadata?.get?.(text);
  if (!isHold && (metadata && (metadata.ambiguous || !metadata.playlistUrl) || !metadata && info.IsUsingBackupStream && text === info.LastCleanBackupM3U8))
    throw new DOMException("Empty hold recovery requires exact backup ownership", "AbortError");
  const kind = isHold ? "hold" : metadata ? "backup" : "native", identity = JSON.stringify(isHold ? [kind, info.VisibleAdStartedAt || info._PageFallbackCycleStartedAt || 0] : metadata ? [
    kind,
    metadata.playerType,
    metadata.resolution,
    metadata.codec,
    metadata.sessionUrl,
    metadata.playlistUrl
  ] : [
    kind,
    isOwnedNativeVariant && _getExactPlaylistUrlKey(info.UsherBaseUrl) || key
  ]);
  let changedSource = previous?.identity !== identity, sharedTimeline = null, lastGeneration = 0;
  const firstMappedSource = !info._EmptyHoldTimelineByUrl?.size;
  let lastDiscontinuity = firstMappedSource && Number.isFinite(info._SpliceLastDiscontinuitySequence) ? info._SpliceLastDiscontinuitySequence : -1, lastPresentedSequence = firstMappedSource && Number.isFinite(info._SpliceLastMediaSequence) ? info._SpliceLastMediaSequence : -1;
  if (changedSource || kind === "backup" || isHold || isOwnedNativeVariant) {
    for (const candidate of info._EmptyHoldTimelineByUrl?.values?.() || [])
      lastGeneration = Math.max(lastGeneration, candidate.generation || 0), lastDiscontinuity = Math.max(lastDiscontinuity, candidate.lastDiscontinuity), lastPresentedSequence = Math.max(lastPresentedSequence, candidate.lastSequence), candidate.identity === identity && (!sharedTimeline || (candidate.generation || 0) > (sharedTimeline.generation || 0) || (candidate.generation || 0) === (sharedTimeline.generation || 0) && ((isHold ? candidate.lastDiscontinuity > sharedTimeline.lastDiscontinuity : candidate.discontinuityOffset > sharedTimeline.discontinuityOffset) || (isHold ? candidate.lastDiscontinuity === sharedTimeline.lastDiscontinuity : candidate.discontinuityOffset === sharedTimeline.discontinuityOffset) && (kind === "native" && candidate.nativeAnchor && sharedTimeline.nativeAnchor ? candidate.nativeAnchor.time > sharedTimeline.nativeAnchor.time : candidate.lastRawFirstSequence > sharedTimeline.lastRawFirstSequence))) && (sharedTimeline = candidate);
    kind === "native" && nativeAnchors.length > 0 && sharedTimeline && (sharedTimeline.generation || 0) < lastGeneration && (sharedTimeline = null, changedSource = !0);
  }
  let matchingNativeAnchor = null, sharedNativeAnchor = kind === "native" && info.MediaType === "live" && isOwnedNativeVariant ? (sharedTimeline?.nativeAnchors || [sharedTimeline?.nativeAnchor]).find((shared) => shared ? (matchingNativeAnchor = nativeAnchors.find((anchor) => anchor.time === shared.time && anchor.duration === shared.duration && anchor.discontinuity === shared.discontinuity), !!matchingNativeAnchor) : !1) : null;
  const overlapsPreviousNativeWindow = previous?.identity === identity && nativeAnchors.some((anchor) => previous.nativeAnchors?.some((expected) => anchor.sequence === expected.sequence && anchor.time === expected.time && anchor.duration === expected.duration && anchor.discontinuity === expected.discontinuity));
  previous && sharedTimeline && (kind === "native" && nativeAnchors.length > 0 ? (sharedTimeline.generation || 0) > (previous.generation || 0) || sharedNativeAnchor && !overlapsPreviousNativeWindow && sharedTimeline.discontinuityOffset > previous.discontinuityOffset : kind !== "native" && sharedTimeline.discontinuityOffset > previous.discontinuityOffset) && (changedSource = !0), changedSource && previous && sharedTimeline && firstDiscontinuity + sharedTimeline.discontinuityOffset <= previous.lastDiscontinuity && (sharedTimeline = null, sharedNativeAnchor = null), isHold && (!sharedTimeline || sharedTimeline.lastDiscontinuity < lastDiscontinuity) && (sharedTimeline = null, changedSource = !0);
  const sharedSource = kind === "backup" || isHold ? sharedTimeline : changedSource && sharedNativeAnchor ? {
    ...sharedTimeline,
    mediaOffset: sharedTimeline.mediaOffset + sharedNativeAnchor.sequence - matchingNativeAnchor.sequence,
    boundarySequence: sharedTimeline.boundarySequence - sharedNativeAnchor.sequence + matchingNativeAnchor.sequence,
    lastRawFirstSequence: firstSequence
  } : null, addBoundary = sharedSource?.addBoundary ?? (changedSource ? !isHold && firstDiscontinuity === baseDiscontinuity : previous.addBoundary), timeline = sharedSource ? { ...sharedSource } : changedSource ? {
    kind,
    identity,
    generation: sharedTimeline?.generation ?? lastGeneration + 1,
    boundarySequence: firstSequence,
    addBoundary,
    mediaOffset: lastPresentedSequence >= 0 ? lastPresentedSequence + 1 - firstSequence : 0,
    discontinuityOffset: isHold || kind === "native" && nativeAnchors.length > 0 ? Math.max(0, lastDiscontinuity + 1 - firstDiscontinuity) : sharedTimeline?.discontinuityOffset ?? Math.max(0, lastDiscontinuity) + 1,
    lastSequence: 0,
    lastDiscontinuity: 0,
    lastRawFirstSequence: firstSequence
  } : {
    ...previous,
    discontinuityOffset: kind === "native" && nativeAnchors.length > 0 ? previous.discontinuityOffset : sharedTimeline?.discontinuityOffset ?? previous.discontinuityOffset
  };
  if (firstSequence < timeline.lastRawFirstSequence || !Number.isSafeInteger(lastSequence + timeline.mediaOffset))
    throw new DOMException("Retired empty hold recovery playlist", "AbortError");
  const boundaryScrolledOut = timeline.addBoundary && firstSequence > timeline.boundarySequence;
  _setPlaylistDiscontinuitySequence(lines, baseDiscontinuity + timeline.discontinuityOffset + Number(boundaryScrolledOut) - Number(timeline.addBoundary));
  const mediaSequenceLine = `#EXT-X-MEDIA-SEQUENCE:${firstSequence + timeline.mediaOffset}`, mediaSequenceIndex = lines.findIndex((line) => line.startsWith("#EXT-X-MEDIA-SEQUENCE:"));
  if (mediaSequenceIndex < 0 ? lines.splice(1, 0, mediaSequenceLine) : lines[mediaSequenceIndex] = mediaSequenceLine, timeline.addBoundary && !boundaryScrolledOut) {
    const boundaryIndex = lines.findIndex((line) => /^#EXT(?:INF:|-X-(?:MAP|KEY|PART|PRELOAD-HINT|PROGRAM-DATE-TIME|TWITCH-PREFETCH):)/.test(line));
    boundaryIndex >= 0 && lines.splice(boundaryIndex, 0, "#EXT-X-DISCONTINUITY");
  }
  const output = [];
  let implicitKey = null, keySequence = null, addedIv = !1;
  sequence = firstSequence;
  for (const line of lines) {
    if (line.startsWith("#EXT-X-KEY:")) {
      const attributes = _parseAttrs(line);
      (!attributes.KEYFORMAT || attributes.KEYFORMAT === "identity" || attributes.METHOD === "NONE") && (implicitKey = attributes.METHOD !== "NONE" && !attributes.IV ? line : null, keySequence = null);
    }
    timeline.mediaOffset && implicitKey && keySequence !== sequence && (line.startsWith("#EXTINF:") || line.startsWith("#EXT-X-TWITCH-PREFETCH:") || line.startsWith("#EXT-X-PART:") || line.startsWith("#EXT-X-PRELOAD-HINT:") && _parseAttrs(line).TYPE === "PART") && (output.push(`${implicitKey},IV=0x${sequence.toString(16).padStart(32, "0")}`), keySequence = sequence, addedIv = !0);
    let outputLine = line;
    if (kind === "native" && line.startsWith("#EXT-X-RENDITION-REPORT:")) {
      const attributes = _parseAttrs(line);
      try {
        const reportKey = _getMediaPlaylistSessionKey(new URL(attributes.URI, key).href), reportTimeline = info._EmptyHoldTimelineByUrl?.get?.(reportKey), reportedSequence = Number(attributes["LAST-MSN"]);
        reportTimeline?.kind === "native" && Number.isSafeInteger(reportedSequence) && reportedSequence >= 0 && (outputLine = line.replace(/([:,])LAST-MSN=\d+/, `$1LAST-MSN=${reportedSequence + reportTimeline.mediaOffset}`));
      } catch {
      }
    }
    output.push(outputLine), (line.startsWith("#EXTINF:") || line.startsWith("#EXT-X-TWITCH-PREFETCH:")) && sequence++;
  }
  if (addedIv) {
    const versionIndex = output.findIndex((line) => line.startsWith("#EXT-X-VERSION:"));
    versionIndex < 0 ? output.splice(1, 0, "#EXT-X-VERSION:2") : Number(output[versionIndex].split(":")[1]) < 2 && (output[versionIndex] = "#EXT-X-VERSION:2");
  }
  for (timeline.lastRawFirstSequence = firstSequence, timeline.nativeAnchor = kind === "native" && nativeAnchors.at(-1) || null, timeline.nativeAnchors = kind === "native" ? nativeAnchors.slice(-32) : null, changedSource && kind === "native" && info.MediaType === "live" && !sharedSource && nativeAnchors.length > 0 && info._LivePlaylistTimeline?.backup === !1 && (info._LivePlaylistTimeline = {
    ...info._LivePlaylistTimeline,
    minimumTime: Math.max(info._LivePlaylistTimeline.minimumTime || 0, nativeAnchors[0].time)
  }), timeline.lastSequence = Math.max(timeline.lastSequence, lastSequence + timeline.mediaOffset), timeline.lastDiscontinuity = Math.max(timeline.lastDiscontinuity, discontinuity + timeline.discontinuityOffset), info._EmptyHoldTimelineByUrl instanceof Map || (info._EmptyHoldTimelineByUrl = /* @__PURE__ */ new Map()), info._EmptyHoldTimelineByUrl.set(key, timeline); info._EmptyHoldTimelineByUrl.size > 32; )
    info._EmptyHoldTimelineByUrl.delete(info._EmptyHoldTimelineByUrl.keys().next().value);
  return output.join(`
`);
}
function _getNativeRecoveryProbePlayerType() {
  return (__TTVAB_STATE__?.RewriteNativePlaybackAccessToken === !0 && typeof __TTVAB_STATE__?.ForceAccessTokenPlayerType == "string" && __TTVAB_STATE__.ForceAccessTokenPlayerType.trim() ? __TTVAB_STATE__.ForceAccessTokenPlayerType.trim() : null) || __TTVAB_STATE__?.LastNativePlaybackAccessTokenPlayerType || "site";
}
async function _fetchWithTimeout(realFetch, url, options = {}, timeoutMs = 3500) {
  const controller = new AbortController(), externalSignal = options?.signal || null, abortFromExternalSignal = () => controller.abort();
  externalSignal?.aborted ? abortFromExternalSignal() : externalSignal?.addEventListener?.("abort", abortFromExternalSignal, {
    once: !0
  });
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await realFetch(url, {
      ...options,
      signal: controller.signal
    }), body = await response.arrayBuffer(), nullBodyStatus = response.status === 101 || response.status === 204 || response.status === 205 || response.status === 304, bufferedResponse = new Response(nullBodyStatus ? null : body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
    return Object.defineProperties(bufferedResponse, {
      url: { value: response.url },
      redirected: { value: response.redirected }
    }), bufferedResponse;
  } finally {
    clearTimeout(id), externalSignal?.removeEventListener?.("abort", abortFromExternalSignal);
  }
}
async function _awaitBackupProbeBeforeDeadline(promise, deadlineAt = 0) {
  const deadline = Math.max(0, Number(deadlineAt) || 0);
  if (deadline <= 0)
    return { completed: !0, value: await promise };
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0)
    return Promise.resolve(promise).catch(() => {
    }), { completed: !1, value: null };
  let timeoutId = null;
  try {
    return await Promise.race([
      Promise.resolve(promise).then((value) => ({
        completed: !0,
        value
      })),
      new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve({ completed: !1, value: null }), remainingMs);
      })
    ]);
  } finally {
    timeoutId !== null && clearTimeout(timeoutId);
  }
}
function _waitForAbortableDelay(delayMs, requestSignal = null) {
  const safeDelayMs = Math.max(0, Number(delayMs) || 0);
  return requestSignal?.aborted ? Promise.reject(_createCodecHandoffAbortError(requestSignal)) : new Promise((resolve, reject) => {
    let settled = !1;
    const finish = (callback, value) => {
      settled || (settled = !0, clearTimeout(timeoutId), requestSignal?.removeEventListener?.("abort", onAbort), callback(value));
    }, onAbort = () => finish(reject, _createCodecHandoffAbortError(requestSignal)), timeoutId = setTimeout(() => finish(resolve, void 0), safeDelayMs);
    requestSignal?.addEventListener?.("abort", onAbort, { once: !0 });
  });
}
function _awaitWithRequestSignal(promise, requestSignal = null) {
  return requestSignal ? requestSignal.aborted ? Promise.reject(_createCodecHandoffAbortError(requestSignal)) : new Promise((resolve, reject) => {
    let settled = !1;
    const finish = (callback, value) => {
      settled || (settled = !0, requestSignal.removeEventListener?.("abort", onAbort), callback(value));
    }, onAbort = () => finish(reject, _createCodecHandoffAbortError(requestSignal));
    requestSignal.addEventListener?.("abort", onAbort, { once: !0 }), Promise.resolve(promise).then((value) => finish(resolve, value), (error) => finish(reject, error));
  }) : Promise.resolve(promise);
}
function _isBackupSearchContextCurrent(info, backupSearchEpoch, cycleStartedAt) {
  if (!info || Math.max(0, Number(info.BackupSearchEpoch) || 0) !== Math.max(0, Number(backupSearchEpoch) || 0))
    return !1;
  const expectedCycleStartedAt = Math.max(0, Number(cycleStartedAt) || 0);
  return expectedCycleStartedAt <= 0 ? !0 : Math.max(0, Number(info.VisibleAdStartedAt) || 0) === expectedCycleStartedAt && _normalizeMediaKey(__TTVAB_STATE__?.CurrentAdMediaKey) === _normalizeMediaKey(info.MediaKey) && (info.IsShowingAd === !0 || info.IsHoldingBackupAfterAd === !0);
}
async function _canReloadNativePlayerAfterAd(info, realFetch, resolution = null, requireProbe = !1, ownedNativeRecoveryTarget = null) {
  if (!requireProbe && !info?.IsHoldingBackupAfterAd && !info?.IsUsingBackupStream && !info?.IsUsingFallbackStream)
    return _resetNativeRecoveryReadyState(info), info.ConsecutiveFailedNativeProbes = 0, !0;
  if (info._NativeRecoveryProbeInFlight)
    return !1;
  const requiredCleanProbes = Math.max(1, Number(__TTVAB_STATE__?.AdEndMinNativeRecoveryProbes) || 1), probeCooldownMs = Math.max(250, Number(__TTVAB_STATE__?.AdEndNativeRecoveryProbeCooldownMs) || 750), now = Date.now();
  if (info.LastNativeRecoveryProbeAt && now - info.LastNativeRecoveryProbeAt < probeCooldownMs)
    return !1;
  info.LastNativeRecoveryProbeAt = now;
  const nativePlayerType = ownedNativeRecoveryTarget ? "owned-native" : _getNativeRecoveryProbePlayerType(), probeMediaKey = _normalizeMediaKey(info.MediaKey), probeCycleStartedAt = Math.max(0, Number(info.VisibleAdStartedAt) || 0), requestSignal = info?._AdCycleRequestController?.signal || null, probeIsLive = info?.MediaType !== "vod" && !probeMediaKey?.startsWith("vod:"), probeLoaderEpoch = Math.max(0, Number(info.NativeRecoveryLoaderEpoch) || 0), probePageMediaKey = _normalizeMediaKey(__TTVAB_STATE__?.PageMediaKey), probePageGeneration = Math.max(0, Number(__TTVAB_STATE__?.PagePlaybackContextGeneration) || 0), preferredQualityGroup = __TTVAB_STATE__?.PreferredQualityGroup, cachedProbeStreamUrl = typeof info.NativeRecoveryProbeStreamUrl == "string" && info.NativeRecoveryProbeStreamUrl ? info.NativeRecoveryProbeStreamUrl : null, cachedProbeSessionMatches = !!(probeIsLive && cachedProbeStreamUrl && (!ownedNativeRecoveryTarget || cachedProbeStreamUrl === ownedNativeRecoveryTarget.playlistUrl) && info.NativeRecoveryProbeMediaKey === probeMediaKey && info.NativeRecoveryProbePlayerType === nativePlayerType && Math.max(0, Number(info.NativeRecoveryProbeCycleStartedAt) || 0) === probeCycleStartedAt);
  !cachedProbeSessionMatches && (cachedProbeStreamUrl || info.NativeRecoveryProbeMediaKey || info.NativeRecoveryProbePlayerType || Math.max(0, Number(info.NativeRecoveryProbeCycleStartedAt) || 0) > 0 || info.NativeRecoveryProbeLastMediaSequence != null || Math.max(0, Number(info.NativeRecoveryProbeLastAdvancedAt) || 0) > 0) && _resetNativeRecoveryReadyState(info, !0);
  let probeStreamUrl = cachedProbeSessionMatches ? cachedProbeStreamUrl : ownedNativeRecoveryTarget?.playlistUrl || null;
  const probeEpoch = Number(info.NativeRecoveryProbeEpoch) || 0, probeToken = {}, probeInvalidated = () => info._NativeRecoveryProbeToken !== probeToken || (Number(info.NativeRecoveryProbeEpoch) || 0) !== probeEpoch || !probeMediaKey || requestSignal?.aborted || _normalizeMediaKey(info.MediaKey) !== probeMediaKey || probeCycleStartedAt <= 0 || !_isCodecHandoffCycleCurrent(probeMediaKey, probeCycleStartedAt, info) || ownedNativeRecoveryTarget && (!probeIsLive || !probeStreamUrl || _getNativeRecoveryMaster(info).master !== ownedNativeRecoveryTarget.master || _getNativeRecoveryMaster(info).masterUrl !== ownedNativeRecoveryTarget.masterUrl || (info._CodecHandoffPendingId || null) !== (ownedNativeRecoveryTarget.handoffId || null) || !_isNativeRecoveryCodecHandoffReady(info, ownedNativeRecoveryTarget.requestUrl || probeStreamUrl) || !_getNativeRecoveryMaster(info).resolutionList.some((entry) => entry.Url === probeStreamUrl) || Math.max(0, Number(info.NativeRecoveryLoaderEpoch) || 0) !== probeLoaderEpoch || __TTVAB_STATE__?.StreamInfos?.[probeMediaKey] !== info || _normalizeMediaKey(__TTVAB_STATE__?.PageMediaKey) !== probePageMediaKey || Math.max(0, Number(__TTVAB_STATE__?.PagePlaybackContextGeneration) || 0) !== probePageGeneration || __TTVAB_STATE__?.PreferredQualityGroup !== preferredQualityGroup);
  info._NativeRecoveryProbeInFlight = !0, info._NativeRecoveryProbeToken = probeToken;
  try {
    if (probeInvalidated())
      return !1;
    if (!probeStreamUrl) {
      const tokenRes = await _getToken(info, nativePlayerType, realFetch, !1, 0, requestSignal);
      if (probeInvalidated())
        return !1;
      if (tokenRes.status !== 200)
        return _resetNativeRecoveryReadyState(info, !0), _markNativeRecoveryProbeFailed(info), !1;
      const token = await tokenRes.json();
      if (probeInvalidated())
        return !1;
      const extractedToken = _extractPlaybackAccessToken(token), sig = extractedToken?.signature, tokenValue = extractedToken?.value;
      if (!sig || !tokenValue)
        return _resetNativeRecoveryReadyState(info, !0), _markNativeRecoveryProbeFailed(info), !1;
      const usherUrl = _buildUsherPlaybackUrl(info, sig, tokenValue);
      if (!usherUrl)
        return _resetNativeRecoveryReadyState(info, !0), _markNativeRecoveryProbeFailed(info), !1;
      const encRes = await _fetchWithTimeout(realFetch, usherUrl.href, {
        signal: requestSignal
      });
      if (probeInvalidated())
        return !1;
      if (encRes.status !== 200)
        return _resetNativeRecoveryReadyState(info, !0), _markNativeRecoveryProbeFailed(info), !1;
      const encM3u8 = await encRes.text();
      if (probeInvalidated())
        return !1;
      const targetResolution = resolution || _getFallbackResolution(info, "") || info?.ResolutionList?.[0] || null, streamUrl = _getStreamUrl(encM3u8, targetResolution, encRes.url || usherUrl.href);
      if (!streamUrl)
        return _resetNativeRecoveryReadyState(info, !0), _markNativeRecoveryProbeFailed(info), !1;
      probeStreamUrl = String(streamUrl);
    }
    probeIsLive && !cachedProbeSessionMatches && (info.NativeRecoveryProbeStreamUrl = probeStreamUrl, info.NativeRecoveryProbeMediaKey = probeMediaKey, info.NativeRecoveryProbePlayerType = nativePlayerType, info.NativeRecoveryProbeCycleStartedAt = probeCycleStartedAt, info.NativeRecoveryProbeLastMediaSequence = null, info.NativeRecoveryProbeLastAdvancedAt = 0);
    const streamRes = await _fetchWithTimeout(realFetch, probeStreamUrl, {
      signal: requestSignal
    });
    if (probeInvalidated())
      return !1;
    if (streamRes.status !== 200)
      return _resetNativeRecoveryReadyState(info, !0), _markNativeRecoveryProbeFailed(info), !1;
    const nativeM3u8 = await streamRes.text();
    if (probeInvalidated())
      return !1;
    if (!_playlistHasMediaSegments(nativeM3u8))
      return _resetNativeRecoveryReadyState(info, !0), _markNativeRecoveryProbeFailed(info), !1;
    const nativeHasAds = _hasPlaylistAdMarkers(nativeM3u8) || _playlistHasKnownAdSegments(nativeM3u8, {
      includeCached: !1
    }), observedAt = Date.now();
    let liveSequenceAdvanced = !probeIsLive;
    if (probeIsLive) {
      const mediaSequence = _parsePlaylistFirstMediaSequence(nativeM3u8), lastMediaSequence = info.NativeRecoveryProbeLastMediaSequence != null && Number.isFinite(Number(info.NativeRecoveryProbeLastMediaSequence)) ? Number(info.NativeRecoveryProbeLastMediaSequence) : null;
      if (mediaSequence == null || lastMediaSequence != null && mediaSequence < lastMediaSequence)
        return _resetNativeRecoveryReadyState(info, !0), _markNativeRecoveryProbeFailed(info), !1;
      if (lastMediaSequence == null || mediaSequence > lastMediaSequence)
        info.NativeRecoveryProbeLastMediaSequence = mediaSequence, info.NativeRecoveryProbeLastAdvancedAt = observedAt, liveSequenceAdvanced = lastMediaSequence != null;
      else {
        const lastAdvancedAt = Math.max(0, Number(info.NativeRecoveryProbeLastAdvancedAt) || 0);
        if (lastAdvancedAt <= 0 || observedAt - lastAdvancedAt >= 15e3)
          return _resetNativeRecoveryReadyState(info, !0), _markNativeRecoveryProbeFailed(info), !1;
      }
    }
    return nativeHasAds ? (_resetNativeRecoveryReadyState(info, !0, probeIsLive), _markNativeRecoveryProbeFailed(info), !1) : liveSequenceAdvanced ? _markNativeRecoveryReady(info, nativePlayerType) < requiredCleanProbes ? (_markNativeRecoveryProbeFailed(info), !1) : (info.ConsecutiveFailedNativeProbes = 0, !0) : !1;
  } catch {
    return probeInvalidated() || (_resetNativeRecoveryReadyState(info, !0), _markNativeRecoveryProbeFailed(info)), !1;
  } finally {
    info._NativeRecoveryProbeToken === probeToken && (ownedNativeRecoveryTarget && probeInvalidated() && _resetNativeRecoveryReadyState(info, !0), info._NativeRecoveryProbeInFlight = !1, info._NativeRecoveryProbeToken = null);
  }
}
function _createStreamInfo(context) {
  const normalizedContext = _normalizePlaybackContext(context), ownsCurrentAdMediaKey = !!(normalizedContext.MediaKey && _normalizeMediaKey(__TTVAB_STATE__?.CurrentAdMediaKey) === normalizedContext.MediaKey), podProgress = ownsCurrentAdMediaKey && normalizedContext.MediaKey && __TTVAB_STATE__?.AdPodProgressByMediaKey?.[normalizedContext.MediaKey] || null, visibleAdStartedAt = Math.max(0, Number(podProgress?.cycleStartedAt) || 0), ownsCurrentAdCycle = !!(ownsCurrentAdMediaKey && visibleAdStartedAt > 0);
  return {
    MediaType: normalizedContext.MediaType,
    MediaKey: normalizedContext.MediaKey,
    ChannelName: normalizedContext.ChannelName,
    VodID: normalizedContext.VodID,
    IsShowingAd: ownsCurrentAdCycle,
    LastPlayerReload: 0,
    EncodingsM3U8: null,
    ModifiedM3U8: null,
    IsUsingModifiedM3U8: !1,
    IsUsingFallbackStream: !1,
    IsUsingBackupStream: !1,
    UsherBaseUrl: "",
    UsherParams: "",
    RequestedAds: /* @__PURE__ */ new Set(),
    SpoofedAdIds: /* @__PURE__ */ new Set(),
    RecentSpoofedAdIds: /* @__PURE__ */ new Map(),
    ObservedAdPodIds: new Set(Array.isArray(podProgress?.adIds) ? podProgress.adIds : []),
    ExpectedAdPodLength: Math.max(0, Number(podProgress?.expectedPodLength) || 0),
    MaxObservedAdPodPosition: Math.max(0, Number(podProgress?.maxAdPodPosition) || 0),
    ObservedZeroAdPodPosition: podProgress?.observedZeroAdPodPosition === !0,
    LastAdPodProgressAt: Math.max(0, Number(podProgress?.updatedAt) || 0, visibleAdStartedAt),
    _IncompletePodCleanStartedAt: 0,
    _IncompletePodCleanPlaylistCount: 0,
    _IncompletePodLastMediaSequence: null,
    _IncompletePodCandidateUrl: null,
    MeasuredAdIds: /* @__PURE__ */ new Set(),
    FailedBackupPlayerTypes: /* @__PURE__ */ new Map(),
    LastSessionNeutralBackupProbeCycleStartedAt: 0,
    Urls: /* @__PURE__ */ Object.create(null),
    ResolutionList: [],
    BackupEncodingsM3U8Cache: /* @__PURE__ */ Object.create(null),
    EnhancedVariantUrls: /* @__PURE__ */ new Set(),
    EnhancedDecoderCodecFamily: null,
    EnhancedDecoderCodec: null,
    ActiveBackupPlayerType: null,
    ActiveBackupResolution: null,
    SustainedNativeResolution: null,
    SustainedNativeResolutionAt: 0,
    SustainedNativeResolutionStartedAt: 0,
    _NativePlaybackMaster: null,
    LastCleanNativeM3U8: null,
    LastCleanNativeUrl: null,
    LastCleanNativeCodec: null,
    LastCleanNativePlaylistAt: 0,
    LastCleanNativeLoaderEpoch: 0,
    LastCleanBackupM3U8: null,
    LastCleanBackupPlayerType: null,
    LastCleanBackupResolution: null,
    LastCleanBackupCodecFamily: null,
    LastCleanBackupCodec: null,
    BackupPlaylistMetadata: /* @__PURE__ */ new Map(),
    LastCleanBackupAt: 0,
    IsMidroll: !1,
    AdRollContext: null,
    CsaiOnlyThisBreak: !1,
    IsStrippingAdSegments: !1,
    NumStrippedAdSegments: 0,
    PendingAdEndAt: 0,
    CleanPlaylistCount: 0,
    AdEndMarkerBounceLogged: !1,
    AdEndConfirmEscalation: ownsCurrentAdCycle ? 4 : 0,
    VisibleAdStartedAt: visibleAdStartedAt,
    IsHoldingBackupAfterAd: !1,
    SilentBackupHoldStartedAt: 0,
    LastSilentBackupHoldLogAt: 0,
    LastNativeRecoveryProbeAt: 0,
    BackupVariantUrls: /* @__PURE__ */ new Set(),
    EnhancedBackupVariantUrls: /* @__PURE__ */ new Set(),
    BackupVariantPlayerTypes: /* @__PURE__ */ new Map(),
    LastNativeRecoveryReadyPlayerType: null,
    NativeRecoveryCleanCount: 0,
    NativeRecoveryProbeEpoch: 0,
    _NativeRecoveryProbeInFlight: !1,
    _NativeRecoveryProbeToken: null,
    NativeRecoveryProbeStreamUrl: null,
    NativeRecoveryProbeMediaKey: null,
    NativeRecoveryProbePlayerType: null,
    NativeRecoveryProbeCycleStartedAt: 0,
    NativeRecoveryProbeLastMediaSequence: null,
    NativeRecoveryProbeLastAdvancedAt: 0,
    NativeRecoveryAdPlaylistUrls: /* @__PURE__ */ new Set(),
    NativeRecoveryAdMediaKey: null,
    NativeRecoveryAdStartedAt: 0,
    _PendingPostAdNativeMaster: null,
    _PendingNativeReloadConfirmation: null,
    NativeRecoveryLoaderEpoch: 0,
    NativeRecoveryCandidateUrl: null,
    NativeRecoveryCandidateMediaKey: null,
    NativeRecoveryCandidateCycleStartedAt: 0,
    NativeRecoveryCandidateStage: null,
    NativeRecoveryCandidateStartedAt: 0,
    NativeRecoveryCandidateCleanCount: 0,
    NativeRecoveryCandidateLastMediaSequence: null,
    _BackupSearchPromise: null,
    _BackupSearchKey: null,
    _BackupSearchPromises: /* @__PURE__ */ new Map(),
    _BackupSelectionSequence: 0,
    _BackupSelection: null,
    _LastNoBackupProbeAt: 0,
    _NoBackupRecoveryCandidates: /* @__PURE__ */ new Map(),
    _PreviewMasterFallbackRetryAt: 0,
    BackupSearchEpoch: 0,
    _ForegroundQualityProbeAppliedAt: 0,
    ConsecutiveFailedNativeProbes: 0,
    _LoggedWhitelistByType: null,
    _BackupSearchCount: 0,
    _BackupSearchErrorCount: 0,
    _BackupSearchFailCount: 0,
    LastAdEndReloadAt: 0,
    LastAdEndReloadKind: null,
    PostEscapeReloadCounterproductive: !1,
    LastNativeRecoveryHoldLogAt: 0,
    HevcReloadPendingAfterHold: !1,
    LastAdEndBounceAt: 0,
    LastActivityAt: Date.now(),
    LoggedBackupAdsByType: null,
    _EmptyAdHoldMediaSequence: 0,
    _EmptyAdHoldDiscontinuitySequence: 0,
    _EmptyAdHoldProgramDateTime: 0,
    _EmptyAdHoldWindow: null,
    _EmptyHoldTimelineByUrl: /* @__PURE__ */ new Map(),
    _LivePlaylistTimeline: null,
    _LastServedPlaylistKind: null,
    _FatalMediaRecoveryRequestId: null,
    _AdCycleRequestController: ownsCurrentAdCycle && typeof AbortController == "function" ? new AbortController() : null,
    _CodecHandoffSequence: 0,
    _CodecHandoffPendingId: null,
    _CodecHandoffAcknowledgedId: null,
    _CodecHandoffFailedId: null,
    _CodecHandoffReloadRetryCount: 0,
    _SpliceStreamId: null,
    _SpliceBoundarySeq: null,
    _SpliceDiscontinuityOffset: 0,
    _SpliceLastDiscontinuitySequence: null,
    _SpliceLastMediaSequence: null,
    _NativeSpliceBoundaries: /* @__PURE__ */ new Map()
  };
}
function _createSyntheticStreamInfo(playbackContext, url = "") {
  const normalizedContext = _normalizePlaybackContext(playbackContext);
  if (!normalizedContext.MediaKey)
    return null;
  const info = _createStreamInfo(normalizedContext);
  if (__TTVAB_STATE__.StreamInfos[normalizedContext.MediaKey] = info, url)
    for (const alias of _getPlaylistUrlAliases(url))
      __TTVAB_STATE__.StreamInfosByUrl[alias] = info;
  const logTarget = normalizedContext.MediaType === "vod" ? `vod ${normalizedContext.VodID}` : normalizedContext.ChannelName;
  return info;
}
function _buildUsherPlaybackUrl(info, sig, token) {
  let usherUrl = null;
  if (typeof info?.UsherBaseUrl == "string" && info.UsherBaseUrl)
    try {
      usherUrl = new URL(info.UsherBaseUrl);
    } catch {
    }
  if (!usherUrl) {
    const routePath = info?.MediaType === "vod" && info?.VodID ? `vod/${info.VodID}.m3u8` : info?.ChannelName ? `channel/hls/${info.ChannelName}.m3u8` : null;
    if (!routePath)
      return null;
    usherUrl = new URL(`https://usher.ttvnw.net/api/${__TTVAB_STATE__.V2API ? "v2/" : ""}${routePath}${info?.UsherParams || ""}`);
  }
  return usherUrl.searchParams.set("sig", sig), usherUrl.searchParams.set("token", token), usherUrl;
}
function _getExactPlaylistUrlKey(url, baseUrl = null) {
  const candidate = typeof url == "string" ? url.trimEnd() : "";
  if (!candidate)
    return "";
  try {
    const parsed = new URL(candidate, typeof baseUrl == "string" && baseUrl ? baseUrl : void 0);
    return parsed.hash = "", parsed.href;
  } catch {
    return candidate;
  }
}
function _clearCodecHandoffState(info, handoffId = null, clearDecoderOwnership = !0) {
  if (!info)
    return !1;
  const exactHandoffId = typeof handoffId == "string" && handoffId ? handoffId : null;
  if (exactHandoffId && info._CodecHandoffPendingId !== exactHandoffId && info._CodecHandoffAcknowledgedId !== exactHandoffId && info._CodecHandoffFailedId !== exactHandoffId)
    return !1;
  const completedExactHandoff = !!(exactHandoffId && info._CodecHandoffPendingId === exactHandoffId && info._CodecHandoffAcknowledgedId === exactHandoffId);
  return info._CodecHandoffSequence = Math.max(0, Number(info._CodecHandoffSequence) || 0) + 1, info._CodecHandoffPendingId = null, info._CodecHandoffAcknowledgedId = null, info._CodecHandoffFailedId = null, info._CodecHandoffReloadRetryCount = 0, info.IsUsingModifiedM3U8 = !1, clearDecoderOwnership === !0 && (!exactHandoffId || completedExactHandoff) && (info.EnhancedDecoderCodecFamily = null, info.EnhancedDecoderCodec = null), !0;
}
function _markCodecHandoffReloadFailed(info, handoffId) {
  return !info || typeof handoffId != "string" || !handoffId || info._CodecHandoffPendingId !== handoffId ? !1 : (info._CodecHandoffFailedId = handoffId, info._CodecHandoffPendingId = null, info._CodecHandoffAcknowledgedId = null, info.IsUsingModifiedM3U8 = !1, !0);
}
function _getActiveCodecHandoffIdForInfo(info) {
  const visibleCycleStartedAt = Math.max(0, Number(info?.VisibleAdStartedAt) || 0);
  return typeof info?._CodecHandoffPendingId == "string" && info._CodecHandoffPendingId && _getCodecHandoffCycleStartedAt(info._CodecHandoffPendingId) === visibleCycleStartedAt && _isCodecHandoffCycleCurrent(info?.MediaKey, visibleCycleStartedAt, info) ? info._CodecHandoffPendingId : typeof __TTVAB_STATE__?.ActiveCodecHandoffId == "string" && __TTVAB_STATE__.ActiveCodecHandoffId && _normalizeMediaKey(__TTVAB_STATE__.ActiveCodecHandoffMediaKey) === _normalizeMediaKey(info?.MediaKey) && _getCodecHandoffCycleStartedAt(__TTVAB_STATE__.ActiveCodecHandoffId) === visibleCycleStartedAt && _isCodecHandoffCycleCurrent(info?.MediaKey, visibleCycleStartedAt, info) ? __TTVAB_STATE__.ActiveCodecHandoffId : null;
}
function _createCodecHandoffId(info) {
  const cycleStartedAt = Math.max(0, Number(info?.VisibleAdStartedAt) || 0);
  info._CodecHandoffSequence = Math.max(0, Number(info._CodecHandoffSequence) || 0) + 1;
  let nonce = "";
  try {
    if (typeof globalThis.crypto?.randomUUID == "function")
      nonce = globalThis.crypto.randomUUID();
    else if (typeof globalThis.crypto?.getRandomValues == "function") {
      const values = new Uint32Array(2);
      globalThis.crypto.getRandomValues(values), nonce = `${values[0].toString(36)}${values[1].toString(36)}`;
    }
  } catch {
  }
  return nonce || (nonce = `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`), `${info.MediaKey || info.ChannelName || "stream"}:${cycleStartedAt}:${Date.now()}:${info._CodecHandoffSequence}:${nonce}`;
}
function _getCodecHandoffCycleStartedAt(handoffId) {
  if (typeof handoffId != "string" || !handoffId)
    return 0;
  const parts = handoffId.split(":");
  return parts.length < 5 ? 0 : Math.max(0, Number(parts[parts.length - 4]) || 0);
}
function _getCurrentAdBreakStartedAt(mediaKey, info = null) {
  const normalizedMediaKey = _normalizeMediaKey(mediaKey || info?.MediaKey);
  if (!normalizedMediaKey)
    return 0;
  const infoCycleStartedAt = Math.max(0, Number(info?.VisibleAdStartedAt) || 0), entryCycleStartedAt = Math.max(0, Number(__TTVAB_STATE__?.AdPodProgressByMediaKey?.[normalizedMediaKey]?.cycleStartedAt) || 0), streamInfo = __TTVAB_STATE__?.StreamInfos?.[normalizedMediaKey] || info || null;
  return Math.max(infoCycleStartedAt, entryCycleStartedAt, Math.max(0, Number(streamInfo?.VisibleAdStartedAt) || 0));
}
function _isCodecHandoffCycleCurrent(mediaKey, cycleStartedAt, info = null) {
  const normalizedMediaKey = _normalizeMediaKey(mediaKey || info?.MediaKey), currentAdMediaKey = _normalizeMediaKey(__TTVAB_STATE__?.CurrentAdMediaKey), expectedCycleStartedAt = Math.max(0, Number(cycleStartedAt) || 0);
  return !!(normalizedMediaKey && currentAdMediaKey === normalizedMediaKey && expectedCycleStartedAt > 0 && _getCurrentAdBreakStartedAt(normalizedMediaKey, info) === expectedCycleStartedAt);
}
function _isCodecHandoffAdRecoveryActive(info, requestWasAdMarked = !1, expectedCycleStartedAt = null) {
  const infoMediaKey = _normalizeMediaKey(info?.MediaKey), currentCycleStartedAt = _getCurrentAdBreakStartedAt(infoMediaKey, info), expectedCycle = Math.max(0, Number(expectedCycleStartedAt) || 0);
  if (!infoMediaKey || currentCycleStartedAt <= 0 || (expectedCycle > 0 ? !_isCodecHandoffCycleCurrent(infoMediaKey, expectedCycle, info) : !_isCodecHandoffCycleCurrent(infoMediaKey, currentCycleStartedAt, info)))
    return !1;
  if (requestWasAdMarked || info?.IsShowingAd === !0 || info?.IsHoldingBackupAfterAd === !0)
    return !0;
  const pendingHandoffId = typeof info?._CodecHandoffPendingId == "string" && info._CodecHandoffPendingId ? info._CodecHandoffPendingId : null, activeHandoffId = typeof __TTVAB_STATE__?.ActiveCodecHandoffId == "string" && __TTVAB_STATE__.ActiveCodecHandoffId ? __TTVAB_STATE__.ActiveCodecHandoffId : null;
  return !!(pendingHandoffId && activeHandoffId && pendingHandoffId === activeHandoffId && _getCodecHandoffCycleStartedAt(pendingHandoffId) === currentCycleStartedAt && _normalizeMediaKey(__TTVAB_STATE__?.ActiveCodecHandoffMediaKey) === infoMediaKey);
}
function _requestCodecHandoffReload(info, expectedCycleStartedAt = null) {
  if (!_isCodecHandoffAdRecoveryActive(info, !1, expectedCycleStartedAt) || typeof info?.ModifiedM3U8 != "string" || !info.ModifiedM3U8)
    return null;
  if (typeof info?._CodecHandoffPendingId == "string" && info._CodecHandoffPendingId) {
    const pendingCycleStartedAt = _getCodecHandoffCycleStartedAt(info._CodecHandoffPendingId), currentCycleStartedAt = _getCurrentAdBreakStartedAt(info.MediaKey, info);
    if (pendingCycleStartedAt > 0 && pendingCycleStartedAt === currentCycleStartedAt)
      return info._CodecHandoffPendingId;
    info._CodecHandoffPendingId = null, info._CodecHandoffAcknowledgedId = null, info._CodecHandoffFailedId = null, info.IsUsingModifiedM3U8 = !1;
  }
  const handoffId = _createCodecHandoffId(info), cycleStartedAt = _getCodecHandoffCycleStartedAt(handoffId);
  return info._CodecHandoffPendingId = handoffId, info._CodecHandoffAcknowledgedId = null, info._CodecHandoffFailedId = null, typeof self < "u" && self.postMessage && _postWorkerBridgeMessage(self, _createPageScopedWorkerEvent({
    key: "ReloadPlayer",
    channel: info.ChannelName,
    mediaKey: info.MediaKey,
    reason: "codec-handoff",
    handoffId,
    cycleStartedAt,
    refreshAccessToken: !0,
    newMediaPlayerInstance: !0
  })), handoffId;
}
function _getDirectPlaybackResolutionForUrl(info, url = "") {
  for (const alias of _getPlaylistUrlAliases(url)) {
    const resolution = info?.Urls?.[alias] || null;
    if (resolution)
      return resolution;
  }
  return null;
}
function _getVideoCodecFamily(codecs) {
  const value = _getVideoCodecIdentity(codecs) || (typeof codecs == "string" ? codecs.trim().toLowerCase() : "");
  return value === "hevc" || _isHevcCodecString(value) ? "hevc" : value === "av1" || value.startsWith("av0") ? "av1" : value.startsWith("avc") || value.startsWith("avc1") ? "avc" : null;
}
function _getVideoCodecIdentity(codecs) {
  const values = typeof codecs == "string" ? codecs.toLowerCase().split(",").map((value) => value.trim()).filter(Boolean) : [];
  for (const value of values)
    if (value.startsWith("hev1") || value.startsWith("hvc1") || value.startsWith("av01") || value.startsWith("avc1"))
      return value;
  return null;
}
function _getBackupVariantCodecFamily(m3u8, streamUrl, baseUrl = null) {
  const selectedUrl = _getExactPlaylistUrlKey(streamUrl, baseUrl);
  if (!selectedUrl || typeof m3u8 != "string")
    return null;
  const lines = m3u8.split(`
`);
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i], rawUrl = lines[i + 1]?.trim();
    if (!(!line?.startsWith("#EXT-X-STREAM-INF") || !rawUrl || rawUrl.startsWith("#")) && _getExactPlaylistUrlKey(rawUrl, baseUrl) === selectedUrl)
      return _getVideoCodecFamily(_parseAttrs(line).CODECS);
  }
  return null;
}
function _getBackupVariantCodecIdentity(m3u8, streamUrl, baseUrl = null) {
  const selectedUrl = _getExactPlaylistUrlKey(streamUrl, baseUrl);
  if (!selectedUrl || typeof m3u8 != "string")
    return null;
  const lines = m3u8.split(`
`);
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i], rawUrl = lines[i + 1]?.trim();
    if (!(!line?.startsWith("#EXT-X-STREAM-INF") || !rawUrl || rawUrl.startsWith("#")) && _getExactPlaylistUrlKey(rawUrl, baseUrl) === selectedUrl)
      return _getVideoCodecIdentity(_parseAttrs(line).CODECS);
  }
  return null;
}
function _getBackupVariantResolution(m3u8, streamUrl, baseUrl = null) {
  const selectedUrl = _getExactPlaylistUrlKey(streamUrl, baseUrl);
  if (!selectedUrl || typeof m3u8 != "string")
    return null;
  const lines = m3u8.split(`
`);
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i], rawUrl = lines[i + 1]?.trim();
    if (!line?.startsWith("#EXT-X-STREAM-INF") || !rawUrl || rawUrl.startsWith("#") || _getExactPlaylistUrlKey(rawUrl, baseUrl) !== selectedUrl)
      continue;
    const resolution = String(_parseAttrs(line).RESOLUTION || "").trim();
    return /^\d+x\d+$/.test(resolution) ? resolution : null;
  }
  return null;
}
function _setBackupVariantResolution(info, resolution, activate = !1) {
  const selectedResolution = resolution || null;
  info.LastCleanBackupResolution = selectedResolution, activate && (info.ActiveBackupResolution = selectedResolution);
}
function _commitBackupPlaylist(info, m3u8, sequence, metadata, activate = !1) {
  const identity = JSON.stringify([
    metadata.playerType,
    _getExactPlaylistUrlKey(metadata.playlistUrl),
    _getExactPlaylistUrlKey(metadata.sessionUrl),
    metadata.resolution,
    metadata.codecFamily,
    metadata.codec
  ]), previous = info._BackupSelection;
  if (previous && (sequence < previous.sequence || identity === previous.identity && sequence < previous.refreshedSequence))
    return null;
  _observeServedPrefetchTimeline(info, metadata.playlistUrl, m3u8);
  const previousDescription = `${info.LastCleanBackupPlayerType || "none"}@${info.LastCleanBackupResolution || "unknown"}`;
  info._BackupSelection = {
    identity,
    sequence: identity === previous?.identity ? previous.sequence : !previous && activate && info.ActiveBackupPlayerType === metadata.playerType ? 0 : sequence,
    refreshedSequence: sequence
  };
  const committedAt = Date.now();
  return metadata.playerType !== "autoplay" ? info._LqHoldStartAt = 0 : (info.LastCleanBackupPlayerType !== "autoplay" || !info._LqHoldStartAt) && (info._LqHoldStartAt = committedAt), info.LastCleanBackupM3U8 = m3u8, info.LastCleanBackupPlayerType = metadata.playerType, info.LastCleanBackupCodecFamily = metadata.codecFamily, info.LastCleanBackupCodec = metadata.codec, _rememberBackupPlaylistMetadata(info, m3u8, metadata.codecFamily, metadata.codec, metadata), info.LastCleanBackupAt = committedAt, _setBackupVariantResolution(info, metadata.resolution, activate), previous?.identity, m3u8;
}
function _rememberBackupPlaylistMetadata(info, m3u8, codecFamily = null, codec = null, variant = null) {
  if (!info || typeof m3u8 != "string" || !m3u8)
    return m3u8;
  info.BackupPlaylistMetadata instanceof Map || (info.BackupPlaylistMetadata = /* @__PURE__ */ new Map());
  const nextMetadata = {
    codecFamily: _getVideoCodecFamily(codecFamily || codec),
    codec: _getVideoCodecIdentity(codec),
    playlistUrl: _getExactPlaylistUrlKey(variant?.playlistUrl),
    sessionUrl: _getExactPlaylistUrlKey(variant?.sessionUrl),
    playerType: variant?.playerType || null,
    resolution: variant?.resolution || null,
    ambiguous: !1
  }, existingMetadata = info.BackupPlaylistMetadata.get(m3u8) || null, metadataConflicts = !!(existingMetadata && (existingMetadata.ambiguous === !0 || existingMetadata.codecFamily !== nextMetadata.codecFamily || existingMetadata.codec !== nextMetadata.codec));
  for (info.BackupPlaylistMetadata.set(m3u8, metadataConflicts ? { codecFamily: null, codec: null, ambiguous: !0 } : nextMetadata); info.BackupPlaylistMetadata.size > 20; ) {
    const oldest = info.BackupPlaylistMetadata.keys().next().value;
    if (oldest === void 0)
      break;
    info.BackupPlaylistMetadata.delete(oldest);
  }
  return m3u8;
}
function _rememberSegmentCodecOwnership(info, text, codecFamily = null, exactSegmentUrls = null) {
  const normalizedCodecFamily = _getVideoCodecFamily(codecFamily);
  if (!info || typeof text != "string" || !text || !(normalizedCodecFamily === "avc" || normalizedCodecFamily === "hevc" || normalizedCodecFamily === "av1"))
    return !1;
  __TTVAB_STATE__.SegmentCodecOwners instanceof Map || (__TTVAB_STATE__.SegmentCodecOwners = /* @__PURE__ */ new Map());
  const rememberUrl = (rawUrl, isExact = !1) => {
    const url = isExact ? rawUrl : _getExactPlaylistUrlKey(rawUrl);
    if (!url)
      return;
    const previous = __TTVAB_STATE__.SegmentCodecOwners.get(url) || null, conflicts = !!(previous && (previous.ambiguous === !0 || previous.codecFamily !== normalizedCodecFamily || _normalizeMediaKey(previous.mediaKey) !== _normalizeMediaKey(info.MediaKey)));
    __TTVAB_STATE__.SegmentCodecOwners.set(url, conflicts ? {
      codecFamily: null,
      mediaKey: null,
      recordedAt: Date.now(),
      ambiguous: !0
    } : {
      codecFamily: normalizedCodecFamily,
      mediaKey: _normalizeMediaKey(info.MediaKey),
      recordedAt: Date.now(),
      ambiguous: !1
    });
  };
  if (Array.isArray(exactSegmentUrls))
    for (const segmentUrl of exactSegmentUrls)
      rememberUrl(segmentUrl, !0);
  else {
    const lines = text.split(`
`);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (line?.startsWith("#EXTINF")) {
        rememberUrl(lines[_getMediaSegmentUriIndex(lines, index)]);
        continue;
      }
      if (_isMediaPartLine(line) || _isPartPreloadHintLine(line)) {
        rememberUrl(_getTaggedPlaylistUri(line));
        continue;
      }
      line?.startsWith("#EXT-X-TWITCH-PREFETCH:") && rememberUrl(line.substring(23).trim());
    }
  }
  for (; __TTVAB_STATE__.SegmentCodecOwners.size > 1e3; ) {
    const oldest = __TTVAB_STATE__.SegmentCodecOwners.keys().next().value;
    if (oldest === void 0)
      break;
    __TTVAB_STATE__.SegmentCodecOwners.delete(oldest);
  }
  return !0;
}
function _isLastCleanNativeForRequest(info, url, requestCodecs = null, requestIsEnhanced = !1, retiringCodec = null) {
  const cachedUrl = _getExactPlaylistUrlKey(info?.LastCleanNativeUrl), requestUrl = _getExactPlaylistUrlKey(url);
  if (!cachedUrl || !requestUrl || cachedUrl !== requestUrl)
    return !1;
  const cachedFamily = _getVideoCodecFamily(info?.LastCleanNativeCodec), cachedIdentity = _getVideoCodecIdentity(info?.LastCleanNativeCodec), retiringIdentity = _getVideoCodecIdentity(retiringCodec);
  if (retiringIdentity)
    return cachedIdentity === retiringIdentity;
  const retiringFamily = _getVideoCodecFamily(retiringCodec);
  if (retiringFamily)
    return cachedFamily === retiringFamily;
  const requestFamily = _getVideoCodecFamily(requestCodecs);
  return requestFamily && cachedFamily ? requestFamily === cachedFamily : !(requestIsEnhanced && cachedFamily === "avc");
}
function _getSameRequestCleanNative(info, url, requestCodecs = null, requestIsEnhanced = !1, maxAgeMs = 1e4, retiringCodec = null) {
  const ageMs = Date.now() - (Number(info?.LastCleanNativePlaylistAt) || 0);
  return info?.MediaType !== "vod" && (info?._LastServedPlaylistKind === "hold" || info?._LastServedPlaylistKind === "backup") || !_isLastCleanNativeForRequest(info, url, requestCodecs, requestIsEnhanced, retiringCodec) || ageMs < 0 || ageMs > Math.max(0, Number(maxAgeMs) || 0) || typeof info?.LastCleanNativeM3U8 != "string" || !info.LastCleanNativeM3U8 || _hasPlaylistAdMarkers(info.LastCleanNativeM3U8) || _playlistHasKnownAdSegments(info.LastCleanNativeM3U8, {
    includeCached: !1
  }) ? null : info.LastCleanNativeM3U8;
}
function _createCodecHandoffAbortError(requestSignal = null) {
  const reason = requestSignal?.reason;
  if (reason && typeof reason == "object" && reason.name === "AbortError")
    return reason;
  if (typeof DOMException == "function")
    return new DOMException("Retired enhanced-codec playlist request", "AbortError");
  const error = new Error("Retired enhanced-codec playlist request");
  return error.name = "AbortError", error;
}
async function _holdRetiringCodecRequest(info, url, text, requestCodecs, requestIsEnhanced, requestSignal, handoffId, retiringCodec = null, retirementDeadlineAt = 0) {
  const bridgeDeadline = Date.now() + 2500, absoluteRetirementDeadline = Math.max(0, Number(retirementDeadlineAt) || 0) || Date.now() + 1e4;
  let activeHandoffId = handoffId;
  const retiringCodecIdentity = _getVideoCodecIdentity(retiringCodec), retiringCodecFamily = _getVideoCodecFamily(retiringCodec), requestCodecIdentity = _getVideoCodecIdentity(requestCodecs), requestCodecFamily = _getVideoCodecFamily(requestCodecs), sourceIsClean = (retiringCodecIdentity ? requestCodecIdentity === retiringCodecIdentity : !!(retiringCodecFamily && requestCodecFamily === retiringCodecFamily)) && _playlistHasMediaSegments(text) && !_hasPlaylistAdMarkers(text) && !_playlistHasKnownAdSegments(text, { includeCached: !1 });
  for (; ; ) {
    if (requestSignal?.aborted)
      throw _createCodecHandoffAbortError(requestSignal);
    if (Date.now() >= absoluteRetirementDeadline) {
      const timedOutCycleStartedAt = _getCodecHandoffCycleStartedAt(activeHandoffId);
      throw info?._CodecHandoffPendingId === activeHandoffId && info?._CodecHandoffAcknowledgedId !== activeHandoffId && _isCodecHandoffCycleCurrent(info?.MediaKey, timedOutCycleStartedAt, info) && typeof self < "u" && self.postMessage && _postWorkerBridgeMessage(self, _createPageScopedWorkerEvent({
        key: "ReloadPlayer",
        channel: info.ChannelName,
        mediaKey: info.MediaKey,
        reason: "codec-handoff",
        handoffId: activeHandoffId,
        cycleStartedAt: timedOutCycleStartedAt,
        refreshAccessToken: !0,
        newMediaPlayerInstance: !0
      })), _createCodecHandoffAbortError(requestSignal);
    }
    const sameRequestCleanNative = _getSameRequestCleanNative(info, url, requestCodecs, requestIsEnhanced, 1e4, retiringCodec);
    typeof info?._CodecHandoffPendingId == "string" && info._CodecHandoffPendingId && info._CodecHandoffPendingId !== activeHandoffId && (activeHandoffId = info._CodecHandoffPendingId);
    const activeHandoffCycleStartedAt = _getCodecHandoffCycleStartedAt(activeHandoffId);
    if (!_isCodecHandoffAdRecoveryActive(info, !1, activeHandoffCycleStartedAt)) {
      if (sameRequestCleanNative)
        return sameRequestCleanNative;
      if (sourceIsClean)
        return text;
      throw _createCodecHandoffAbortError(requestSignal);
    }
    const transactionFailed = !!(activeHandoffId && info?._CodecHandoffFailedId === activeHandoffId);
    if (transactionFailed && info?.IsShowingAd) {
      const retryCount = Math.max(0, Number(info._CodecHandoffReloadRetryCount) || 0), retryDelays = [250, 1e3, 3e3, 8e3, 15e3];
      if (await _waitForAbortableDelay(Math.min(retryDelays[Math.min(retryCount, retryDelays.length - 1)], Math.max(0, absoluteRetirementDeadline - Date.now())), requestSignal), requestSignal?.aborted)
        throw _createCodecHandoffAbortError(requestSignal);
      if (info?._CodecHandoffFailedId === activeHandoffId && !info?._CodecHandoffPendingId && (info._CodecHandoffReloadRetryCount = retryCount + 1, info._CodecHandoffFailedId = null, activeHandoffId = _requestCodecHandoffReload(info, activeHandoffCycleStartedAt), !activeHandoffId)) {
        if (sameRequestCleanNative)
          return sameRequestCleanNative;
        if (sourceIsClean)
          return text;
        throw _createCodecHandoffAbortError(requestSignal);
      }
      continue;
    }
    const transactionEnded = transactionFailed || info?._CodecHandoffPendingId !== activeHandoffId;
    if (sameRequestCleanNative && (info?._CodecHandoffAcknowledgedId === activeHandoffId || transactionEnded || Date.now() >= bridgeDeadline))
      return sameRequestCleanNative;
    if (transactionEnded && sourceIsClean)
      return text;
    if (transactionEnded)
      throw _createCodecHandoffAbortError(requestSignal);
    await _waitForAbortableDelay(Math.min(16, Math.max(0, absoluteRetirementDeadline - Date.now())), requestSignal);
  }
}
function _assertM3U8RequestContextCurrent(info, requestAdContext = null, requestSignal = null) {
  if (requestSignal?.aborted)
    throw _createCodecHandoffAbortError(requestSignal);
  if (!info || !requestAdContext || typeof requestAdContext != "object")
    return !0;
  const expectedBackupSearchEpoch = Math.max(0, Number(requestAdContext.backupSearchEpoch) || 0);
  if (Math.max(0, Number(info.BackupSearchEpoch) || 0) !== expectedBackupSearchEpoch)
    throw _createCodecHandoffAbortError(requestSignal);
  const expectedLoaderEpoch = Math.max(0, Number(requestAdContext.loaderEpoch) || 0);
  if (Math.max(0, Number(info.NativeRecoveryLoaderEpoch) || 0) !== expectedLoaderEpoch)
    throw _createCodecHandoffAbortError(requestSignal);
  const expectedCycleStartedAt = Math.max(0, Number(requestAdContext.cycleStartedAt) || 0);
  if (expectedCycleStartedAt > 0 && !_isCodecHandoffCycleCurrent(info.MediaKey, expectedCycleStartedAt, info))
    throw _createCodecHandoffAbortError(requestSignal);
  return !0;
}
async function _awaitM3U8RequestContext(promise, info, requestAdContext = null, requestSignal = null) {
  const value = await promise;
  return _assertM3U8RequestContextCurrent(info, requestAdContext, requestSignal), value;
}
async function _processM3U8(url, text, realFetch, requestSignal = null, requestStartContext = null) {
  const initialInfo = _getStreamInfoForPlaylist(url), requestStartMediaKey = _normalizeMediaKey(requestStartContext?.mediaKey), initialMediaKey = _normalizeMediaKey(initialInfo?.MediaKey), initialMediaFirstSyntheticInfo = !!(initialInfo && initialInfo.EncodingsM3U8 === null && initialInfo.UsherBaseUrl === "" && Array.isArray(initialInfo.ResolutionList) && initialInfo.ResolutionList.length === 0), requestStartContextMatchesInfo = !!(requestStartMediaKey && initialMediaKey && requestStartMediaKey === initialMediaKey), hasRequestStartContext = !!(requestStartContext && typeof requestStartContext == "object");
  if (requestStartMediaKey && (!initialMediaKey || !requestStartContextMatchesInfo))
    throw _createCodecHandoffAbortError(requestSignal);
  if (initialMediaFirstSyntheticInfo && _normalizeMediaKey(__TTVAB_STATE__?.CurrentAdMediaKey) === initialMediaKey && Math.max(0, Number(initialInfo?.VisibleAdStartedAt) || 0) > 0)
    throw __TTVAB_STATE__?.RequestMediaBootstrapRecovery?.(initialInfo, initialInfo.VisibleAdStartedAt), _createCodecHandoffAbortError(requestSignal);
  const initialResolution = _getDirectPlaybackResolutionForUrl(initialInfo, url), requestStartCodec = _getVideoCodecIdentity(requestStartContext?.requestCodec) || _getVideoCodecFamily(requestStartContext?.requestCodec) || null, initialRequestCodec = initialResolution?.Codecs || requestStartCodec, initialRequestCodecFamily = _getVideoCodecFamily(initialRequestCodec), exactRequestUrl = _getExactPlaylistUrlKey(url), requestIsEnhanced = !!(initialRequestCodecFamily === "hevc" || initialRequestCodecFamily === "av1" || initialInfo?.EnhancedVariantUrls?.has(exactRequestUrl) || initialInfo?.EnhancedBackupVariantUrls?.has(exactRequestUrl)), initialRetiringCodec = (requestStartContextMatchesInfo ? _getVideoCodecIdentity(requestStartContext?.enhancedDecoderCodec) || _getVideoCodecFamily(requestStartContext?.enhancedDecoderCodec) : null) || _getVideoCodecIdentity(initialInfo?.EnhancedDecoderCodec) || _getVideoCodecFamily(initialInfo?.EnhancedDecoderCodecFamily) || null || (requestIsEnhanced ? _getVideoCodecIdentity(initialRequestCodec) || _getVideoCodecFamily(initialRequestCodec) : null), initialRetiringCodecFamily = _getVideoCodecFamily(initialRetiringCodec), initialHasEnhancedDecoderOwner = initialRetiringCodecFamily === "hevc" || initialRetiringCodecFamily === "av1", requestCodecs = initialRequestCodec || null, activeHandoffId = initialInfo ? _getActiveCodecHandoffIdForInfo(initialInfo) : null;
  if (initialInfo && initialHasEnhancedDecoderOwner && initialInfo.IsUsingModifiedM3U8 && activeHandoffId)
    return initialInfo._CodecHandoffPendingId = activeHandoffId, _holdRetiringCodecRequest(initialInfo, url, text, requestCodecs, requestIsEnhanced, requestSignal, activeHandoffId, initialRetiringCodec);
  const requestAdContext = {
    postAdNativeMasterServedAt: Math.max(0, Number(hasRequestStartContext ? requestStartContext.postAdNativeMasterServedAt : initialInfo?._PendingPostAdNativeMaster?.masterServedAt) || 0),
    requestStartedAt: Math.max(0, Number(requestStartContext?.requestStartedAt) || Date.now()),
    requestStartMediaKey: hasRequestStartContext ? requestStartMediaKey : initialMediaKey,
    requestStartCycleStartedAt: hasRequestStartContext ? Math.max(0, Number(requestStartContext?.cycleStartedAt) || 0) : Math.max(0, Number(initialInfo?.VisibleAdStartedAt) || 0),
    backupSearchEpoch: hasRequestStartContext ? Math.max(0, Number(requestStartContext?.backupSearchEpoch) || 0) : Math.max(0, Number(initialInfo?.BackupSearchEpoch) || 0),
    loaderEpoch: hasRequestStartContext ? Math.max(0, Number(requestStartContext?.loaderEpoch) || 0) : Math.max(0, Number(initialInfo?.NativeRecoveryLoaderEpoch) || 0),
    cycleStartedAt: hasRequestStartContext ? Math.max(0, Number(requestStartContext?.cycleStartedAt) || 0) : Math.max(0, Number(initialInfo?.VisibleAdStartedAt) || 0),
    includeCachedAdSegments: !!(requestStartContextMatchesInfo && requestStartContext?.includeCachedAdSegments),
    responseDeadlineAt: initialHasEnhancedDecoderOwner ? Date.now() + 1e4 : 0,
    backupMetadata: null
  }, coreResultProbe = await _awaitBackupProbeBeforeDeadline(_awaitWithRequestSignal(_processM3U8Core(url, text, realFetch, requestAdContext, requestSignal), requestSignal), requestAdContext.responseDeadlineAt);
  if (!coreResultProbe.completed)
    throw _createCodecHandoffAbortError(requestSignal);
  let result = coreResultProbe.value;
  const info = _getStreamInfoForPlaylist(url) || initialInfo;
  if (!info)
    return result;
  if (info.EncodingsM3U8 === null && info.UsherBaseUrl === "" && Array.isArray(info.ResolutionList) && info.ResolutionList.length === 0 && _normalizeMediaKey(__TTVAB_STATE__?.CurrentAdMediaKey) === _normalizeMediaKey(info.MediaKey) && Math.max(0, Number(info.VisibleAdStartedAt) || 0) > 0)
    throw _createCodecHandoffAbortError(requestSignal);
  const retiringCodec = initialRetiringCodec || _getVideoCodecIdentity(info.EnhancedDecoderCodec) || _getVideoCodecFamily(info.EnhancedDecoderCodecFamily) || (requestIsEnhanced ? _getVideoCodecIdentity(initialRequestCodec) || _getVideoCodecFamily(initialRequestCodec) : null), retiringCodecFamily = _getVideoCodecFamily(retiringCodec), retiringCodecIdentity = _getVideoCodecIdentity(retiringCodec), responseHasEnhancedDecoderOwner = retiringCodecFamily === "hevc" || retiringCodecFamily === "av1", resultBackupMetadata = requestAdContext.backupMetadata || info.BackupPlaylistMetadata instanceof Map && info.BackupPlaylistMetadata.get(result) || null, returnedCachedBackupBeforeEnhancedStrip = !!(resultBackupMetadata || typeof info.LastCleanBackupM3U8 == "string" && info.LastCleanBackupM3U8 && result === info.LastCleanBackupM3U8), returnedCachedNativeBeforeEnhancedStrip = !!(typeof info.LastCleanNativeM3U8 == "string" && info.LastCleanNativeM3U8 && result === info.LastCleanNativeM3U8), returnedEmptyHoldBeforeEnhancedStrip = result.includes("https://www.twitch.tv/__ttvab_empty_hold_segment.ts"), requestMayUseCachedAdSegments = !!(requestAdContext.includeCachedAdSegments || _normalizeMediaKey(__TTVAB_STATE__?.CurrentAdMediaKey) === _normalizeMediaKey(info.MediaKey) && (info.IsShowingAd === !0 || info.IsHoldingBackupAfterAd === !0)), requestWasAdMarked = _hasPlaylistAdMarkers(text) || _playlistHasKnownAdSegments(text, {
    includeCached: requestMayUseCachedAdSegments
  });
  responseHasEnhancedDecoderOwner && requestWasAdMarked && !returnedCachedBackupBeforeEnhancedStrip && !returnedCachedNativeBeforeEnhancedStrip && !returnedEmptyHoldBeforeEnhancedStrip && result.replace(/\r/g, "").split(`
`).some((line) => line.startsWith("#EXTINF") && !line.includes(",live") || _isMediaPartLine(line) || _isPartPreloadHintLine(line) || line.startsWith("#EXT-X-TWITCH-PREFETCH:")) && (result = _stripAds(result, !0, info, !1, !0));
  const returnedCachedBackup = !!(resultBackupMetadata || typeof info.LastCleanBackupM3U8 == "string" && info.LastCleanBackupM3U8 && result === info.LastCleanBackupM3U8), returnedAvcEmptyHold = result.includes("https://www.twitch.tv/__ttvab_empty_hold_segment.ts"), returnedCachedNative = !!(typeof info.LastCleanNativeM3U8 == "string" && info.LastCleanNativeM3U8 && result === info.LastCleanNativeM3U8), requestCodecFamily = _getVideoCodecFamily(requestCodecs), requestCodecIdentity = _getVideoCodecIdentity(requestCodecs), backupCodecFamily = _getVideoCodecFamily(resultBackupMetadata ? resultBackupMetadata.codecFamily : info.LastCleanBackupCodecFamily), backupCodecIdentity = _getVideoCodecIdentity(resultBackupMetadata ? resultBackupMetadata.codec : info.LastCleanBackupCodec), requestCodecMatchesRetiringOwner = !!(requestCodecFamily && requestCodecFamily === retiringCodecFamily && (!retiringCodecIdentity || requestCodecIdentity === retiringCodecIdentity)), requestCanUseRetiringOwnerBackup = !!(!requestCodecFamily || requestCodecMatchesRetiringOwner), returnedBackupMatchesRetiringOwner = !!(returnedCachedBackup && retiringCodecFamily && backupCodecFamily === retiringCodecFamily && retiringCodecIdentity && backupCodecIdentity === retiringCodecIdentity), returnedBackupMatchesRequest = !!(returnedCachedBackup && requestCodecFamily && backupCodecFamily === requestCodecFamily && (!(requestCodecFamily === "hevc" || requestCodecFamily === "av1") || requestCodecIdentity && backupCodecIdentity === requestCodecIdentity)), responseCodecConflictsWithRetiringOwner = !!(retiringCodecFamily && !requestCodecMatchesRetiringOwner && !returnedBackupMatchesRetiringOwner && _playlistHasMediaSegments(result)), codecHandoffAdRecoveryActive = _isCodecHandoffAdRecoveryActive(info, requestWasAdMarked, requestAdContext.cycleStartedAt), handoffCodecOverride = responseHasEnhancedDecoderOwner && requestCodecFamily === "avc" && !requestCodecMatchesRetiringOwner ? requestCodecs || "avc" : null;
  if (returnedCachedBackup && requestCodecFamily && !returnedBackupMatchesRequest && !responseHasEnhancedDecoderOwner) {
    const sameRequestCleanNative = _getSameRequestCleanNative(info, url, requestCodecs, requestIsEnhanced, 2e3, null);
    if (sameRequestCleanNative)
      return _applyPlaylistContinuity(info, url, sameRequestCleanNative, null, requestAdContext);
    if (codecHandoffAdRecoveryActive) {
      info._LastBackupSearchCompletedAt = 0;
      const retryTarget = _resolveAdBackupTargetResolution(info, url);
      _findBackupStream(info, realFetch, 0, retryTarget, requestCodecs).catch((error) => {
      });
    }
    const compatibleResult = requestWasAdMarked ? _stripAds(text, !1, info, !1, !0) : text;
    return _applyPlaylistContinuity(info, url, compatibleResult, null, requestAdContext);
  }
  if (!(responseHasEnhancedDecoderOwner && (requestWasAdMarked || codecHandoffAdRecoveryActive) && (returnedCachedBackup && (!returnedBackupMatchesRetiringOwner || !requestCanUseRetiringOwnerBackup) || returnedAvcEmptyHold || returnedCachedNative && !_isLastCleanNativeForRequest(info, url, requestCodecs, requestIsEnhanced, retiringCodec) || responseCodecConflictsWithRetiringOwner))) {
    returnedCachedNative && !returnedCachedBackup && requestWasAdMarked && requestCodecFamily === "avc" && !responseHasEnhancedDecoderOwner && info.MediaType === "live" && info._LastServedPlaylistKind === "hold" && (info.IsShowingAd || info.IsHoldingBackupAfterAd) && (_assertM3U8RequestContextCurrent(info, requestAdContext, requestSignal), result = _createEmptyAdHoldPlaylist(text, info));
    const output = _applyPlaylistContinuity(info, url, result, resultBackupMetadata, requestAdContext);
    return returnedCachedNative && requestWasAdMarked && info.LastCleanNativeM3U8, output;
  }
  let backupSearchRetryCount = 0, nextBackupSearchRetryAt = Date.now() + 250;
  const backupSearchRetryDelays = [250, 1e3, 3e3, 8e3, 15e3], unsafeResponseDeadlineAt = Math.max(0, Number(requestAdContext.responseDeadlineAt) || 0) || Date.now() + 1e4;
  for (; ; ) {
    if (requestSignal?.aborted || Date.now() >= unsafeResponseDeadlineAt)
      throw _createCodecHandoffAbortError(requestSignal);
    const sameRequestCleanNative = _getSameRequestCleanNative(info, url, requestCodecs, requestIsEnhanced, 1e4, retiringCodec);
    if (!_isCodecHandoffAdRecoveryActive(info, requestWasAdMarked, requestAdContext.cycleStartedAt)) {
      if (sameRequestCleanNative)
        return _applyPlaylistContinuity(info, url, sameRequestCleanNative, null, requestAdContext);
      throw _createCodecHandoffAbortError(requestSignal);
    }
    const now = Date.now(), backupAt = Number(info.LastCleanBackupAt) || 0, backupAgeMs = now - backupAt, cleanBackupIsFreshAndSafe = !!(typeof info.LastCleanBackupM3U8 == "string" && info.LastCleanBackupM3U8 && backupAt >= Math.max(0, Number(info.VisibleAdStartedAt) || 0) && backupAgeMs >= 0 && backupAgeMs < 900 && !_hasPlaylistAdMarkers(info.LastCleanBackupM3U8) && !_playlistHasKnownAdSegments(info.LastCleanBackupM3U8, {
      includeCached: !1
    })), cleanBackupMetadata = cleanBackupIsFreshAndSafe && info.BackupPlaylistMetadata instanceof Map && info.BackupPlaylistMetadata.get(info.LastCleanBackupM3U8) || null, cleanBackupHasTrustedCodec = !!(cleanBackupMetadata && cleanBackupMetadata.ambiguous !== !0);
    if (cleanBackupIsFreshAndSafe && cleanBackupHasTrustedCodec && requestCanUseRetiringOwnerBackup && retiringCodecIdentity && _getVideoCodecIdentity(info.LastCleanBackupCodec) === retiringCodecIdentity && _getVideoCodecIdentity(cleanBackupMetadata.codec) === retiringCodecIdentity)
      return info.IsUsingBackupStream = !0, _applyPlaylistContinuity(info, url, info.LastCleanBackupM3U8, cleanBackupMetadata, requestAdContext);
    if (!(cleanBackupIsFreshAndSafe && cleanBackupHasTrustedCodec && _getVideoCodecFamily(info.LastCleanBackupCodecFamily) === "avc" && _getVideoCodecFamily(cleanBackupMetadata.codecFamily) === "avc")) {
      if (sameRequestCleanNative)
        return _applyPlaylistContinuity(info, url, sameRequestCleanNative, null, requestAdContext);
      const backupSearchIsInFlight = !!(info._BackupSearchPromise || info._BackupSearchPromises instanceof Map && info._BackupSearchPromises.size > 0);
      if (now >= nextBackupSearchRetryAt && (!handoffCodecOverride || !backupSearchIsInFlight)) {
        backupSearchRetryCount++, nextBackupSearchRetryAt = now + backupSearchRetryDelays[Math.min(backupSearchRetryCount, backupSearchRetryDelays.length - 1)], info._LastBackupSearchCompletedAt = 0;
        const retryTarget = _resolveAdBackupTargetResolution(info, url);
        _findBackupStream(info, realFetch, 0, retryTarget, handoffCodecOverride).catch((err) => {
        });
      }
      await _waitForAbortableDelay(Math.min(50, Math.max(0, unsafeResponseDeadlineAt - Date.now())), requestSignal);
      continue;
    }
    let handoffId = info._CodecHandoffPendingId;
    if (handoffId || (handoffId = _requestCodecHandoffReload(info, requestAdContext.cycleStartedAt)), !handoffId) {
      if (sameRequestCleanNative)
        return _applyPlaylistContinuity(info, url, sameRequestCleanNative, null, requestAdContext);
      throw _createCodecHandoffAbortError(requestSignal);
    }
    return _holdRetiringCodecRequest(info, url, text, requestCodecs, requestIsEnhanced, requestSignal, handoffId, retiringCodec, unsafeResponseDeadlineAt);
  }
}
async function _processM3U8Core(url, text, realFetch, requestAdContext = null, requestSignal = null) {
  const segmentUrlCollection = { urls: [], isComplete: !0 };
  text = _absolutizeMediaPlaylistUrls(text, url, segmentUrlCollection);
  let info = _getStreamInfoForPlaylist(url);
  if (!info) {
    const syntheticPlaybackContext = _getSyntheticPlaybackContextForPlaylist(url), inheritedCycleStartedAt = Math.max(0, Number(syntheticPlaybackContext?.MediaKey ? __TTVAB_STATE__?.AdPodProgressByMediaKey?.[syntheticPlaybackContext.MediaKey]?.cycleStartedAt : 0) || 0), inheritsCurrentAdCycle = !!(syntheticPlaybackContext?.MediaKey && inheritedCycleStartedAt > 0 && _normalizeMediaKey(__TTVAB_STATE__?.CurrentAdMediaKey) === _normalizeMediaKey(syntheticPlaybackContext.MediaKey));
    if (!(_hasPlaylistAdMarkers(text) || _playlistHasKnownAdSegments(text, { includeCached: !1 }) || __TTVAB_STATE__.SimulatedAdsDepth > 0) && !inheritsCurrentAdCycle)
      return text;
    if (inheritsCurrentAdCycle)
      throw __TTVAB_STATE__?.RequestMediaBootstrapRecovery?.(syntheticPlaybackContext, inheritedCycleStartedAt), _createCodecHandoffAbortError(requestSignal);
    if (info = _createSyntheticStreamInfo(syntheticPlaybackContext, url), !info)
      throw _createCodecHandoffAbortError(requestSignal);
  }
  _assertM3U8RequestContextCurrent(info, requestAdContext, requestSignal), _observeServedPrefetchTimeline(info, url, text), info.LastActivityAt = Date.now();
  const currentAliases = _getPlaylistUrlAliases(url), exactRequestUrl = _getMediaPlaylistSessionKey(url), isExactCurrentMasterVariant = !!(exactRequestUrl && info?.Urls && Object.hasOwn(info.Urls, exactRequestUrl)), isExactCurrentCycleNativeVariant = !!(!isExactCurrentMasterVariant && (info.IsShowingAd || info.IsHoldingBackupAfterAd) && _isExactNativeRecoveryCandidateOwned(info, url, !0, requestAdContext ? requestAdContext.requestStartMediaKey : info?.MediaKey, requestAdContext ? requestAdContext.requestStartCycleStartedAt : info?.VisibleAdStartedAt)), isExactCurrentNativeVariant = !!(isExactCurrentMasterVariant || isExactCurrentCycleNativeVariant), isBackupUrl = !!(!isExactCurrentNativeVariant && (currentAliases.some((alias) => info.BackupVariantUrls?.has(alias)) || info.ActiveBackupPlayerType && info.BackupEncodingsM3U8Cache[info.ActiveBackupPlayerType]?.baseUrl === url)), isEnhancedBackupUrl = !!(isBackupUrl && currentAliases.some((alias) => info.EnhancedBackupVariantUrls?.has(alias))), backupPlaylistHasAds = !!(isBackupUrl && (_hasPlaylistAdMarkers(text) || _playlistHasKnownAdSegments(text) || __TTVAB_STATE__.SimulatedAdsDepth > 0));
  if (isBackupUrl && !backupPlaylistHasAds)
    return text;
  const previousSustainedNativeResolution = info.SustainedNativeResolution;
  if (isBackupUrl || _recordSustainedNativeResolution(info, url), !__TTVAB_STATE__.IsAdStrippingEnabled) {
    if (info.IsShowingAd || info.IsUsingModifiedM3U8 || info.IsUsingFallbackStream || info.IsUsingBackupStream) {
      const endedCodecHandoffId = _getActiveCodecHandoffIdForInfo(info), endedCycleStartedAt = Math.max(0, Number(info.VisibleAdStartedAt) || 0) || _getCodecHandoffCycleStartedAt(endedCodecHandoffId), { wasUsingModifiedM3U8, wasUsingFallbackStream, wasUsingBackupStream, hadStrippedAdSegments } = _resetStreamAdState(info);
      if (__TTVAB_STATE__.CurrentAdChannel = null, __TTVAB_STATE__.CurrentAdMediaKey = null, __TTVAB_STATE__.PinnedBackupPlayerType = null, __TTVAB_STATE__.PinnedBackupPlayerChannel = null, __TTVAB_STATE__.PinnedBackupPlayerMediaKey = null, __TTVAB_STATE__.LastAdRecoveryReloadAt = 0, (wasUsingModifiedM3U8 || wasUsingFallbackStream || wasUsingBackupStream || hadStrippedAdSegments) && typeof self < "u" && self.postMessage) {
        const shouldReloadPlayer = _shouldReloadNativePlayerAfterAdReset({
          wasUsingModifiedM3U8,
          wasUsingFallbackStream,
          wasUsingBackupStream,
          hadStrippedAdSegments
        });
        _postWorkerBridgeMessage(self, _createPageScopedWorkerEvent({
          key: "AdEnded",
          channel: info.ChannelName,
          mediaKey: info.MediaKey,
          handoffId: endedCodecHandoffId,
          cycleStartedAt: endedCycleStartedAt,
          endedAt: Date.now(),
          willReload: shouldReloadPlayer
        })), shouldReloadPlayer ? (info.LastPlayerReload = Date.now(), _postWorkerBridgeMessage(self, _createPageScopedWorkerEvent({
          key: "ReloadPlayer",
          channel: info.ChannelName,
          mediaKey: info.MediaKey,
          cycleStartedAt: endedCycleStartedAt,
          refreshAccessToken: !1,
          newMediaPlayerInstance: !1
        }))) : _postWorkerBridgeMessage(self, _createPageScopedWorkerEvent({
          key: "PauseResumePlayer",
          channel: info.ChannelName,
          mediaKey: info.MediaKey,
          cycleStartedAt: endedCycleStartedAt
        }));
      }
    }
    return text;
  }
  if (__TTVAB_STATE__.HasTriggeredPlayerReload) {
    const pendingReloadMediaKey = _normalizeMediaKey(__TTVAB_STATE__.PendingTriggeredPlayerReloadMediaKey), pendingReloadChannel = _normalizeChannelName(__TTVAB_STATE__.PendingTriggeredPlayerReloadChannel), pendingReloadCycleStartedAt = Math.max(0, Number(__TTVAB_STATE__.PendingTriggeredPlayerReloadCycleStartedAt) || 0), pendingReloadAt = Math.max(0, Number(__TTVAB_STATE__.PendingTriggeredPlayerReloadAt) || 0);
    if (!pendingReloadMediaKey && !pendingReloadChannel || pendingReloadMediaKey && pendingReloadMediaKey === _normalizeMediaKey(info.MediaKey) || !pendingReloadMediaKey && pendingReloadChannel && pendingReloadChannel === _normalizeChannelName(info.ChannelName)) {
      const pendingCycleIsCurrent = pendingReloadCycleStartedAt <= 0 || _isPageLifecycleCycleCurrent(info.MediaKey, pendingReloadCycleStartedAt);
      __TTVAB_STATE__.HasTriggeredPlayerReload = !1, __TTVAB_STATE__.PendingTriggeredPlayerReloadChannel = null, __TTVAB_STATE__.PendingTriggeredPlayerReloadMediaKey = null, __TTVAB_STATE__.PendingTriggeredPlayerReloadAt = 0, __TTVAB_STATE__.PendingTriggeredPlayerReloadCycleStartedAt = 0, pendingCycleIsCurrent && (info.LastPlayerReload = Date.now(), _invalidateNativeRecoveryAfterPlayerReload(info), pendingReloadAt > 0 && pendingReloadCycleStartedAt > 0 && (info._PendingNativeReloadConfirmation = {
        mediaKey: info.MediaKey,
        pageMediaKey: __TTVAB_STATE__.PageMediaKey,
        pageGeneration: Number(__TTVAB_STATE__.PagePlaybackContextGeneration) || 0,
        cycleStartedAt: pendingReloadCycleStartedAt,
        reloadAt: pendingReloadAt,
        loaderEpoch: Math.max(0, Number(info.NativeRecoveryLoaderEpoch) || 0)
      }));
    }
  }
  const directResolution = _getDirectPlaybackResolutionForUrl(info, url), res = directResolution || _resolvePlaybackResolutionForUrl(info, url), isEnhancedCodec = !!(_isEnhancedCodecString(directResolution?.Codecs) || info.EnhancedVariantUrls?.has(exactRequestUrl)), requestCodecFamily = _getVideoCodecFamily(directResolution?.Codecs || res?.Codecs), requestCodecIdentity = _getVideoCodecIdentity(directResolution?.Codecs || res?.Codecs), segmentCodecFamily = isBackupUrl ? isEnhancedBackupUrl ? requestCodecFamily || _getVideoCodecFamily(info.EnhancedDecoderCodec) || _getVideoCodecFamily(info.EnhancedDecoderCodecFamily) : "avc" : requestCodecFamily;
  _rememberSegmentCodecOwnership(info, text, segmentCodecFamily, segmentUrlCollection.isComplete ? segmentUrlCollection.urls : null), isEnhancedCodec && (requestCodecFamily === "hevc" || requestCodecFamily === "av1") && (info.EnhancedDecoderCodecFamily = requestCodecFamily, requestCodecIdentity && (info.EnhancedDecoderCodec = requestCodecIdentity));
  const shouldIncludeCachedAdSegments = !!(requestAdContext?.includeCachedAdSegments || _normalizeMediaKey(__TTVAB_STATE__?.CurrentAdMediaKey) === _normalizeMediaKey(info.MediaKey) && (info.IsShowingAd === !0 || info.IsHoldingBackupAfterAd === !0)), hasExplicitKnownAdSegments = _playlistHasKnownAdSegments(text, {
    includeCached: shouldIncludeCachedAdSegments
  }), adSignifier = typeof __TTVAB_STATE__?.AdSignifier == "string" && __TTVAB_STATE__.AdSignifier.trim() ? __TTVAB_STATE__.AdSignifier.trim() : "stitched", hasAds = text.includes(adSignifier) || _hasExplicitAdMetadata(text) || hasExplicitKnownAdSegments || __TTVAB_STATE__.SimulatedAdsDepth > 0, sustainedNativeCodec = info.SustainedNativeResolution?.Codecs, previousSustainedNativeCodec = previousSustainedNativeResolution?.Codecs;
  if (!isBackupUrl && !hasAds && directResolution && requestCodecFamily === "avc" && _getVideoCodecIdentity(sustainedNativeCodec) === requestCodecIdentity && info.SustainedNativeResolution?.Resolution === directResolution.Resolution && _getVideoCodecIdentity(previousSustainedNativeCodec) === requestCodecIdentity && previousSustainedNativeResolution?.Resolution === directResolution.Resolution && _getMediaPlaylistSessionKey(info.LastCleanNativeUrl) === exactRequestUrl && _getVideoCodecIdentity(info.LastCleanNativeCodec) === requestCodecIdentity && (Number(info.LastCleanNativePlaylistAt) || 0) > 0 && _normalizeMediaKey(__TTVAB_STATE__.CurrentAdMediaKey) !== _normalizeMediaKey(info.MediaKey) && !info.IsShowingAd && !info.IsHoldingBackupAfterAd && !info.IsUsingModifiedM3U8 && !info._CodecHandoffPendingId && (info.EnhancedDecoderCodecFamily = null, info.EnhancedDecoderCodec = null), hasAds && segmentCodecFamily !== "avc" && segmentCodecFamily !== "hevc" && segmentCodecFamily !== "av1")
    throw _createCodecHandoffAbortError(requestSignal);
  const hasMediaSegments = _playlistHasMediaSegments(text), pendingPostAdNativeMaster = info._PendingPostAdNativeMaster;
  pendingPostAdNativeMaster && _normalizeMediaKey(pendingPostAdNativeMaster.mediaKey) === _normalizeMediaKey(info.MediaKey) && (_getExactPlaylistUrlKey(pendingPostAdNativeMaster.playlistUrl) === exactRequestUrl || pendingPostAdNativeMaster.verifiedPlaylistUrls?.includes(exactRequestUrl)) && (hasAds || hasMediaSegments && Number(pendingPostAdNativeMaster.masterServedAt) > 0 && Number(requestAdContext?.postAdNativeMasterServedAt) === Number(pendingPostAdNativeMaster.masterServedAt) && Number(requestAdContext?.requestStartedAt || Date.now()) >= Number(pendingPostAdNativeMaster.masterServedAt) && Number(pendingPostAdNativeMaster.loaderEpoch) === Math.max(0, Number(requestAdContext?.loaderEpoch ?? info.NativeRecoveryLoaderEpoch) || 0)) && (hasAds ? (_reportPostAdNativeSession(info, "ad-rejected"), info._PendingPostAdNativeMaster = null) : requestAdContext && !pendingPostAdNativeMaster.consumed && (requestAdContext.nativeSessionToConsume = {
    session: pendingPostAdNativeMaster,
    playlist: text
  }));
  const ensureVisibleAdCycle = () => {
    if (info.IsShowingAd)
      return;
    const now = Date.now(), activeAdMediaKey = typeof __TTVAB_STATE__.CurrentAdMediaKey == "string" ? __TTVAB_STATE__.CurrentAdMediaKey : null, activeAdChannel = typeof __TTVAB_STATE__.CurrentAdChannel == "string" ? __TTVAB_STATE__.CurrentAdChannel : null, isRecentAdEndReentry = _isRecentPostAdReentry(info, now), normalizedInfoMediaKey = _normalizeMediaKey(info.MediaKey), normalizedActiveAdMediaKey = _normalizeMediaKey(activeAdMediaKey), activeAdContextMatches = !!(normalizedActiveAdMediaKey && normalizedActiveAdMediaKey === normalizedInfoMediaKey || !normalizedActiveAdMediaKey && _normalizeChannelName(activeAdChannel) === _normalizeChannelName(info.ChannelName)), isContinuingAdCycle = !!(activeAdContextMatches || isRecentAdEndReentry), sharedPodCycleStartedAt = Math.max(0, Number(__TTVAB_STATE__?.AdPodProgressByMediaKey?.[info.MediaKey]?.cycleStartedAt) || 0), previousCycleStartedAt = Math.max(0, Number(info.VisibleAdStartedAt) || 0), lastEndedCycleStartedAt = isRecentAdEndReentry && _normalizeMediaKey(__TTVAB_STATE__?.LastAdEndedMediaKey) === _normalizeMediaKey(info.MediaKey) ? Math.max(0, Number(__TTVAB_STATE__?.LastAdEndedCycleStartedAt) || 0) : 0, continuationCycleStartedAt = Math.max(sharedPodCycleStartedAt, activeAdContextMatches ? previousCycleStartedAt : 0, lastEndedCycleStartedAt), nextCycleStartedAt = isContinuingAdCycle && continuationCycleStartedAt > 0 ? continuationCycleStartedAt : now, cycleChanged = previousCycleStartedAt !== nextCycleStartedAt;
    info.IsShowingAd = !0, info.VisibleAdStartedAt = nextCycleStartedAt, info.IsHoldingBackupAfterAd = !1, info.SilentBackupHoldStartedAt = 0, info.LastSilentBackupHoldLogAt = 0, info.ConsecutiveFailedNativeProbes = 0, __TTVAB_STATE__.CurrentAdChannel = info.ChannelName, __TTVAB_STATE__.CurrentAdMediaKey = info.MediaKey, __TTVAB_STATE__.LastAdDetectedAt = now, info.FailedBackupPlayerTypes?.clear?.(), cycleChanged && (info.AdRollContext = null, info._AdCycleRequestController?.abort?.(), info._AdCycleRequestController = typeof AbortController == "function" ? new AbortController() : null, _resetNativeRecoveryReadyState(info), info.BackupSearchEpoch = Math.max(0, Number(info.BackupSearchEpoch) || 0) + 1, info._BackupSearchPromises?.clear?.(), info._BackupSearchPromise = null, info._BackupSearchKey = null, info.AdEndConfirmEscalation = 0, info._BackupPinFlipCount = 0, info.LastCleanBackupM3U8 = null, info.LastCleanBackupResolution = null, info.LastCleanBackupAt = 0, info.BackupPlaylistMetadata?.clear?.()), (!info._AdCycleRequestController || info._AdCycleRequestController.signal?.aborted) && typeof AbortController == "function" && (info._AdCycleRequestController = new AbortController()), isRecentAdEndReentry && (info.AdEndConfirmEscalation = (Number(info.AdEndConfirmEscalation) || 0) + 1), typeof self < "u" && self.postMessage && _postWorkerBridgeMessage(self, _createPageScopedWorkerEvent({
      key: "AdDetected",
      channel: info.ChannelName,
      mediaKey: info.MediaKey,
      continued: isContinuingAdCycle,
      cycleStartedAt: info.VisibleAdStartedAt,
      detectedAt: now,
      playlistUrl: url,
      codec: directResolution?.Codecs || res?.Codecs || segmentCodecFamily
    }));
  };
  if (hasAds && !info.IsHoldingBackupAfterAd && ensureVisibleAdCycle(), hasAds && !isBackupUrl) {
    const exactAdPlaylistUrl = exactRequestUrl, adMediaKey = _normalizeMediaKey(info.MediaKey), adCycleStartedAt = Math.max(0, Number(info.VisibleAdStartedAt) || 0), requestOwnsAdPlaylist = !requestAdContext || _normalizeMediaKey(requestAdContext.requestStartMediaKey) === adMediaKey && Math.max(0, Number(requestAdContext.loaderEpoch) || 0) === Math.max(0, Number(info.NativeRecoveryLoaderEpoch) || 0);
    if (exactAdPlaylistUrl && adMediaKey && adCycleStartedAt > 0 && requestOwnsAdPlaylist)
      for (isExactCurrentNativeVariant && _recordNativeAdRollType(info, text), info.NativeRecoveryAdPlaylistUrls instanceof Set && _normalizeMediaKey(info.NativeRecoveryAdMediaKey) === adMediaKey && Math.max(0, Number(info.NativeRecoveryAdStartedAt) || 0) === adCycleStartedAt || (info.NativeRecoveryAdPlaylistUrls = /* @__PURE__ */ new Set(), info.NativeRecoveryAdMediaKey = adMediaKey, info.NativeRecoveryAdStartedAt = adCycleStartedAt), info.NativeRecoveryAdPlaylistUrls.add(exactAdPlaylistUrl); info.NativeRecoveryAdPlaylistUrls.size > 16; ) {
        const oldestUrl = info.NativeRecoveryAdPlaylistUrls.values().next().value;
        if (oldestUrl === void 0)
          break;
        info.NativeRecoveryAdPlaylistUrls.delete(oldestUrl);
      }
  }
  if (requestAdContext && typeof requestAdContext == "object" && (requestAdContext.backupSearchEpoch = Math.max(0, Number(info.BackupSearchEpoch) || 0), requestAdContext.cycleStartedAt = Math.max(0, Number(info.VisibleAdStartedAt) || 0)), isBackupUrl && backupPlaylistHasAds) {
    const exactBackupUrl = exactRequestUrl, exactBackupOwner = info.BackupVariantPlayerTypes?.get?.(exactBackupUrl), contaminatedBackupType = typeof exactBackupOwner == "string" && exactBackupOwner ? exactBackupOwner : null;
    return contaminatedBackupType && (info.LoggedBackupAdsByType || (info.LoggedBackupAdsByType = /* @__PURE__ */ new Set()), info.LoggedBackupAdsByType.add(contaminatedBackupType), _markBackupPlayerRetryCooldown(info, contaminatedBackupType, "ad-marked"), info.BackupEncodingsM3U8Cache && (info.BackupEncodingsM3U8Cache[contaminatedBackupType] = null), info.LastCleanBackupPlayerType === contaminatedBackupType && (info.LastCleanBackupM3U8 = null, info.LastCleanBackupPlayerType = null, info.LastCleanBackupResolution = null, info.LastCleanBackupCodecFamily = null, info.LastCleanBackupCodec = null, info.LastCleanBackupAt = 0)), info.ActiveBackupPlayerType === contaminatedBackupType && (info.ActiveBackupPlayerType = null, info.IsUsingBackupStream = !1), info._LastBackupSearchCompletedAt = 0, _findBackupStream(info, realFetch, 0, _resolveAdBackupTargetResolution(info, url) || res).catch(() => {
    }), _stripAds(text, !0, info);
  }
  const backupRequiresNativeRestoreReload = (backupPlayerType, _backupResolution) => {
    const enhancedDecoderCodecFamily = _getVideoCodecFamily(info.EnhancedDecoderCodecFamily) || _getVideoCodecFamily(info.SustainedNativeResolution?.Codecs), enhancedDecoderCodecIdentity = _getVideoCodecIdentity(info.EnhancedDecoderCodec) || _getVideoCodecIdentity(info.SustainedNativeResolution?.Codecs), backupCodecFamily = _getVideoCodecFamily(info.LastCleanBackupCodecFamily), backupCodecIdentity = _getVideoCodecIdentity(info.LastCleanBackupCodec);
    return backupPlayerType === "autoplay" ? !0 : !!(enhancedDecoderCodecFamily && !(!enhancedDecoderCodecFamily || backupCodecFamily === enhancedDecoderCodecFamily && enhancedDecoderCodecIdentity && backupCodecIdentity === enhancedDecoderCodecIdentity));
  }, enterSilentBackupHold = (enteredAt, heldBackupPlayerType, heldBackupResolution) => {
    _resetNativeRecoveryCandidateState(info), info.IsShowingAd = !1, info.IsHoldingBackupAfterAd = !0, info.SilentBackupHoldStartedAt = enteredAt, info.LastSilentBackupHoldLogAt = enteredAt, info.IsUsingBackupStream = !0, info.ActiveBackupPlayerType = heldBackupPlayerType, info.ActiveBackupResolution = heldBackupResolution || null, info.HevcReloadPendingAfterHold = !!(info.HevcReloadPendingAfterHold || info.IsUsingModifiedM3U8 || backupRequiresNativeRestoreReload(heldBackupPlayerType, heldBackupResolution)), heldBackupPlayerType && (__TTVAB_STATE__.PinnedBackupPlayerType = heldBackupPlayerType, __TTVAB_STATE__.PinnedBackupPlayerChannel = info.ChannelName || null, __TTVAB_STATE__.PinnedBackupPlayerMediaKey = info.MediaKey || null, typeof self < "u" && self.postMessage && _postWorkerBridgeMessage(self, _createPageScopedWorkerEvent({
      key: "BackupPlayerTypeSelected",
      value: heldBackupPlayerType,
      channel: info.ChannelName,
      mediaKey: info.MediaKey,
      cycleStartedAt: Math.max(0, Number(info.VisibleAdStartedAt) || 0)
    }))), info._AdRequestController && (info._AdRequestController.abort(), info._AdRequestController = null), _rememberLastAdEnd(info, enteredAt, info.VisibleAdStartedAt);
  };
  if (!hasAds && hasMediaSegments && !info.IsShowingAd) {
    if (!info.IsHoldingBackupAfterAd && (info.LastCleanNativeM3U8 = text, info.LastCleanNativeUrl = url, info.LastCleanNativeCodec = directResolution?.Codecs || res?.Codecs || null, info.LastCleanNativePlaylistAt = Date.now(), info.LastCleanNativeLoaderEpoch = Math.max(0, Number(info.NativeRecoveryLoaderEpoch) || 0), info.MediaType !== "vod" && !isBackupUrl && !info.IsUsingBackupStream && directResolution?.Url === _getMediaPlaylistSessionKey(url) && directResolution.Resolution === info.SustainedNativeResolution?.Resolution && info.EncodingsM3U8 && info.UsherBaseUrl && _normalizeMediaKey(__TTVAB_STATE__.PageMediaKey) === info.MediaKey)) {
      const saved = info._NativePlaybackMaster, savedHeight = Math.max(0, ...(saved?.resolutionList || []).map((entry) => Number(String(entry.Resolution || "").split("x")[1]) || 0)), currentHeight = Math.max(0, ...info.ResolutionList.map((entry) => Number(String(entry.Resolution || "").split("x")[1]) || 0));
      (!saved || saved.mediaKey !== info.MediaKey || saved.pageGeneration !== (Number(__TTVAB_STATE__.PagePlaybackContextGeneration) || 0) || currentHeight > savedHeight || currentHeight === savedHeight && info.ResolutionList.length >= saved.resolutionList.length) && (info._NativePlaybackMaster = {
        master: info.EncodingsM3U8,
        masterUrl: info.UsherBaseUrl,
        resolutionList: info.ResolutionList.slice(),
        mediaKey: info.MediaKey,
        pageGeneration: Number(__TTVAB_STATE__.PagePlaybackContextGeneration) || 0,
        observedAt: Date.now()
      });
    }
    const confirmation = info._PendingNativeReloadConfirmation, currentLoaderEpoch = Math.max(0, Number(info.NativeRecoveryLoaderEpoch) || 0);
    if (confirmation && !confirmation.confirmed && requestAdContext && Number(requestAdContext.requestStartedAt) >= confirmation.reloadAt && !isBackupUrl && isExactCurrentNativeVariant && directResolution && !info.IsHoldingBackupAfterAd && !info.IsUsingModifiedM3U8 && !info.IsUsingFallbackStream && !info.IsUsingBackupStream && _getMediaPlaylistSessionKey(info.LastCleanNativeUrl) === exactRequestUrl && Math.max(0, Number(info.LastCleanNativeLoaderEpoch) || 0) === currentLoaderEpoch && Math.max(0, Number(requestAdContext.loaderEpoch) || 0) === currentLoaderEpoch && (requestAdContext.nativeReloadToConfirm = { confirmation, playlist: text }), info.IsHoldingBackupAfterAd) {
      let adEndState = "wait";
      try {
        adEndState = await _isAdEndStable(info, realFetch, res, requestAdContext, requestSignal, text, url, !isBackupUrl);
      } catch {
        _assertM3U8RequestContextCurrent(info, requestAdContext, requestSignal);
      }
      if (adEndState === "ended") {
        const restoredAt = Date.now(), exactNativeRecoveryReady = requestAdContext?.exactNativeRecoveryReady === !0, exactNativeRecoveryOwned = requestAdContext?.exactNativeRecoveryOwned === !0, verifiedNativeRecoveryTarget = requestAdContext?.verifiedNativeRecoveryTarget, restoredCycleStartedAt = Math.max(0, Number(info.VisibleAdStartedAt) || 0), enhancedDecoderCodecFamily = _getVideoCodecFamily(info.EnhancedDecoderCodecFamily), enhancedDecoderCodecIdentity = _getVideoCodecIdentity(info.EnhancedDecoderCodec), backupCodecFamily = _getVideoCodecFamily(info.LastCleanBackupCodecFamily), backupCodecIdentity = _getVideoCodecIdentity(info.LastCleanBackupCodec), continuePlayback = _canRestoreNativeByPlaylist(info, url, text, requestAdContext), requiresReload = !!(!continuePlayback && (info.HevcReloadPendingAfterHold || info.IsUsingModifiedM3U8 || enhancedDecoderCodecFamily && (backupCodecFamily !== enhancedDecoderCodecFamily || !enhancedDecoderCodecIdentity || backupCodecIdentity !== enhancedDecoderCodecIdentity))), pendingPostAdNativeMaster2 = (requiresReload || continuePlayback) && exactNativeRecoveryOwned && info.MediaType !== "vod" && typeof info.EncodingsM3U8 == "string" && info.EncodingsM3U8 && typeof info.UsherBaseUrl == "string" && info.UsherBaseUrl && exactRequestUrl ? {
          master: verifiedNativeRecoveryTarget?.master || info.EncodingsM3U8,
          masterUrl: verifiedNativeRecoveryTarget?.masterUrl || info.UsherBaseUrl,
          playlistUrl: verifiedNativeRecoveryTarget?.playlistUrl || exactRequestUrl,
          codec: verifiedNativeRecoveryTarget?.codec || info.Urls?.[verifiedNativeRecoveryTarget?.playlistUrl || exactRequestUrl]?.Codecs || null,
          resolution: verifiedNativeRecoveryTarget?.resolution || info.Urls?.[verifiedNativeRecoveryTarget?.playlistUrl || exactRequestUrl]?.Resolution || null,
          mediaKey: info.MediaKey,
          cycleStartedAt: restoredCycleStartedAt,
          expiresAt: restoredAt + 3e4,
          pageGeneration: Math.max(0, Number(__TTVAB_STATE__.PagePlaybackContextGeneration) || 0),
          masterServedAt: 0,
          reloadAt: 0,
          reloadCount: 0,
          consumed: continuePlayback
        } : null;
        return exactNativeRecoveryReady && (info.LastCleanNativeM3U8 = text, info.LastCleanNativeUrl = url, info.LastCleanNativeCodec = directResolution?.Codecs || res?.Codecs || null, info.LastCleanNativePlaylistAt = restoredAt, info.LastCleanNativeLoaderEpoch = Math.max(0, Number(info.NativeRecoveryLoaderEpoch) || 0)), _resetStreamAdState(info, !0), info._PendingPostAdNativeMaster = pendingPostAdNativeMaster2, __TTVAB_STATE__.CurrentAdChannel = null, __TTVAB_STATE__.CurrentAdMediaKey = null, __TTVAB_STATE__.PinnedBackupPlayerType = null, __TTVAB_STATE__.PinnedBackupPlayerChannel = null, __TTVAB_STATE__.PinnedBackupPlayerMediaKey = null, _rememberLastAdEnd(info, restoredAt, restoredCycleStartedAt), _reportPostAdNativeSession(info, "prepared"), typeof self < "u" && self.postMessage && _postWorkerBridgeMessage(self, _createPageScopedWorkerEvent({
          key: "NativePlaybackRestored",
          channel: info.ChannelName,
          mediaKey: info.MediaKey,
          cycleStartedAt: restoredCycleStartedAt,
          restoredAt,
          fromSilentBackupHold: !0,
          requiresReload,
          continuePlayback,
          refreshAccessToken: !exactNativeRecoveryOwned
        })), text;
      }
    }
  }
  if (hasAds) {
    info.LastAdPodProgressAt = Date.now(), _resetNativeRecoveryCandidateState(info), info._IncompletePodCleanStartedAt = 0, info._IncompletePodCleanPlaylistCount = 0, info._IncompletePodLastMediaSequence = null, info._IncompletePodCandidateUrl = null, _notifyAdComplete(text, info).catch(() => {
    });
    const backupHoldMaxMs = _getResolvedAdEndBackupHoldMaxMs(), visibleAdStartedAt = Math.max(0, Number(info.VisibleAdStartedAt) || 0), visibleAdElapsed = visibleAdStartedAt > 0 ? Date.now() - visibleAdStartedAt : 0;
    if (info.IsShowingAd && info.LastCleanBackupM3U8 && backupHoldMaxMs > 0 && visibleAdElapsed >= backupHoldMaxMs) {
      const adEndedAt = Date.now(), heldBackupPlayerType = info.LastCleanBackupPlayerType || info.ActiveBackupPlayerType || null, endedCodecHandoffId = _getActiveCodecHandoffIdForInfo(info);
      enterSilentBackupHold(adEndedAt, heldBackupPlayerType, info.ActiveBackupResolution || (_resolveAdBackupTargetResolution(info, url) || res)?.Resolution), typeof self < "u" && self.postMessage && _postWorkerBridgeMessage(self, _createPageScopedWorkerEvent({
        key: "AdEnded",
        channel: info.ChannelName,
        mediaKey: info.MediaKey,
        handoffId: endedCodecHandoffId,
        cycleStartedAt: visibleAdStartedAt,
        endedAt: adEndedAt,
        willReload: !1,
        holdingBackup: !0
      }));
    }
  }
  if (info.IsHoldingBackupAfterAd) {
    if (info.LastCleanBackupM3U8) {
      const now = Date.now(), foregroundQualityProbeAt = _getPendingForegroundQualityProbeAt(info), foregroundQualityTarget = foregroundQualityProbeAt || _isBackupProbationDue(info) ? _resolveAdBackupTargetResolution(info, url) || res : null, hadNativeRecoveryEvidence = !!info.PendingAdEndAt || Math.max(0, Number(info.CleanPlaylistCount) || 0) > 0 || Math.max(0, Number(info.NativeRecoveryCleanCount) || 0) > 0;
      hasAds && hadNativeRecoveryEvidence && (info.PendingAdEndAt = 0, info.CleanPlaylistCount = 0, info.AdEndMarkerBounceLogged = !1, info.LastNativeRecoveryHoldLogAt = 0, info.LastAdEndBounceAt = now, info.AdEndConfirmEscalation = (Number(info.AdEndConfirmEscalation) || 0) + 1, _resetNativeRecoveryReadyState(info, !0, !0));
      const lastLogAt = Math.max(0, Number(info.LastSilentBackupHoldLogAt) || 0), holdElapsed = now - Math.max(0, Number(info.SilentBackupHoldStartedAt) || 0), holdMaxMs = _getResolvedSilentBackupHoldMaxMs();
      (holdMaxMs > 0 && holdElapsed >= holdMaxMs && now - lastLogAt >= 15e3 || now - lastLogAt >= 15e3) && (info.LastSilentBackupHoldLogAt = now);
      const stalledDuringHold = (Number(__TTVAB_STATE__?.BackupSearchForceRefreshAt) || 0) > 0;
      if (stalledDuringHold) {
        __TTVAB_STATE__.BackupSearchForceRefreshAt = 0;
        const stalledType = info.ActiveBackupPlayerType || info.LastCleanBackupPlayerType || null;
        stalledType && _markBackupPlayerRetryCooldown(info, stalledType, "stalled");
      }
      const backupAgeMs = now - (Number(info.LastCleanBackupAt) || 0);
      if (!stalledDuringHold && backupAgeMs >= 0 && backupAgeMs < 900 && Number(info.LastCleanBackupAt) >= Math.max(0, Number(info.VisibleAdStartedAt) || 0))
        return (foregroundQualityProbeAt || _isBackupProbationDue(info)) && _startPendingBackupQualityProbe(info, realFetch, foregroundQualityTarget), info.IsUsingBackupStream = !0, info.LastCleanBackupM3U8;
      if (stalledDuringHold || backupAgeMs >= 900) {
        const refreshed = stalledDuringHold ? null : await _awaitM3U8RequestContext(_refreshActiveBackupMediaPlaylist(info, realFetch), info, requestAdContext, requestSignal);
        if (refreshed)
          return (foregroundQualityProbeAt || _isBackupProbationDue(info)) && _startPendingBackupQualityProbe(info, realFetch, foregroundQualityTarget), info.IsUsingBackupStream = !0, refreshed;
        try {
          const refreshedBackup = await _awaitM3U8RequestContext(_findBackupStream(info, realFetch, 0, _resolveAdBackupTargetResolution(info, url) || res), info, requestAdContext, requestSignal);
          if (refreshedBackup?.m3u8)
            return info.IsUsingBackupStream = !0, refreshedBackup.type && (info.ActiveBackupPlayerType = refreshedBackup.type), refreshedBackup.m3u8;
        } catch {
          _assertM3U8RequestContextCurrent(info, requestAdContext, requestSignal);
        }
      }
      return info.IsUsingBackupStream = !1, _stripAds(text, !0, info);
    }
    if (info.IsHoldingBackupAfterAd = !1, info.SilentBackupHoldStartedAt = 0, info.LastSilentBackupHoldLogAt = 0, !hasAds)
      return info.IsHoldingBackupAfterAd = !0, info.SilentBackupHoldStartedAt = Date.now(), _findBackupStream(info, realFetch, 0, _resolveAdBackupTargetResolution(info, url) || res).catch(() => {
      }), _createEmptyAdHoldPlaylist(text, info);
    ensureVisibleAdCycle();
  }
  if (!hasMediaSegments && typeof text == "string" && text.includes("#EXT-X-ENDLIST")) {
    info._LoggedOfflineTransition || (info._LoggedOfflineTransition = !0);
    const cachedBackupAgeMs = Date.now() - (Number(info.LastCleanBackupAt) || 0);
    if (info.LastCleanBackupM3U8 && cachedBackupAgeMs >= 0 && cachedBackupAgeMs < 900 && Number(info.LastCleanBackupAt) >= Math.max(0, Number(info.VisibleAdStartedAt) || 0))
      return info.IsUsingBackupStream = !0, info.LastCleanBackupM3U8;
    if (info.IsUsingBackupStream = !1, info.IsShowingAd || info.IsHoldingBackupAfterAd || hasAds) {
      const offlineTarget = _resolveAdBackupTargetResolution(info, url) || res;
      return _findBackupStream(info, realFetch, 0, offlineTarget, directResolution?.Codecs || res?.Codecs || null).catch(() => {
      }), _createEmptyAdHoldPlaylist(text, info);
    }
    return text;
  }
  if (hasAds) {
    if (info.PendingAdEndAt || Math.max(0, Number(info.CleanPlaylistCount) || 0) > 0 || Math.max(0, Number(info.NativeRecoveryCleanCount) || 0) > 0) {
      info.PendingAdEndAt = 0, info.CleanPlaylistCount = 0, info.AdEndMarkerBounceLogged = !1, info.LastNativeRecoveryHoldLogAt = 0, _resetNativeRecoveryReadyState(info, !0, !0);
      const now = Date.now(), debounced = await _awaitM3U8RequestContext(_serveBounceDebouncedPlaylist(info, realFetch, text, now), info, requestAdContext, requestSignal);
      if (debounced !== null)
        return info.IsUsingBackupStream = !0, debounced;
      info.LastAdEndBounceAt = now, info.AdEndConfirmEscalation = (Number(info.AdEndConfirmEscalation) || 0) + 1;
    }
    if (info.IsMidroll = text.includes('"MIDROLL"') || text.includes('"midroll"'), !info.IsMidroll) {
      const lines = (typeof text == "string" ? text : "").replace(/\r/g, "").split(`
`);
      for (let j = 0; j < lines.length; j++) {
        const line = lines[j];
        let mediaUrl = "";
        if (line.startsWith("#EXTINF") && lines.length > j + 1) {
          if (line.includes(",live"))
            continue;
          mediaUrl = lines[j + 1] || "";
        } else (_isMediaPartLine(line) || _isPartPreloadHintLine(line)) && (mediaUrl = _getTaggedPlaylistUri(line));
        if (mediaUrl && !mediaUrl.startsWith("#") && !info.RequestedAds.has(mediaUrl)) {
          info.RequestedAds.add(mediaUrl), info._AdRequestController && info._AdRequestController.abort();
          const controller = new AbortController();
          info._AdRequestController = controller;
          try {
            realFetch(mediaUrl, { signal: controller.signal }).then((r) => r.blob()).catch(() => {
            });
          } catch {
          }
          break;
        }
      }
    }
    if (info.IsUsingFallbackStream) {
      const preserveEnhancedLive = isEnhancedCodec && !!info.ModifiedM3U8;
      return text = _stripAds(text, preserveEnhancedLive, info, !1, preserveEnhancedLive), text;
    }
    if (!info.CsaiOnlyThisBreak && !info.IsUsingModifiedM3U8) {
      let hasNonLiveSegment = !1;
      const segLines = text.split(`
`);
      for (let si = 0; si < segLines.length; si++)
        if (segLines[si]?.startsWith("#EXTINF") && !segLines[si].includes(",live")) {
          hasNonLiveSegment = !0;
          break;
        }
      if (!hasNonLiveSegment) {
        if (info.CsaiOnlyThisBreak = !0, !info._BackupSearchStartedAt && !info.IsUsingFallbackStream) {
          const res2 = _resolveAdBackupTargetResolution(info, url), searchStartToken = {}, searchStartEpoch = Math.max(0, Number(info.BackupSearchEpoch) || 0);
          info._BackupSearchStartToken = searchStartToken, info._BackupSearchStartedAt = Date.now();
          const clearOwnedSearchStart = () => {
            info._BackupSearchStartToken === searchStartToken && Math.max(0, Number(info.BackupSearchEpoch) || 0) === searchStartEpoch && (info._BackupSearchStartToken = null, info._BackupSearchStartedAt = 0);
          };
          _findBackupStream(info, realFetch, 0, res2).then(clearOwnedSearchStart).catch(clearOwnedSearchStart);
        }
        return (_isRecentPostAdReentry(info) ? null : _getSameRequestCleanNative(info, url, directResolution?.Codecs || res?.Codecs || null, isEnhancedCodec, 2e3)) || _stripAds(text, !1, info);
      }
    }
    if (_getSameRequestCleanNative(info, url, directResolution?.Codecs || res?.Codecs || null, isEnhancedCodec, 2e3) !== null && !_isRecentPostAdReentry(info)) {
      if (!info._BackupSearchStartedAt && !info.IsUsingFallbackStream) {
        const prewarmTargetRes = _resolveAdBackupTargetResolution(info, url), searchStartToken = {}, searchStartEpoch = Math.max(0, Number(info.BackupSearchEpoch) || 0);
        info._BackupSearchStartToken = searchStartToken, info._BackupSearchStartedAt = Date.now();
        const clearOwnedSearchStart = () => {
          info._BackupSearchStartToken === searchStartToken && Math.max(0, Number(info.BackupSearchEpoch) || 0) === searchStartEpoch && (info._BackupSearchStartToken = null, info._BackupSearchStartedAt = 0);
        };
        _findBackupStream(info, realFetch, 0, prewarmTargetRes).then(clearOwnedSearchStart).catch(clearOwnedSearchStart);
      }
      if (!(typeof info.LastCleanBackupM3U8 == "string" && info.LastCleanBackupM3U8 && Date.now() - (Number(info.LastCleanBackupAt) || 0) < 5e3 && Number(info.LastCleanBackupAt) >= Math.max(0, Number(info.VisibleAdStartedAt) || 0)))
        return info.LastCleanNativeM3U8;
    }
    if (info.CsaiOnlyThisBreak && info._BackupSearchStartedAt > 0 && info.MediaType === "live" && !isEnhancedCodec && !info.EnhancedDecoderCodecFamily && !info.EnhancedDecoderCodec && _getVideoCodecFamily(directResolution?.Codecs || res?.Codecs) === "avc" && !(info.LastCleanBackupM3U8 && Number(info.LastCleanBackupAt) >= Number(info.VisibleAdStartedAt) && Date.now() - Number(info.LastCleanBackupAt) >= 0 && Date.now() - Number(info.LastCleanBackupAt) < 900))
      return _stripAds(text, !1, info);
    let startIdx = 0;
    info.LastPlayerReload > Date.now() - __TTVAB_STATE__.PlayerReloadMinimalRequestsTime && (startIdx = __TTVAB_STATE__.PlayerReloadMinimalRequestsPlayerIndex);
    const earlyBackupRetry = _getEarlyNoBackupRetry(info, startIdx, directResolution?.Codecs || res?.Codecs || null);
    if (earlyBackupRetry)
      return _startEarlyNoBackupRetry(info, realFetch, startIdx, _resolveAdBackupTargetResolution(info, url) || res, null, earlyBackupRetry), _stripAds(text, !1, info);
    if (info._LastBackupSearchCompletedAt && Date.now() - info._LastBackupSearchCompletedAt < 15e3 && !_isRecentPostAdReentry(info) && !_getPendingForegroundQualityProbeAt(info) && !_isBackupProbationDue(info)) {
      const forceRefreshAt = Number(__TTVAB_STATE__?.BackupSearchForceRefreshAt) || 0, cacheStamp = info._LastBackupSearchCompletedAt || 0;
      if (forceRefreshAt > 0 && forceRefreshAt >= cacheStamp - 1) {
        __TTVAB_STATE__.BackupSearchForceRefreshAt = 0, info._LastBackupSearchCompletedAt = 0;
        const stalledType = typeof info.ActiveBackupPlayerType == "string" && info.ActiveBackupPlayerType || typeof __TTVAB_STATE__.PinnedBackupPlayerType == "string" && __TTVAB_STATE__.PinnedBackupPlayerType || null;
        stalledType && _markBackupPlayerRetryCooldown(info, stalledType, "stalled");
      } else if (info.LastCleanBackupM3U8) {
        const backupAgeMs = Date.now() - (Number(info.LastCleanBackupAt) || 0), backupIsFromCurrentCycle = Number(info.LastCleanBackupAt) >= Math.max(0, Number(info.VisibleAdStartedAt) || 0);
        if (backupAgeMs >= 900 || !backupIsFromCurrentCycle) {
          const refreshed = await _awaitM3U8RequestContext(_refreshActiveBackupMediaPlaylist(info, realFetch), info, requestAdContext, requestSignal);
          if (refreshed)
            return info.IsUsingBackupStream = !0, refreshed;
          info._LastBackupSearchCompletedAt = 0;
        } else
          return info.IsUsingBackupStream = !0, info.LastCleanBackupM3U8;
      } else if (isEnhancedCodec && info.ModifiedM3U8)
        info._LastBackupSearchCompletedAt = 0;
      else
        return _stripAds(text, !1, info);
    }
    if (_isRecentPostAdReentry(info) && info.LastCleanBackupM3U8 && info.ActiveBackupPlayerType && info.ActiveBackupPlayerType !== "autoplay")
      if ((Number(__TTVAB_STATE__?.BackupSearchForceRefreshAt) || 0) > 0)
        __TTVAB_STATE__.BackupSearchForceRefreshAt = 0, _markBackupPlayerRetryCooldown(info, info.ActiveBackupPlayerType, "stalled");
      else {
        const reentryBackupAgeMs = Date.now() - (Number(info.LastCleanBackupAt) || 0);
        if (reentryBackupAgeMs >= 0 && reentryBackupAgeMs < 900 && Number(info.LastCleanBackupAt) >= Math.max(0, Number(info.VisibleAdStartedAt) || 0))
          return info.IsUsingBackupStream = !0, info.LastCleanBackupM3U8;
        const reentryRefreshStartedAt = Date.now(), reentryRefreshed = await _awaitM3U8RequestContext(_refreshActiveBackupMediaPlaylist(info, realFetch), info, requestAdContext, requestSignal);
        if (reentryRefreshed)
          return info.IsUsingBackupStream = !0, reentryRefreshed;
      }
    const backupTargetRes = _resolveAdBackupTargetResolution(info, url) || res;
    if (__TTVAB_STATE__.DisableAutoplayBackup === !0 && info.MediaType === "live" && info._EmptyAdHoldMediaSequence > 0 && info._LastBackupSearchCompletedAt >= info.VisibleAdStartedAt && info.VisibleAdStartedAt > 0 && !info.LastCleanBackupM3U8 && !info.IsUsingBackupStream && !info.IsUsingModifiedM3U8 && !info.EnhancedDecoderCodecFamily && !info.EnhancedDecoderCodec && _getVideoCodecFamily(directResolution?.Codecs || res?.Codecs) === "avc" && _normalizeMediaKey(__TTVAB_STATE__.PageMediaKey) === _normalizeMediaKey(info.MediaKey)) {
      if (!info._BackupSearchPromise && !info._BackupSearchPromises?.size) {
        const searchStartToken = {}, searchStartEpoch = Number(info.BackupSearchEpoch) || 0, searchCycleStartedAt = Number(info.VisibleAdStartedAt) || 0, searchPageGeneration = Number(__TTVAB_STATE__.PagePlaybackContextGeneration) || 0, searchMediaKey = _normalizeMediaKey(info.MediaKey), previousSearchCompletedAt = info._LastBackupSearchCompletedAt;
        info._BackupSearchStartToken = searchStartToken, info._BackupSearchStartedAt = Date.now();
        const finishSearch = (result = null) => {
          info._BackupSearchStartToken === searchStartToken && (info._BackupSearchStartToken = null, info._BackupSearchStartedAt = 0, __TTVAB_STATE__.IsAdStrippingEnabled === !0 && __TTVAB_STATE__.DisableAutoplayBackup === !0 && _normalizeMediaKey(__TTVAB_STATE__.PageMediaKey) === searchMediaKey && (Number(__TTVAB_STATE__.PagePlaybackContextGeneration) || 0) === searchPageGeneration && info._LastBackupSearchCompletedAt === previousSearchCompletedAt && _isBackupSearchContextCurrent(info, searchStartEpoch, searchCycleStartedAt) && (info._LastBackupSearchCompletedAt = result?.m3u8 ? 0 : Date.now()));
        };
        _findBackupStream(info, realFetch, startIdx, backupTargetRes).then(finishSearch, (error) => {
          finishSearch();
        });
      }
      return _stripAds(text, !1, info);
    }
    const previousSelectionSequence = info._BackupSelection?.sequence || 0;
    let { type: backupType, m3u8: backupM3u8 } = await _awaitM3U8RequestContext(_findBackupStream(info, realFetch, startIdx, backupTargetRes), info, requestAdContext, requestSignal), isFallback = !1;
    if (!backupM3u8 && (info._BackupSelection?.sequence || 0) > previousSelectionSequence && Date.now() - (Number(info.LastCleanBackupAt) || 0) >= 900) {
      if (backupM3u8 = await _awaitM3U8RequestContext(_refreshActiveBackupMediaPlaylist(info, realFetch), info, requestAdContext, requestSignal), !backupM3u8)
        throw _createCodecHandoffAbortError(requestSignal);
      backupType = info.LastCleanBackupPlayerType;
    }
    if (!backupM3u8) {
      const cachedBackupAgeMs = Date.now() - (Number(info.LastCleanBackupAt) || 0), recentCachedBackup = !!(info.LastCleanBackupM3U8 && cachedBackupAgeMs >= 0 && cachedBackupAgeMs < 900 && Number(info.LastCleanBackupAt) >= Math.max(0, Number(info.VisibleAdStartedAt) || 0)), recentSameRequestNative = _getSameRequestCleanNative(info, url, directResolution?.Codecs || res?.Codecs || null, isEnhancedCodec, 2e3, info.EnhancedDecoderCodec || info.EnhancedDecoderCodecFamily);
      recentCachedBackup ? (backupM3u8 = info.LastCleanBackupM3U8, backupType = info.LastCleanBackupPlayerType || __TTVAB_STATE__.FallbackPlayerType) : recentSameRequestNative && (backupM3u8 = recentSameRequestNative, backupType = __TTVAB_STATE__.FallbackPlayerType, isFallback = !0);
    }
    isFallback && (info.IsUsingFallbackStream = !0), backupM3u8 && (info.IsUsingBackupStream = !0, text = backupM3u8), info.ActiveBackupResolution = backupM3u8 && backupM3u8 === info.LastCleanBackupM3U8 && backupType === info.LastCleanBackupPlayerType && info.LastCleanBackupResolution || null, backupM3u8 && backupRequiresNativeRestoreReload(backupType, info.ActiveBackupResolution) && (info.HevcReloadPendingAfterHold = !0), backupType && (__TTVAB_STATE__.PinnedBackupPlayerType = backupType, __TTVAB_STATE__.PinnedBackupPlayerChannel = info.ChannelName || null, __TTVAB_STATE__.PinnedBackupPlayerMediaKey = info.MediaKey || null), info.ActiveBackupPlayerType !== backupType && (info.ActiveBackupPlayerType = backupType, backupType && typeof self < "u" && self.postMessage && _postWorkerBridgeMessage(self, _createPageScopedWorkerEvent({
      key: "BackupPlayerTypeSelected",
      value: backupType,
      channel: info.ChannelName,
      mediaKey: info.MediaKey,
      cycleStartedAt: Math.max(0, Number(info.VisibleAdStartedAt) || 0)
    }))), info._LastBackupSearchCompletedAt = Date.now(), backupM3u8 ? __TTVAB_STATE__.IsAdStrippingEnabled && (requestAdContext && (requestAdContext.backupMetadata = info.BackupPlaylistMetadata?.get?.(backupM3u8) || (backupM3u8 === info.LastCleanBackupM3U8 ? { ambiguous: !0 } : null)), text = _stripAds(text, !1, info)) : isEnhancedCodec && info.ModifiedM3U8 ? text = _stripAds(text, !0, info, !1, !0) : __TTVAB_STATE__.IsAdStrippingEnabled && (text = _stripAds(text, !1, info));
  } else if (info.IsShowingAd) {
    const res2 = _resolveAdBackupTargetResolution(info, url);
    if (!hasMediaSegments && typeof text == "string" && text.includes("#EXT-X-ENDLIST")) {
      info._LoggedOfflineTransition || (info._LoggedOfflineTransition = !0);
      const offlineBackupAgeMs = Date.now() - (Number(info.LastCleanBackupAt) || 0);
      return info.LastCleanBackupM3U8 && offlineBackupAgeMs >= 0 && offlineBackupAgeMs < 900 && Number(info.LastCleanBackupAt) >= Math.max(0, Number(info.VisibleAdStartedAt) || 0) ? (info.IsUsingBackupStream = !0, info.LastCleanBackupM3U8) : (info.IsUsingBackupStream = !1, _findBackupStream(info, realFetch, 0, _resolveAdBackupTargetResolution(info, url), directResolution?.Codecs || res2?.Codecs || null).catch(() => {
      }), _createEmptyAdHoldPlaylist(text, info));
    }
    let adEndState = "wait";
    try {
      adEndState = await _isAdEndStable(info, realFetch, res2, requestAdContext, requestSignal, text, url, !isBackupUrl);
    } catch {
      _assertM3U8RequestContextCurrent(info, requestAdContext, requestSignal), adEndState = "wait";
    }
    if (adEndState === "wait") {
      const backupAgeMs = Date.now() - (Number(info.LastCleanBackupAt) || 0), backupIsFromCurrentCycle = Number(info.LastCleanBackupAt) > Number(info.VisibleAdStartedAt), stallRequestedAt = Number(__TTVAB_STATE__?.BackupSearchForceRefreshAt) || 0, stalledDuringWait = stallRequestedAt > 0 && stallRequestedAt <= Date.now() && stallRequestedAt >= Math.max(Number(info.VisibleAdStartedAt) || 0, Number(info._LastBackupSearchCompletedAt) || 0) && _normalizeMediaKey(__TTVAB_STATE__.CurrentAdMediaKey) === info.MediaKey && _normalizeMediaKey(__TTVAB_STATE__.PinnedBackupPlayerMediaKey) === info.MediaKey;
      if (stalledDuringWait) {
        __TTVAB_STATE__.BackupSearchForceRefreshAt = 0;
        const stalledType = info.ActiveBackupPlayerType || info.LastCleanBackupPlayerType || null;
        stalledType && _markBackupPlayerRetryCooldown(info, stalledType, "stalled");
      }
      const foregroundQualityProbeAt = _getPendingForegroundQualityProbeAt(info);
      if (info.LastCleanBackupM3U8 && (stalledDuringWait || backupAgeMs >= 900)) {
        const refreshed = stalledDuringWait ? null : await _awaitM3U8RequestContext(_refreshActiveBackupMediaPlaylist(info, realFetch), info, requestAdContext, requestSignal);
        if (refreshed)
          return (foregroundQualityProbeAt || _isBackupProbationDue(info)) && _startPendingBackupQualityProbe(info, realFetch, res2, directResolution?.Codecs || res2?.Codecs || null), info.IsUsingBackupStream = !0, refreshed;
        if (stalledDuringWait || backupIsFromCurrentCycle)
          try {
            const refreshedBackup = await _awaitM3U8RequestContext(_findBackupStream(info, realFetch, 0, res2), info, requestAdContext, requestSignal);
            if (stalledDuringWait && (info._LastBackupSearchCompletedAt = Date.now()), refreshedBackup?.m3u8)
              return info.IsUsingBackupStream = !0, refreshedBackup.type && (info.ActiveBackupPlayerType = refreshedBackup.type), refreshedBackup.m3u8;
          } catch {
            _assertM3U8RequestContextCurrent(info, requestAdContext, requestSignal);
          }
      }
      if (!stalledDuringWait && info.LastCleanBackupM3U8 && backupIsFromCurrentCycle && !_isBackupPlayerRetryCoolingDown(info, info.LastCleanBackupPlayerType || info.ActiveBackupPlayerType) && backupAgeMs >= 0 && backupAgeMs < 900)
        return (foregroundQualityProbeAt || _isBackupProbationDue(info)) && _startPendingBackupQualityProbe(info, realFetch, res2, directResolution?.Codecs || res2?.Codecs || null), info.IsUsingBackupStream = !0, info.LastCleanBackupM3U8;
      info.IsUsingBackupStream = !1;
      const now = Date.now(), lastBackupSearchCompletedAt = Math.max(0, Number(info._LastBackupSearchCompletedAt) || 0), forceRefreshAt = Math.max(0, Number(__TTVAB_STATE__?.BackupSearchForceRefreshAt) || 0), backupSearchIsInFlight = !!(info._BackupSearchPromise || info._BackupSearchPromises?.size > 0), earlyBackupRetry = _getEarlyNoBackupRetry(info, 0, directResolution?.Codecs || res2?.Codecs || null);
      if (earlyBackupRetry)
        _startEarlyNoBackupRetry(info, realFetch, 0, res2, directResolution?.Codecs || res2?.Codecs || null, earlyBackupRetry);
      else if (!backupSearchIsInFlight && (foregroundQualityProbeAt > 0 || _isBackupProbationDue(info) || lastBackupSearchCompletedAt <= 0 || now - lastBackupSearchCompletedAt >= 15e3 || forceRefreshAt > lastBackupSearchCompletedAt)) {
        const backupSearchEpoch = Math.max(0, Number(info.BackupSearchEpoch) || 0), cycleStartedAt = Math.max(0, Number(info.VisibleAdStartedAt) || 0), markBackupSearchCompleted = () => {
          _isBackupSearchContextCurrent(info, backupSearchEpoch, cycleStartedAt) && (info._LastBackupSearchCompletedAt = Date.now());
        };
        _findBackupStream(info, realFetch, 0, res2, directResolution?.Codecs || res2?.Codecs || null).then(markBackupSearchCompleted, markBackupSearchCompleted);
      }
      return _createEmptyAdHoldPlaylist(text, info);
    }
    const adEndedAt = Date.now(), endedCycleStartedAt = Math.max(0, Number(info.VisibleAdStartedAt) || 0), isSilentBackupHoldEnd = adEndState === "ended-with-backup-hold", candidateHeldBackupPlayerType = info.LastCleanBackupPlayerType || info.ActiveBackupPlayerType || null;
    let heldBackupM3U8 = null;
    if (isSilentBackupHoldEnd) {
      const lastCleanBackupAt = Math.max(0, Number(info.LastCleanBackupAt) || 0), heldBackupAgeMs = Date.now() - lastCleanBackupAt;
      if (info.LastCleanBackupM3U8 && lastCleanBackupAt >= endedCycleStartedAt && heldBackupAgeMs >= 0 && heldBackupAgeMs < 900 ? heldBackupM3U8 = info.LastCleanBackupM3U8 : heldBackupM3U8 = await _awaitM3U8RequestContext(candidateHeldBackupPlayerType === "autoplay" ? _refreshHeldAutoplayBackupPlaylist(info, realFetch, res2) : _refreshActiveBackupMediaPlaylist(info, realFetch), info, requestAdContext, requestSignal), !heldBackupM3U8)
        return info.IsUsingBackupStream = !1, info._LastBackupSearchCompletedAt = 0, _findBackupStream(info, realFetch, 0, res2).catch(() => {
        }), _createEmptyAdHoldPlaylist(text, info);
    }
    const heldBackupPlayerType = isSilentBackupHoldEnd ? candidateHeldBackupPlayerType : null, heldBackupResolution = isSilentBackupHoldEnd && info.ActiveBackupResolution || null, endedCodecHandoffId = _getActiveCodecHandoffIdForInfo(info), transitionState = {
      wasUsingModifiedM3U8: !!info.IsUsingModifiedM3U8,
      wasUsingFallbackStream: !!info.IsUsingFallbackStream,
      wasUsingBackupStream: !!info.IsUsingBackupStream,
      hadStrippedAdSegments: Math.max(0, Number(info.NumStrippedAdSegments) || 0) > 0
    };
    isSilentBackupHoldEnd && heldBackupM3U8 ? enterSilentBackupHold(adEndedAt, heldBackupPlayerType, heldBackupResolution || (_resolvePreferredBackupResolution(info) || res2)?.Resolution || null) : (_resetStreamAdState(info, !0), __TTVAB_STATE__.CurrentAdChannel = null, __TTVAB_STATE__.CurrentAdMediaKey = null, __TTVAB_STATE__.PinnedBackupPlayerType = null, __TTVAB_STATE__.PinnedBackupPlayerChannel = null, __TTVAB_STATE__.PinnedBackupPlayerMediaKey = null);
    const { wasUsingModifiedM3U8, wasUsingFallbackStream, wasUsingBackupStream, hadStrippedAdSegments } = transitionState;
    if (typeof self < "u" && self.postMessage) {
      const shouldUseHevcReload = !!wasUsingModifiedM3U8, recentPostEscapeReload = info.LastAdEndReloadKind === "post-escape" && info.LastAdEndReloadAt > 0 && adEndedAt - info.LastAdEndReloadAt < 3e4;
      recentPostEscapeReload && (info.PostEscapeReloadCounterproductive = !0);
      const isCsaiBreak = !hadStrippedAdSegments && !wasUsingModifiedM3U8;
      let shouldReloadPlayer = !1, shouldPauseResumePlayer = !1, reloadKind = "post-ad";
      const needsHardReload = shouldUseHevcReload, reuseExactNativeSession = !needsHardReload && requestAdContext?.exactNativeRecoveryOwned === !0;
      isCsaiBreak ? wasUsingBackupStream && !recentPostEscapeReload && !isSilentBackupHoldEnd && (info.PostEscapeReloadCounterproductive ? shouldPauseResumePlayer = !0 : (shouldReloadPlayer = !0, reloadKind = "post-escape")) : isSilentBackupHoldEnd || (shouldReloadPlayer = !!(shouldUseHevcReload || _C?.RELOAD_AFTER_AD !== !1 && hadStrippedAdSegments && !recentPostEscapeReload), shouldPauseResumePlayer = !shouldReloadPlayer && !wasUsingFallbackStream), recentPostEscapeReload || (info.PostEscapeReloadCounterproductive = !1), _postWorkerBridgeMessage(self, _createPageScopedWorkerEvent({
        key: "AdEnded",
        channel: info.ChannelName,
        mediaKey: info.MediaKey,
        handoffId: endedCodecHandoffId,
        cycleStartedAt: endedCycleStartedAt,
        endedAt: adEndedAt,
        willReload: shouldReloadPlayer,
        holdingBackup: isSilentBackupHoldEnd
      })), shouldReloadPlayer ? (info.LastPlayerReload = Date.now(), info.LastAdEndReloadKind = reloadKind, _postWorkerBridgeMessage(self, _createPageScopedWorkerEvent({
        key: "ReloadPlayer",
        channel: info.ChannelName,
        mediaKey: info.MediaKey,
        reason: reloadKind,
        cycleStartedAt: endedCycleStartedAt,
        refreshAccessToken: !reuseExactNativeSession,
        newMediaPlayerInstance: needsHardReload
      }))) : shouldPauseResumePlayer ? (info.LastAdEndReloadKind = null, _postWorkerBridgeMessage(self, _createPageScopedWorkerEvent({
        key: "PauseResumePlayer",
        channel: info.ChannelName,
        mediaKey: info.MediaKey,
        cycleStartedAt: endedCycleStartedAt
      }))) : info.LastAdEndReloadKind = null, _rememberLastAdEnd(info, adEndedAt, endedCycleStartedAt);
    }
    if (isSilentBackupHoldEnd && heldBackupM3U8)
      return heldBackupM3U8;
  }
  return text;
}
function _getFallbackPromotionPolicy({ candidateHasAds, candidateIsPlayable, simulatedAdsDepthSatisfied }) {
  return candidateIsPlayable ? candidateHasAds ? { allowSelectedPromotion: !1, reason: "ad-marked" } : simulatedAdsDepthSatisfied ? { allowSelectedPromotion: !0, reason: "clean-playable" } : { allowSelectedPromotion: !1, reason: "simulated-ads-depth" } : { allowSelectedPromotion: !1, reason: "not-playable" };
}
function _getResolvedLqHqHoldMinMs() {
  return Math.max(0, Number(__TTVAB_STATE__?.LqHqHoldMinMs) || Number(_C?.LQ_HQ_HOLD_MIN_MS) || 0);
}
function _shouldTryAutoplayFirst(info) {
  if (__TTVAB_STATE__?.DisableAutoplayBackup || !(__TTVAB_STATE__?.BackupPlayerTypes || []).includes("autoplay") || _isBackupPlayerRetryCoolingDown(info, "autoplay"))
    return !1;
  const lqHoldStartAt = Number(info?._LqHoldStartAt) || 0, lqHoldMinMs = _getResolvedLqHqHoldMinMs();
  return lqHoldStartAt > 0 && lqHoldMinMs > 0 && Date.now() - lqHoldStartAt < lqHoldMinMs && info?.ActiveBackupPlayerType === "autoplay" ? !0 : info?.ActiveBackupPlayerType ? !1 : !!(info?.IsShowingAd && (Number(info?.VisibleAdStartedAt) || 0) > 0);
}
function _shouldHoldAutoplayBackupDuringAd(info) {
  if (__TTVAB_STATE__?.DisableAutoplayBackup || _isBackupPlayerRetryCoolingDown(info, "autoplay"))
    return !1;
  const lqHoldMinMs = _getResolvedLqHqHoldMinMs(), holdStartedAt = Number(info?._LqHoldStartAt) || 0 || Number(info?.LastCleanBackupAt) || 0, withinLqHoldWindow = lqHoldMinMs > 0 && holdStartedAt > 0 && Date.now() - holdStartedAt < lqHoldMinMs;
  return !!(info?.IsShowingAd && info?.ActiveBackupPlayerType === "autoplay" && info?.LastCleanBackupPlayerType === "autoplay" && typeof info?.LastCleanBackupM3U8 == "string" && info.LastCleanBackupM3U8 && withinLqHoldWindow && (Number(info.LastCleanBackupAt) || 0) >= Math.max(0, Number(info.VisibleAdStartedAt) || 0));
}
function _shouldBridgeHeldAutoplayDuringSearch(info) {
  return _isBackupPlayerRetryCoolingDown(info, "autoplay") || info?.ActiveBackupPlayerType !== "autoplay" || info?.LastCleanBackupPlayerType !== "autoplay" || typeof info?.LastCleanBackupM3U8 != "string" || !info.LastCleanBackupM3U8 ? !1 : info?.IsHoldingBackupAfterAd ? !0 : !!(info?.IsShowingAd && (Number(info.LastCleanBackupAt) || 0) >= Math.max(0, Number(info.VisibleAdStartedAt) || 0));
}
function _getServedBackupBridgeHeight(info) {
  const [, height] = String(info?.LastCleanBackupResolution || "0x0").split("x").map(Number);
  return Number.isFinite(height) && height > 0 ? height : 0;
}
function _shouldHoldBridgeInsteadOfRotating(info, targetRes) {
  if (__TTVAB_STATE__?.DisableAutoplayBackup || !_shouldBridgeHeldAutoplayDuringSearch(info))
    return !1;
  if ((Number(info?._BackupPinFlipCount) || 0) >= 2)
    return !0;
  if (_getPendingForegroundQualityProbeAt(info) > 0)
    return !1;
  const preferredQualityGroup = typeof __TTVAB_STATE__?.PreferredQualityGroup == "string" ? __TTVAB_STATE__.PreferredQualityGroup.trim().toLowerCase() : "", hasExplicitQuality = !!(preferredQualityGroup && preferredQualityGroup !== "auto"), nativeQualityStartedAt = Math.max(0, Number(info?.SustainedNativeResolutionStartedAt) || 0), cycleStartedAt = Math.max(0, Number(info?.VisibleAdStartedAt) || 0);
  if (!hasExplicitQuality && (!nativeQualityStartedAt || !cycleStartedAt || cycleStartedAt - nativeQualityStartedAt < 1e4))
    return !1;
  const [, targetHeight] = String(targetRes?.Resolution || "0x0").split("x").map(Number);
  if (!Number.isFinite(targetHeight) || targetHeight <= 0)
    return !1;
  const bridgeHeight = _getServedBackupBridgeHeight(info);
  return bridgeHeight <= 0 ? !1 : targetHeight <= bridgeHeight;
}
async function _refreshHeldAutoplayBackupPlaylist(info, realFetch, currentResolution = null, codecOverride = null, commitDeadlineAt = 0) {
  const selectedBackupSequence = info._BackupSelection?.sequence, selectionSequence = Math.max(0, Number(info._BackupSelectionSequence) || 0) + 1;
  info._BackupSelectionSequence = selectionSequence;
  const backupSearchEpoch = Math.max(0, Number(info?.BackupSearchEpoch) || 0), cycleStartedAt = Math.max(0, Number(info?.VisibleAdStartedAt) || 0), canRefresh = () => _isAutoplayBackupAvailableForSearch() || !!(info?.IsUsingBackupStream && cycleStartedAt > 0 && (Number(info.LastCleanBackupAt) || 0) >= cycleStartedAt && _shouldBridgeHeldAutoplayDuringSearch(info));
  if (!canRefresh())
    return null;
  const encCache = info?.BackupEncodingsM3U8Cache?.autoplay, enc = typeof encCache == "string" ? encCache : encCache?.m3u8 || null;
  if (!enc)
    return null;
  const encBaseUrl = typeof encCache == "object" && encCache?.baseUrl ? encCache.baseUrl : info.UsherBaseUrl, resolvedTargetRes = currentResolution || _getFallbackResolution(info, "") || info?.ResolutionList?.[0] || (typeof __TTVAB_STATE__?.PreferredQualityGroup == "string" && __TTVAB_STATE__.PreferredQualityGroup.trim() ? { Name: __TTVAB_STATE__.PreferredQualityGroup.trim() } : null), targetRes = _applyBackupResolutionFloor(resolvedTargetRes, info?.ResolutionList), refreshCodec = codecOverride || (cycleStartedAt > 0 && (Number(info.LastCleanBackupAt) || 0) >= cycleStartedAt && _shouldBridgeHeldAutoplayDuringSearch(info) ? info.LastCleanBackupCodec || info.LastCleanBackupCodecFamily : null), compatibleMaster = _stripHevcBackupVariants(info, enc, targetRes, refreshCodec);
  if (!compatibleMaster)
    return null;
  const streamUrl = _getStreamUrl(compatibleMaster, targetRes, encBaseUrl);
  if (!streamUrl)
    return null;
  const selectedCodecFamily = _getBackupVariantCodecFamily(compatibleMaster, streamUrl, encBaseUrl), selectedCodecIdentity = _getBackupVariantCodecIdentity(compatibleMaster, streamUrl, encBaseUrl), selectedResolution = _getBackupVariantResolution(compatibleMaster, streamUrl, encBaseUrl);
  try {
    const streamRes = await _fetchWithTimeout(realFetch, streamUrl, {
      signal: info?._AdCycleRequestController?.signal || null
    });
    if (streamRes.status !== 200)
      return null;
    const m3u8 = _absolutizeMediaPlaylistUrls(await streamRes.text(), streamRes.url || streamUrl);
    return !_isBackupSearchContextCurrent(info, backupSearchEpoch, cycleStartedAt) || info._BackupSelection?.sequence !== selectedBackupSequence || !canRefresh() || Math.max(0, Number(commitDeadlineAt) || 0) > 0 && Date.now() >= Math.max(0, Number(commitDeadlineAt) || 0) || !m3u8 || !_playlistHasMediaSegments(m3u8) || _hasPlaylistAdMarkers(m3u8) || _playlistHasKnownAdSegments(m3u8, { includeCached: !1 }) || info.BackupEncodingsM3U8Cache?.autoplay !== encCache ? null : _commitBackupPlaylist(info, m3u8, selectionSequence, {
      playlistUrl: streamUrl,
      sessionUrl: encBaseUrl,
      playerType: "autoplay",
      resolution: selectedResolution,
      codecFamily: selectedCodecFamily,
      codec: selectedCodecIdentity
    }, !0);
  } catch {
    return null;
  }
}
async function _refreshActiveBackupMediaPlaylist(info, realFetch, codecOverride = null) {
  const selectedBackupSequence = info._BackupSelection?.sequence, selectionSequence = Math.max(0, Number(info._BackupSelectionSequence) || 0) + 1;
  info._BackupSelectionSequence = selectionSequence;
  const backupSearchEpoch = Math.max(0, Number(info?.BackupSearchEpoch) || 0), cycleStartedAt = Math.max(0, Number(info?.VisibleAdStartedAt) || 0), pt = typeof info?.ActiveBackupPlayerType == "string" && info.ActiveBackupPlayerType || typeof info?.LastCleanBackupPlayerType == "string" && info.LastCleanBackupPlayerType || null;
  if (!pt || _isBackupPlayerRetryCoolingDown(info, pt))
    return null;
  if (pt === "autoplay")
    return _refreshHeldAutoplayBackupPlaylist(info, realFetch, null, codecOverride);
  const encCache = info.BackupEncodingsM3U8Cache?.[pt], enc = typeof encCache == "string" ? encCache : encCache?.m3u8 || null, encBaseUrl = typeof encCache == "object" && encCache?.baseUrl ? encCache.baseUrl : info.UsherBaseUrl;
  if (!enc)
    return null;
  const preferredRefreshResolution = _resolvePreferredBackupResolution({
    ...info,
    ResolutionList: _getNativeRecoveryMaster(info, !0).resolutionList
  }), targetRes = _applyBackupResolutionFloor(preferredRefreshResolution || _getFallbackResolution(info, "") || info?.ResolutionList?.[0] || (typeof __TTVAB_STATE__?.PreferredQualityGroup == "string" && __TTVAB_STATE__.PreferredQualityGroup.trim() ? { Name: __TTVAB_STATE__.PreferredQualityGroup.trim() } : null), info?.ResolutionList), compatibleMaster = _stripHevcBackupVariants(info, enc, targetRes, codecOverride);
  if (!compatibleMaster)
    return null;
  const streamUrl = _getStreamUrl(compatibleMaster, targetRes, encBaseUrl);
  if (!streamUrl)
    return null;
  const selectedCodecFamily = _getBackupVariantCodecFamily(compatibleMaster, streamUrl, encBaseUrl), selectedCodecIdentity = _getBackupVariantCodecIdentity(compatibleMaster, streamUrl, encBaseUrl), selectedResolution = _getBackupVariantResolution(compatibleMaster, streamUrl, encBaseUrl);
  try {
    const streamRes = await _fetchWithTimeout(realFetch, streamUrl, {
      signal: info?._AdCycleRequestController?.signal || null
    });
    if (streamRes.status !== 200)
      return null;
    const m3u8 = _absolutizeMediaPlaylistUrls(await streamRes.text(), streamRes.url || streamUrl);
    return !_isBackupSearchContextCurrent(info, backupSearchEpoch, cycleStartedAt) || info._BackupSelection?.sequence !== selectedBackupSequence || !m3u8 || !_playlistHasMediaSegments(m3u8) || _hasPlaylistAdMarkers(m3u8) || _playlistHasKnownAdSegments(m3u8, { includeCached: !1 }) || info.BackupEncodingsM3U8Cache?.[pt] !== encCache ? null : _commitBackupPlaylist(info, m3u8, selectionSequence, {
      playlistUrl: streamUrl,
      sessionUrl: encBaseUrl,
      playerType: pt,
      resolution: selectedResolution,
      codecFamily: selectedCodecFamily,
      codec: selectedCodecIdentity
    }, !0);
  } catch {
    return null;
  }
}
async function _prepareFatalMediaRecovery(info, realFetch, request) {
  const recoveryId = typeof request?.recoveryId == "string" && request.recoveryId ? request.recoveryId : null, requestedAt = Math.max(0, Number(request?.requestedAt) || 0), requestedCycleStartedAt = Math.max(0, Number(request?.cycleStartedAt) || 0), requestContext = _normalizePlaybackContext({
    MediaType: info?.MediaType,
    ChannelName: request?.channelName,
    VodID: info?.VodID,
    MediaKey: request?.mediaKey
  }), mediaKey = _normalizeMediaKey(info?.MediaKey), currentAdMediaKey = _normalizeMediaKey(__TTVAB_STATE__?.CurrentAdMediaKey), requiresCodecHandoff = !!(typeof info?.ModifiedM3U8 == "string" && info.ModifiedM3U8), recoveryMaster = requiresCodecHandoff ? info.ModifiedM3U8 : null;
  if (!recoveryId || !requestedAt || requestedCycleStartedAt <= 0 || _getCodecHandoffCycleStartedAt(recoveryId) !== requestedCycleStartedAt || Date.now() - requestedAt > 3e4 || requestedAt - Date.now() > 5e3 || !mediaKey || requestContext.MediaKey !== mediaKey || currentAdMediaKey !== mediaKey || !_isCodecHandoffCycleCurrent(mediaKey, requestedCycleStartedAt, info) || !info?.IsShowingAd && !info?.IsHoldingBackupAfterAd || typeof realFetch != "function")
    return !1;
  info._FatalMediaRecoveryRequestId = recoveryId;
  const recoveryIsCurrent = () => {
    const currentInfo = __TTVAB_STATE__?.StreamInfos?.[mediaKey] || null;
    return !!(info._FatalMediaRecoveryRequestId === recoveryId && (!currentInfo || currentInfo === info) && _normalizeMediaKey(__TTVAB_STATE__?.CurrentAdMediaKey) === mediaKey && _isCodecHandoffCycleCurrent(mediaKey, requestedCycleStartedAt, info) && (info.IsShowingAd || info.IsHoldingBackupAfterAd) && (!requiresCodecHandoff || info.ModifiedM3U8 === recoveryMaster));
  }, targetResolution = _resolveAdBackupTargetResolution(info, "");
  let cleanBackup = null;
  try {
    if (info.ActiveBackupPlayerType === "autoplay" || info.LastCleanBackupPlayerType === "autoplay" ? cleanBackup = await _refreshHeldAutoplayBackupPlaylist(info, realFetch, targetResolution, "avc") : cleanBackup = await _refreshActiveBackupMediaPlaylist(info, realFetch, "avc"), !recoveryIsCurrent() || (cleanBackup || (cleanBackup = (await _findBackupStream(info, realFetch, 0, targetResolution, "avc"))?.m3u8 || null), !recoveryIsCurrent()))
      return !1;
  } catch {
    return !1;
  }
  const verifiedAt = Math.max(0, Number(info.LastCleanBackupAt) || 0), activeContextStillMatches = _normalizeMediaKey(__TTVAB_STATE__?.CurrentAdMediaKey) === mediaKey, cleanBackupIsSafe = !!(typeof cleanBackup == "string" && cleanBackup && _getVideoCodecFamily(info.LastCleanBackupCodecFamily) === "avc" && verifiedAt >= requestedAt && _playlistHasMediaSegments(cleanBackup) && !_hasPlaylistAdMarkers(cleanBackup) && !_playlistHasKnownAdSegments(cleanBackup, { includeCached: !1 }));
  return !recoveryIsCurrent() || !activeContextStillMatches || !info.IsShowingAd && !info.IsHoldingBackupAfterAd || !cleanBackupIsSafe ? !1 : (requiresCodecHandoff && (info._CodecHandoffPendingId = recoveryId, info._CodecHandoffAcknowledgedId = null, info._CodecHandoffFailedId = null, info.IsUsingModifiedM3U8 = !0), typeof self < "u" && self.postMessage && _postWorkerBridgeMessage(self, _createPageScopedWorkerEvent({
    key: "FatalMediaRecoveryReady",
    recoveryId,
    channel: info.ChannelName,
    mediaKey,
    cycleStartedAt: requestedCycleStartedAt,
    verifiedAt,
    requiresCodecHandoff,
    backupPlayerType: info.LastCleanBackupPlayerType || info.ActiveBackupPlayerType || null
  })), !0);
}
async function _findBackupStream(info, realFetch, startIdx = 0, currentResolution = null, codecOverride = null, searchDeadlineAt = 0, earlyRetry = null) {
  const backupSearchEpoch = Math.max(0, Number(info?.BackupSearchEpoch) || 0), cycleStartedAt = Math.max(0, Number(info?.VisibleAdStartedAt) || 0), searchResolution = _resolveAdBackupTargetResolution(info, "", currentResolution) || currentResolution, playbackCodec = _getBackupPlaybackCodec(info, searchResolution, codecOverride), targetCodec = _getVideoCodecIdentity(playbackCodec) || _getVideoCodecFamily(playbackCodec) || "auto", targetKey = searchResolution?.Resolution || searchResolution?.Name || "auto", searchKey = [
    _normalizeMediaKey(info?.MediaKey) || "unknown",
    backupSearchEpoch,
    cycleStartedAt,
    Math.max(0, Number(startIdx) || 0),
    targetCodec,
    targetKey
  ].join("|");
  info?._BackupSearchPromises instanceof Map || (info._BackupSearchPromises = /* @__PURE__ */ new Map());
  const activeSearchKey = typeof info?._BackupSearchKey == "string" && info._BackupSearchKey ? info._BackupSearchKey : null, activeSearchKeyParts = activeSearchKey ? activeSearchKey.split("|") : [], activeSearchMatchesContext = activeSearchKeyParts.length >= 6 && activeSearchKeyParts[0] === (_normalizeMediaKey(info?.MediaKey) || "unknown") && Number(activeSearchKeyParts[1]) === backupSearchEpoch && Number(activeSearchKeyParts[2]) === cycleStartedAt, activeSearchCodec = activeSearchMatchesContext ? activeSearchKeyParts[activeSearchKeyParts.length - 2] : null, enhancedDecoderFamily = _getVideoCodecFamily(info?.EnhancedDecoderCodec || info?.EnhancedDecoderCodecFamily), existingSearch = (info?._BackupSearchPromise && activeSearchMatchesContext && _getVideoCodecFamily(activeSearchCodec) === "avc" && (enhancedDecoderFamily === "hevc" || enhancedDecoderFamily === "av1") && _isCodecHandoffAdRecoveryActive(info, !1, cycleStartedAt) ? info._BackupSearchPromise : null) || info._BackupSearchPromises.get(searchKey) || (!info._BackupSearchKey && info._BackupSearchPromise ? info._BackupSearchPromise : null);
  if (existingSearch) {
    if (_shouldBridgeHeldAutoplayDuringSearch(info) && !_shouldHoldAutoplayBackupDuringAd(info)) {
      const bridged = await _refreshHeldAutoplayBackupPlaylist(info, realFetch, searchResolution, codecOverride);
      if (bridged)
        return { type: "autoplay", m3u8: bridged };
    }
    return existingSearch;
  }
  let earlyRetryController = null, earlyRetryTimeoutId = null;
  const cycleSignal = info?._AdCycleRequestController?.signal || null, abortEarlyRetry = () => earlyRetryController?.abort();
  if (earlyRetry) {
    const currentRetry = _getEarlyNoBackupRetry(info, startIdx, playbackCodec);
    if (!currentRetry || currentRetry.playerType !== earlyRetry.playerType || currentRetry.candidate !== earlyRetry.candidate || currentRetry.mediaKey !== earlyRetry.mediaKey || currentRetry.pageGeneration !== earlyRetry.pageGeneration || currentRetry.cycleStartedAt !== earlyRetry.cycleStartedAt || currentRetry.backupSearchEpoch !== earlyRetry.backupSearchEpoch || currentRetry.searchCompletedAt !== earlyRetry.searchCompletedAt)
      return { type: null, m3u8: null };
    info._LastNoBackupProbeAt = Date.now(), earlyRetryController = new AbortController(), cycleSignal?.addEventListener?.("abort", abortEarlyRetry, { once: !0 }), earlyRetryTimeoutId = setTimeout(abortEarlyRetry, Math.max(1, earlyRetry.deadlineAt - Date.now()));
  }
  const searchPromise = (async () => {
    try {
      for (const candidate of earlyRetry ? earlyRetry.candidates : [null]) {
        const retry = earlyRetry ? { ...earlyRetry, ...candidate, signal: earlyRetryController.signal } : null;
        if (retry) {
          if (retry.signal.aborted || Date.now() >= retry.deadlineAt || info.LastCleanBackupM3U8 || info.IsUsingBackupStream || retry.pageGeneration !== (Number(__TTVAB_STATE__?.PagePlaybackContextGeneration) || 0) || !_isBackupSearchContextCurrent(info, backupSearchEpoch, cycleStartedAt))
            break;
          if (info._NoBackupRecoveryCandidates?.get?.(retry.playerType) !== retry.candidate)
            continue;
          retry.candidate.lastProbeAt = Date.now();
        }
        const result = await _searchBackupStream(info, realFetch, startIdx, searchResolution, codecOverride, searchDeadlineAt, retry);
        if (!retry || result?.m3u8 || retry.candidate.cleanStartedAt > 0)
          return result;
      }
      return { type: null, m3u8: null };
    } finally {
      earlyRetryController && (clearTimeout(earlyRetryTimeoutId), cycleSignal?.removeEventListener?.("abort", abortEarlyRetry), earlyRetryController.abort()), info?._BackupSearchPromises?.get?.(searchKey) === searchPromise && info._BackupSearchPromises.delete(searchKey), info && info._BackupSearchPromise === searchPromise && (info._BackupSearchPromise = null, info._BackupSearchKey = null);
    }
  })();
  if (info && (info._BackupSearchPromises.set(searchKey, searchPromise), info._BackupSearchPromise = searchPromise, info._BackupSearchKey = searchKey, _shouldBridgeHeldAutoplayDuringSearch(info) && !_shouldHoldAutoplayBackupDuringAd(info))) {
    searchPromise.catch(() => {
    });
    const raced = await Promise.race([
      searchPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 1e3))
    ]);
    if (raced?.m3u8)
      return raced;
    const bridged = await _refreshHeldAutoplayBackupPlaylist(info, realFetch, searchResolution, codecOverride);
    if (bridged)
      return { type: "autoplay", m3u8: bridged };
  }
  return searchPromise;
}
async function _searchBackupStream(info, realFetch, startIdx = 0, currentResolution = null, codecOverride = null, searchDeadlineAt = 0, earlyRetry = null) {
  let backupType = null, backupM3u8 = null, timelineProbation = null;
  const autoplaySearchInfo = __TTVAB_STATE__?.DisableAutoplayBackup === !0 ? info : null, selectionSequence = Math.max(0, Number(info._BackupSelectionSequence) || 0) + 1;
  info._BackupSelectionSequence = selectionSequence;
  const backupSearchEpoch = Math.max(0, Number(info?.BackupSearchEpoch) || 0), cycleStartedAt = Math.max(0, Number(info?.VisibleAdStartedAt) || 0), requestSignal = earlyRetry?.signal || info?._AdCycleRequestController?.signal || null, resolvedSearchDeadlineAt = Math.max(0, Number(searchDeadlineAt) || 0), searchDeadlineExceeded = () => resolvedSearchDeadlineAt > 0 && Date.now() >= resolvedSearchDeadlineAt, pageMediaKey = _normalizeMediaKey(__TTVAB_STATE__?.PageMediaKey), pageGeneration = Number(__TTVAB_STATE__?.PagePlaybackContextGeneration) || 0, searchIsCurrent = () => selectionSequence >= (info._BackupSelection?.sequence || 0) && pageMediaKey === _normalizeMediaKey(__TTVAB_STATE__?.PageMediaKey) && pageGeneration === (Number(__TTVAB_STATE__?.PagePlaybackContextGeneration) || 0) && !searchDeadlineExceeded() && !requestSignal?.aborted && (!earlyRetry || __TTVAB_STATE__?.IsAdStrippingEnabled === !0 && __TTVAB_STATE__?.DisableAutoplayBackup === !0 && earlyRetry.pageGeneration === pageGeneration && info._NoBackupRecoveryCandidates?.get?.(earlyRetry.playerType) === earlyRetry.candidate && !info.IsUsingModifiedM3U8 && !info.EnhancedDecoderCodecFamily && !info.EnhancedDecoderCodec && _normalizeMediaKey(__TTVAB_STATE__?.PageMediaKey) === earlyRetry.mediaKey) && _isBackupSearchContextCurrent(info, backupSearchEpoch, cycleStartedAt), markRetryCooldown = (playerType, reason) => {
    earlyRetry || _markBackupPlayerRetryCooldown(info, playerType, reason);
  };
  if (!searchIsCurrent() || searchDeadlineExceeded())
    return { type: null, m3u8: null };
  earlyRetry || _forceClearBackupCooldownsIfStale(info);
  const previousPlaylistUrl = earlyRetry?.candidate.playlistUrl || null, previousCleanAt = earlyRetry?.candidate.cleanStartedAt || 0, previousCleanSequence = earlyRetry?.candidate.cleanMediaSequence ?? null;
  earlyRetry && (earlyRetry.candidate.cleanStartedAt = 0, earlyRetry.candidate.cleanMediaSequence = null);
  let playerTypes = _getOrderedBackupPlayerTypes(info, startIdx);
  earlyRetry && (playerTypes = playerTypes.filter((type) => type === earlyRetry.playerType));
  const foregroundQualityProbeAt = _getPendingForegroundQualityProbeAt(info);
  let foregroundQualityProbeAttempted = !1;
  if (foregroundQualityProbeAt > 0 && playerTypes.includes("autoplay") && (playerTypes = [
    ...playerTypes.filter((playerType) => playerType !== "autoplay"),
    "autoplay"
  ]), info.LoggedBackupAdsByType && info.LoggedBackupAdsByType.size > 0) {
    const clean = [], contam = [];
    for (const t of playerTypes)
      info.LoggedBackupAdsByType.has(t) ? contam.push(t) : clean.push(t);
    contam.length > 0 && clean.length > 0 && (playerTypes = [...clean, ...contam]);
  }
  const resolvedTargetRes = currentResolution || _getFallbackResolution(info, "") || info?.ResolutionList?.[0] || (typeof __TTVAB_STATE__?.PreferredQualityGroup == "string" && __TTVAB_STATE__.PreferredQualityGroup.trim() ? { Name: __TTVAB_STATE__.PreferredQualityGroup.trim() } : null), targetRes = _applyBackupResolutionFloor(resolvedTargetRes, info?.ResolutionList), playbackCodec = _getBackupPlaybackCodec(info, targetRes, codecOverride), requestedCodecFamily = _getVideoCodecFamily(playbackCodec), requestedCodecIdentity = _getVideoCodecIdentity(playbackCodec), activeEnhancedCodecFamily = requestedCodecFamily === "hevc" || requestedCodecFamily === "av1" ? requestedCodecFamily : null, codecSearchPasses = activeEnhancedCodecFamily ? [requestedCodecIdentity || activeEnhancedCodecFamily, "avc"] : [requestedCodecFamily || null], failedExactCodecPlayerTypes = /* @__PURE__ */ new Set(), exactCodecProbeDeadlineAt = activeEnhancedCodecFamily ? Date.now() + 1500 : 0;
  for (let codecPass = 0; !backupM3u8 && codecPass < codecSearchPasses.length; codecPass++) {
    if (!searchIsCurrent() || searchDeadlineExceeded())
      return { type: null, m3u8: null };
    const codecSelection = codecSearchPasses[codecPass], codecFamily = _getVideoCodecFamily(codecSelection), isExactEnhancedPass = !!activeEnhancedCodecFamily && codecPass === 0 && codecFamily === activeEnhancedCodecFamily, probeDeadlines = [
      resolvedSearchDeadlineAt,
      isExactEnhancedPass ? exactCodecProbeDeadlineAt : 0
    ].filter((deadlineAt) => deadlineAt > 0), probeDeadlineAt = probeDeadlines.length > 0 ? Math.min(...probeDeadlines) : 0;
    let passPlayerTypes = [...playerTypes];
    const heldBackupCodecFamily = _getVideoCodecFamily(info?.LastCleanBackupCodecFamily);
    if (isExactEnhancedPass && passPlayerTypes.includes("autoplay")) {
      const sourcePlayerTypes = passPlayerTypes.filter((playerType) => playerType !== "autoplay");
      if (passPlayerTypes = foregroundQualityProbeAt <= 0 && heldBackupCodecFamily === activeEnhancedCodecFamily && (info?.ActiveBackupPlayerType === "autoplay" || info?.LastCleanBackupPlayerType === "autoplay") ? ["autoplay", ...sourcePlayerTypes] : [...sourcePlayerTypes, "autoplay"], foregroundQualityProbeAt <= 0) {
        const cachedPlayerTypes = passPlayerTypes.filter((playerType) => info.BackupEncodingsM3U8Cache?.[playerType]);
        passPlayerTypes = [
          ...cachedPlayerTypes,
          ...passPlayerTypes.filter((playerType) => !cachedPlayerTypes.includes(playerType))
        ];
      }
    }
    const mayRestrictToHeldAutoplay = !isExactEnhancedPass && (!codecFamily || heldBackupCodecFamily === codecFamily);
    if (mayRestrictToHeldAutoplay && _shouldHoldAutoplayBackupDuringAd(info))
      foregroundQualityProbeAt <= 0 && (passPlayerTypes = ["autoplay"]);
    else if (mayRestrictToHeldAutoplay && _shouldHoldBridgeInsteadOfRotating(info, targetRes)) {
      passPlayerTypes = ["autoplay"], info._LoggedWhitelistByType || (info._LoggedWhitelistByType = /* @__PURE__ */ new Set());
      const holdReason = (Number(info._BackupPinFlipCount) || 0) >= 2 ? "bridge-hold:flip-cap" : "bridge-hold:same-res";
      info._LoggedWhitelistByType.has(holdReason) || info._LoggedWhitelistByType.add(holdReason);
    } else !isExactEnhancedPass && foregroundQualityProbeAt <= 0 && _shouldTryAutoplayFirst(info) && (passPlayerTypes = [
      "autoplay",
      ...passPlayerTypes.filter((pt) => pt !== "autoplay")
    ]);
    codecPass > 0, __TTVAB_STATE__?.DisableAutoplayBackup === !0 && _isLiveAdAutoplayBackupAllowed(autoplaySearchInfo) && (passPlayerTypes = [
      ...passPlayerTypes.filter((pt) => pt !== "autoplay"),
      ...passPlayerTypes.filter((pt) => pt === "autoplay")
    ]);
    const isDoingMinimalRequests = startIdx > 0 && passPlayerTypes.every((playerType) => (__TTVAB_STATE__?.BackupPlayerTypes || []).indexOf(playerType) >= startIdx);
    for (let pi = 0; !backupM3u8 && pi < passPlayerTypes.length; pi++) {
      if (!searchIsCurrent() || searchDeadlineExceeded())
        return { type: null, m3u8: null };
      if (isExactEnhancedPass && Date.now() >= exactCodecProbeDeadlineAt)
        break;
      const pt = passPlayerTypes[pi], configuredPlayerTypeIndex = Math.max(0, (__TTVAB_STATE__?.BackupPlayerTypes || []).indexOf(pt));
      if (!earlyRetry && _isBackupPlayerRetryCoolingDown(info, pt) && !(codecPass > 0 && failedExactCodecPlayerTypes.has(pt))) {
        info._LoggedWhitelistByType || (info._LoggedWhitelistByType = /* @__PURE__ */ new Set()), info._LoggedWhitelistByType.has(`cooldown:${pt}`) || info._LoggedWhitelistByType.add(`cooldown:${pt}`);
        continue;
      }
      foregroundQualityProbeAt > 0 && !foregroundQualityProbeAttempted && pt !== "autoplay" && (foregroundQualityProbeAttempted = !0, info._ForegroundQualityProbeAppliedAt = foregroundQualityProbeAt);
      let retryWithoutViewerHeaders = !1;
      for (let j = 0; j < 2 || retryWithoutViewerHeaders; j++) {
        if (!searchIsCurrent() || searchDeadlineExceeded())
          return { type: null, m3u8: null };
        if (pt === "autoplay" && !_isAutoplayBackupAvailableForSearch(autoplaySearchInfo))
          break;
        const omitViewerHeaders = retryWithoutViewerHeaders;
        if (retryWithoutViewerHeaders = !1, omitViewerHeaders) {
          if (Math.max(0, Number(info.LastSessionNeutralBackupProbeCycleStartedAt) || 0) === cycleStartedAt)
            break;
          info.LastSessionNeutralBackupProbeCycleStartedAt = cycleStartedAt;
        }
        let isFreshM3u8 = !1, invalidateCache = !1, rejectedActiveAdSession = !1, encCache = earlyRetry ? earlyRetry.candidate.cache : info.BackupEncodingsM3U8Cache[pt];
        typeof encCache == "object" && encCache?.viewerHeadersOmitted === !0 && Math.max(0, Number(encCache?.cycleStartedAt) || 0) !== cycleStartedAt && (info.BackupEncodingsM3U8Cache[pt] === encCache && (info.BackupEncodingsM3U8Cache[pt] = null), encCache = null);
        let activeCacheEntry = encCache, isSessionNeutralCandidate = !!(omitViewerHeaders || encCache?.viewerHeadersOmitted === !0), enc = typeof encCache == "string" ? encCache : encCache?.m3u8 || null, encBaseUrl = typeof encCache == "object" && encCache?.baseUrl ? encCache.baseUrl : info.UsherBaseUrl;
        if (!enc) {
          if (earlyRetry)
            break;
          isFreshM3u8 = !0;
          try {
            const tokenProbe = await _awaitBackupProbeBeforeDeadline(_getToken(info, pt, realFetch, omitViewerHeaders, probeDeadlineAt, requestSignal), probeDeadlineAt);
            if (!searchIsCurrent())
              return { type: null, m3u8: null };
            if (!tokenProbe.completed)
              break;
            const tokenRes = tokenProbe.value;
            if (tokenRes.status === 200) {
              const tokenBodyProbe = await _awaitBackupProbeBeforeDeadline(tokenRes.json(), probeDeadlineAt);
              if (!searchIsCurrent())
                return { type: null, m3u8: null };
              if (!tokenBodyProbe.completed || pt === "autoplay" && !_isAutoplayBackupAvailableForSearch(autoplaySearchInfo))
                break;
              const token = tokenBodyProbe.value, extractedToken = _extractPlaybackAccessToken(token), sig = extractedToken?.signature, tokenValue = extractedToken?.value;
              if (sig && tokenValue) {
                const usherUrl = _buildUsherPlaybackUrl(info, sig, tokenValue);
                if (!usherUrl) {
                  markRetryCooldown(pt, "token-error"), invalidateCache = !0;
                  continue;
                }
                const masterProbe = await _awaitBackupProbeBeforeDeadline(_fetchWithTimeout(realFetch, usherUrl.href, {
                  signal: requestSignal
                }), probeDeadlineAt);
                if (!searchIsCurrent())
                  return { type: null, m3u8: null };
                if (!masterProbe.completed)
                  break;
                const encRes = masterProbe.value;
                if (encRes.status === 200) {
                  const masterBodyProbe = await _awaitBackupProbeBeforeDeadline(encRes.text(), probeDeadlineAt);
                  if (!searchIsCurrent())
                    return { type: null, m3u8: null };
                  if (!masterBodyProbe.completed || isExactEnhancedPass && Date.now() >= exactCodecProbeDeadlineAt)
                    break;
                  const currentCache = info.BackupEncodingsM3U8Cache[pt];
                  !omitViewerHeaders && currentCache?.viewerHeadersOmitted === !0 && Math.max(0, Number(currentCache?.cycleStartedAt) || 0) === cycleStartedAt && Math.max(0, Number(info.LastSessionNeutralBackupProbeCycleStartedAt) || 0) === cycleStartedAt ? (enc = currentCache.m3u8, encBaseUrl = currentCache.baseUrl || info.UsherBaseUrl, activeCacheEntry = currentCache, isSessionNeutralCandidate = !0, isFreshM3u8 = !1) : (enc = masterBodyProbe.value, encBaseUrl = encRes.url || usherUrl.href, activeCacheEntry = {
                    m3u8: enc,
                    baseUrl: encBaseUrl,
                    viewerHeadersOmitted: omitViewerHeaders,
                    cycleStartedAt: omitViewerHeaders ? cycleStartedAt : 0
                  }, info.BackupEncodingsM3U8Cache[pt] = activeCacheEntry, isSessionNeutralCandidate = omitViewerHeaders);
                  const lines = enc.split(`
`);
                  for (let i = 0; i < lines.length; i++) {
                    const line = lines[i]?.trim();
                    if (line && !line.startsWith("#") && (line.endsWith(".m3u8") || line.includes("://")))
                      try {
                        const variantUrl = new URL(line, encBaseUrl).href, variantIsEnhanced = !!(i > 0 && lines[i - 1]?.startsWith("#EXT-X-STREAM-INF") && _isEnhancedCodecString(_parseAttrs(lines[i - 1]).CODECS));
                        info.BackupVariantUrls?.add(variantUrl), info.BackupVariantPlayerTypes?.set?.(_getExactPlaylistUrlKey(variantUrl), pt);
                        for (const alias of _getPlaylistUrlAliases(variantUrl))
                          info.BackupVariantUrls?.add(alias), variantIsEnhanced && info.EnhancedBackupVariantUrls?.add(alias);
                      } catch {
                      }
                  }
                  for (info._LoggedWhitelistByType || (info._LoggedWhitelistByType = /* @__PURE__ */ new Set()), info._LoggedWhitelistByType.has(`whitelist:${pt}`) || info._LoggedWhitelistByType.add(`whitelist:${pt}`); info.BackupVariantUrls.size > 200; ) {
                    const first = info.BackupVariantUrls.values().next().value;
                    if (first !== void 0)
                      info.BackupVariantUrls.delete(first), info.EnhancedBackupVariantUrls?.delete(first), info.BackupVariantPlayerTypes?.delete?.(first);
                    else
                      break;
                  }
                } else
                  markRetryCooldown(pt, "token-error");
              } else {
                const missingParts = [
                  extractedToken?.hasAnySignature ? null : "signature",
                  extractedToken?.hasAnyValue ? null : "value"
                ].filter(Boolean).join("+"), tokenErrors = Array.isArray(extractedToken?.errors) ? extractedToken.errors.slice(0, 2).join(" | ") : "", tokenContext = tokenErrors ? ` errors=${tokenErrors}` : extractedToken?.summary ? ` payload=${extractedToken.summary}` : "";
                markRetryCooldown(pt, "token-error");
              }
            } else
              markRetryCooldown(pt, "token-error");
          } catch {
            if (!searchIsCurrent())
              return { type: null, m3u8: null };
            markRetryCooldown(pt, "error"), info._BackupSearchErrorCount = (info._BackupSearchErrorCount || 0) + 1;
          }
        }
        if (enc) {
          if (!isFreshM3u8) {
            const lines = enc.split(`
`);
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i]?.trim();
              if (line && !line.startsWith("#") && (line.endsWith(".m3u8") || line.includes("://")))
                try {
                  const variantUrl = new URL(line, encBaseUrl).href, variantIsEnhanced = !!(i > 0 && lines[i - 1]?.startsWith("#EXT-X-STREAM-INF") && _isEnhancedCodecString(_parseAttrs(lines[i - 1]).CODECS));
                  info.BackupVariantUrls?.add(variantUrl), info.BackupVariantPlayerTypes?.set?.(_getExactPlaylistUrlKey(variantUrl), pt);
                  for (const alias of _getPlaylistUrlAliases(variantUrl))
                    info.BackupVariantUrls?.add(alias), variantIsEnhanced && info.EnhancedBackupVariantUrls?.add(alias);
                } catch {
                }
            }
            for (; info.BackupVariantUrls.size > 200; ) {
              const first = info.BackupVariantUrls.values().next().value;
              if (first !== void 0)
                info.BackupVariantUrls.delete(first), info.EnhancedBackupVariantUrls?.delete(first), info.BackupVariantPlayerTypes?.delete?.(first);
              else
                break;
            }
          }
          try {
            if (pt === "autoplay" && !_isAutoplayBackupAvailableForSearch(autoplaySearchInfo))
              break;
            const compatibleMaster = _stripHevcBackupVariants(info, enc, targetRes, codecSelection);
            if (!compatibleMaster)
              break;
            const streamUrl = _getStreamUrl(compatibleMaster, targetRes, encBaseUrl);
            if (streamUrl) {
              const selectedCodecFamily = _getBackupVariantCodecFamily(compatibleMaster, streamUrl, encBaseUrl), selectedCodecIdentity = _getBackupVariantCodecIdentity(compatibleMaster, streamUrl, encBaseUrl), selectedResolution = _getBackupVariantResolution(compatibleMaster, streamUrl, encBaseUrl);
              earlyRetry && streamUrl !== previousPlaylistUrl && (earlyRetry.candidate.playlistUrl = streamUrl);
              const streamProbe = await _awaitBackupProbeBeforeDeadline(_fetchWithTimeout(realFetch, streamUrl, {
                signal: requestSignal
              }), probeDeadlineAt);
              if (!searchIsCurrent())
                return { type: null, m3u8: null };
              if (!streamProbe.completed)
                break;
              const streamRes = streamProbe.value;
              if (streamRes.status === 200) {
                const streamBodyProbe = await _awaitBackupProbeBeforeDeadline(streamRes.text(), probeDeadlineAt);
                if (!searchIsCurrent())
                  return { type: null, m3u8: null };
                if (!streamBodyProbe.completed || isExactEnhancedPass && Date.now() >= exactCodecProbeDeadlineAt)
                  break;
                const m3u8 = _absolutizeMediaPlaylistUrls(streamBodyProbe.value, streamRes.url || streamUrl);
                if (!searchIsCurrent())
                  return { type: null, m3u8: null };
                if (m3u8) {
                  const candidateIsPlayable = _playlistHasMediaSegments(m3u8), candidateHasAds = _hasPlaylistAdMarkers(m3u8) || _playlistHasKnownAdSegments(m3u8, {
                    includeCached: !1
                  }), simulatedAdsDepthSatisfied = __TTVAB_STATE__.SimulatedAdsDepth === 0 || configuredPlayerTypeIndex >= __TTVAB_STATE__.SimulatedAdsDepth - 1, promotionPolicy = typeof _getFallbackPromotionPolicy == "function" ? _getFallbackPromotionPolicy({
                    candidateHasAds,
                    candidateIsPlayable,
                    simulatedAdsDepthSatisfied
                  }) : {
                    allowSelectedPromotion: !1,
                    reason: "policy-unavailable"
                  };
                  if (earlyRetry && promotionPolicy.allowSelectedPromotion) {
                    const mediaSequence = _parsePlaylistFirstMediaSequence(m3u8);
                    if (mediaSequence === null)
                      break;
                    const cleanAge = Date.now() - previousCleanAt;
                    if (streamUrl !== previousPlaylistUrl || previousCleanAt <= 0 || previousCleanSequence === null || cleanAge > 5e3 || mediaSequence < previousCleanSequence) {
                      earlyRetry.candidate.cleanStartedAt = Date.now(), earlyRetry.candidate.cleanMediaSequence = mediaSequence;
                      break;
                    }
                    if (cleanAge < 900 || mediaSequence === previousCleanSequence) {
                      earlyRetry.candidate.cleanStartedAt = previousCleanAt, earlyRetry.candidate.cleanMediaSequence = previousCleanSequence;
                      break;
                    }
                  }
                  !earlyRetry && candidateIsPlayable && candidateHasAds && __TTVAB_STATE__?.DisableAutoplayBackup === !0 && info.MediaType === "live" && cycleStartedAt > 0 && ["site", "embed", "popout", "mobile_web"].includes(pt) && !isSessionNeutralCandidate && !info.IsUsingModifiedM3U8 && !info.EnhancedDecoderCodecFamily && !info.EnhancedDecoderCodec && selectedCodecFamily === "avc" && !info.LastCleanBackupM3U8 && !info.IsUsingBackupStream && !(Number(info.LastCleanBackupAt) >= cycleStartedAt) && info._NoBackupRecoveryCandidates?.set?.(pt, {
                    cache: activeCacheEntry,
                    playlistUrl: streamUrl,
                    cycleStartedAt,
                    backupSearchEpoch,
                    createdAt: Date.now(),
                    lastProbeAt: Date.now(),
                    cleanStartedAt: 0,
                    cleanMediaSequence: null
                  });
                  const autoplayWasUnavailableDuringSearch = pt === "autoplay" && !_isAutoplayBackupAvailableForSearch(autoplaySearchInfo);
                  if (promotionPolicy.allowSelectedPromotion && !autoplayWasUnavailableDuringSearch) {
                    const probation = info._BackupProbation, sameCandidate = !!(_isBackupProbationCurrent(info, probation) && probation.type === pt && probation.cache === activeCacheEntry && probation.playlistUrl === streamUrl && probation.codec === selectedCodecIdentity && probation.resolution === selectedResolution), requiredCleanHolds = (Number(info._BackupPinFlipCount) || 0) > 0 ? 2 : 1, priorCleanHolds = sameCandidate ? Number(probation.cleanChecks) || 1 : 0, checkedTooSoon = !!(sameCandidate && probation.at > 0 && Date.now() - probation.at < 1500), nextProbation = {
                      type: pt,
                      at: checkedTooSoon ? probation.at : Date.now(),
                      cleanChecks: checkedTooSoon ? priorCleanHolds : priorCleanHolds + 1,
                      cache: activeCacheEntry,
                      playlistUrl: streamUrl,
                      codec: selectedCodecIdentity,
                      resolution: selectedResolution,
                      mediaKey: _normalizeMediaKey(info.MediaKey),
                      pageMediaKey,
                      pageGeneration,
                      cycleStartedAt,
                      backupSearchEpoch
                    };
                    if (pt !== "autoplay" && _shouldBridgeHeldAutoplayDuringSearch(info))
                      try {
                        _alignLivePlaylist(info, m3u8, {
                          playlistUrl: streamUrl,
                          sessionUrl: encBaseUrl,
                          playerType: pt,
                          resolution: selectedResolution,
                          codecFamily: selectedCodecFamily,
                          codec: selectedCodecIdentity
                        }, !1);
                      } catch (error) {
                        if (error?.name !== "AbortError")
                          throw error;
                        timelineProbation ||= nextProbation;
                        break;
                      }
                    if (pt !== "autoplay" && (isFreshM3u8 || !sameCandidate || checkedTooSoon || priorCleanHolds < requiredCleanHolds)) {
                      const bridgedProbe = await _awaitBackupProbeBeforeDeadline(_refreshHeldAutoplayBackupPlaylist(info, realFetch, currentResolution, codecSelection, probeDeadlineAt), probeDeadlineAt);
                      if (!searchIsCurrent())
                        return { type: null, m3u8: null };
                      if (!bridgedProbe.completed)
                        break;
                      const bridged = bridgedProbe.value;
                      if (bridged) {
                        info._BackupProbation = nextProbation, backupType = "autoplay", backupM3u8 = bridged;
                        break;
                      }
                      if (isSessionNeutralCandidate) {
                        info._BackupProbation = nextProbation;
                        break;
                      }
                    }
                    if (!searchIsCurrent())
                      return { type: null, m3u8: null };
                    if (isExactEnhancedPass && Date.now() >= exactCodecProbeDeadlineAt)
                      break;
                    if (info._BackupProbation = pt === "autoplay" ? _isBackupProbationCurrent(info, timelineProbation) ? timelineProbation : null : {
                      ...nextProbation,
                      at: 0,
                      cleanChecks: requiredCleanHolds
                    }, _clearBackupPlayerRetryCooldown(info, pt), backupType = pt, backupM3u8 = m3u8, !_commitBackupPlaylist(info, m3u8, selectionSequence, {
                      playlistUrl: streamUrl,
                      sessionUrl: encBaseUrl,
                      playerType: pt,
                      resolution: selectedResolution,
                      codecFamily: selectedCodecFamily,
                      codec: selectedCodecIdentity
                    }))
                      return { type: null, m3u8: null };
                    break;
                  }
                  if (!earlyRetry && isDoingMinimalRequests && candidateIsPlayable && !candidateHasAds && !autoplayWasUnavailableDuringSearch) {
                    if (isExactEnhancedPass && Date.now() >= exactCodecProbeDeadlineAt)
                      break;
                    if (_clearBackupPlayerRetryCooldown(info, pt), backupType = pt, backupM3u8 = m3u8, !_commitBackupPlaylist(info, m3u8, selectionSequence, {
                      playlistUrl: streamUrl,
                      sessionUrl: encBaseUrl,
                      playerType: pt,
                      resolution: selectedResolution,
                      codecFamily: selectedCodecFamily,
                      codec: selectedCodecIdentity
                    }))
                      return { type: null, m3u8: null };
                    break;
                  }
                  if (!searchIsCurrent())
                    return { type: null, m3u8: null };
                  markRetryCooldown(pt, promotionPolicy.reason), isExactEnhancedPass && failedExactCodecPlayerTypes.add(pt);
                  const wasCleanCandidate = pt !== "autoplay" && !isFreshM3u8 && (pt === info.ActiveBackupPlayerType || info._BackupProbation?.type === pt);
                  info._BackupProbation?.type === pt && (info._BackupProbation = null), promotionPolicy.reason === "ad-marked" && (wasCleanCandidate && (rejectedActiveAdSession = !0, info._BackupPinFlipCount = (Number(info._BackupPinFlipCount) || 0) + 1), info.LoggedBackupAdsByType || (info.LoggedBackupAdsByType = /* @__PURE__ */ new Set()), info.LoggedBackupAdsByType.add(pt)), isFreshM3u8 && !omitViewerHeaders && pt !== "autoplay" && !isExactEnhancedPass && info?.MediaType !== "vod" && !String(info?.MediaKey || "").startsWith("vod:") && cycleStartedAt > 0 && promotionPolicy.reason === "not-playable" && !candidateHasAds && (__TTVAB_STATE__?.AuthorizationHeader || __TTVAB_STATE__?.ClientIntegrityHeader) && _shouldBridgeHeldAutoplayDuringSearch(info) && Math.max(0, Number(info.LastSessionNeutralBackupProbeCycleStartedAt) || 0) !== cycleStartedAt && (retryWithoutViewerHeaders = !0), invalidateCache = !0;
                }
              } else {
                if (earlyRetry)
                  return info._NoBackupRecoveryCandidates.delete(pt), { type: null, m3u8: null };
                markRetryCooldown(pt, "stream-error"), isExactEnhancedPass && failedExactCodecPlayerTypes.add(pt), invalidateCache = !0;
              }
            } else
              markRetryCooldown(pt, "no-stream-url"), isExactEnhancedPass && failedExactCodecPlayerTypes.add(pt), invalidateCache = !0;
          } catch {
            if (!searchIsCurrent())
              return { type: null, m3u8: null };
            markRetryCooldown(pt, "stream-error"), isExactEnhancedPass && failedExactCodecPlayerTypes.add(pt), info._BackupSearchErrorCount = (info._BackupSearchErrorCount || 0) + 1, invalidateCache = !0;
          }
        }
        if (invalidateCache) {
          if (!searchIsCurrent())
            return { type: null, m3u8: null };
          info._BackupProbation?.cache === activeCacheEntry && info._BackupProbation?.type === pt && (info._BackupProbation = null), info.BackupEncodingsM3U8Cache[pt] === activeCacheEntry && (info.BackupEncodingsM3U8Cache[pt] = null);
        }
        if (earlyRetry || rejectedActiveAdSession || isFreshM3u8 && !retryWithoutViewerHeaders)
          break;
      }
    }
  }
  return !searchIsCurrent() || searchDeadlineExceeded() ? { type: null, m3u8: null } : (foregroundQualityProbeAt > 0 && !foregroundQualityProbeAttempted && (info._ForegroundQualityProbeAppliedAt = foregroundQualityProbeAt), backupM3u8 ? (earlyRetry && (info.BackupEncodingsM3U8Cache[backupType] = earlyRetry.candidate.cache), info._NoBackupRecoveryCandidates?.clear?.(), info._BackupSearchCount = (info._BackupSearchCount || 0) + 1) : info._BackupSearchFailCount = (info._BackupSearchFailCount || 0) + 1, { type: backupType, m3u8: backupM3u8 });
}
const _pageSideVariantCodecByUrl = new Map(_TTVAB_WORKER_SEED.playbackCodecEntries);
function _resetWorkerAdCycleState(value) {
  const mediaKey = _normalizePlaybackContext(value).MediaKey, cycleStartedAt = Math.max(0, Number(value?.cycleStartedAt) || 0);
  if (!mediaKey || cycleStartedAt <= 0)
    return !1;
  const progress = __TTVAB_STATE__?.AdPodProgressByMediaKey?.[mediaKey] || null, progressCycleStartedAt = Math.max(0, Number(progress?.cycleStartedAt) || 0), matchingInfos = Object.values(__TTVAB_STATE__?.StreamInfos || {}).filter((info) => _normalizeMediaKey(info?.MediaKey) === mediaKey), newestInfoCycleStartedAt = matchingInfos.reduce((newest, info) => Math.max(newest, Math.max(0, Number(info?.VisibleAdStartedAt) || 0)), 0);
  if (progressCycleStartedAt > cycleStartedAt || newestInfoCycleStartedAt > cycleStartedAt)
    return !1;
  const ownsCurrentAd = _normalizeMediaKey(__TTVAB_STATE__?.CurrentAdMediaKey) === mediaKey;
  let didReset = !1;
  for (const info of matchingInfos)
    Math.max(0, Number(info?.VisibleAdStartedAt) || 0) > cycleStartedAt || (_resetStreamAdState(info, !0), didReset = !0);
  return progressCycleStartedAt === cycleStartedAt && (_clearAdPodProgress(mediaKey), didReset = !0), !didReset && !ownsCurrentAd ? !1 : (ownsCurrentAd && (__TTVAB_STATE__.CurrentAdChannel = null, __TTVAB_STATE__.CurrentAdMediaKey = null), _normalizeMediaKey(__TTVAB_STATE__?.PinnedBackupPlayerMediaKey) === mediaKey && (__TTVAB_STATE__.PinnedBackupPlayerType = null, __TTVAB_STATE__.PinnedBackupPlayerChannel = null, __TTVAB_STATE__.PinnedBackupPlayerMediaKey = null), !0);
}
function _isPageLifecycleCycleCurrent(mediaKey, cycleStartedAt) {
  const normalizedMediaKey = _normalizeMediaKey(mediaKey), expectedCycleStartedAt = Math.max(0, Number(cycleStartedAt) || 0);
  return !normalizedMediaKey || expectedCycleStartedAt <= 0 ? !1 : _isCodecHandoffCycleCurrent(normalizedMediaKey, expectedCycleStartedAt) ? !0 : _normalizeMediaKey(__TTVAB_STATE__?.CurrentAdMediaKey) ? !1 : _normalizeMediaKey(__TTVAB_STATE__?.LastAdEndedMediaKey) === normalizedMediaKey && Math.max(0, Number(__TTVAB_STATE__?.LastAdEndedCycleStartedAt) || 0) === expectedCycleStartedAt && Date.now() - Math.max(0, Number(__TTVAB_STATE__?.LastAdEndedAt) || 0) < 3e4;
}
function _hookWorkerFetch() {
  const realFetch = fetch;
  let masterRequestSequence = 0, adRequestPlaybackContext = null;
  const committedMasterRequestByMediaKey = /* @__PURE__ */ new Map(), commitMasterRequest = (mediaKey, requestSequence) => {
    for ((!adRequestPlaybackContext || requestSequence > adRequestPlaybackContext.requestSequence) && (adRequestPlaybackContext = {
      mediaKey,
      requestSequence,
      pageMediaKey: _normalizeMediaKey(__TTVAB_STATE__.PageMediaKey),
      pageContextGeneration: Math.max(0, Number(__TTVAB_STATE__.PagePlaybackContextGeneration) || 0)
    }), committedMasterRequestByMediaKey.delete(mediaKey), committedMasterRequestByMediaKey.set(mediaKey, requestSequence); committedMasterRequestByMediaKey.size > 16; ) {
      const oldestMediaKey = committedMasterRequestByMediaKey.keys().next().value;
      if (oldestMediaKey === void 0)
        break;
      committedMasterRequestByMediaKey.delete(oldestMediaKey);
    }
  }, getFetchArgs = (resource, opts, args, nextUrl) => typeof resource == "string" || resource instanceof URL ? [nextUrl, opts] : typeof Request < "u" && resource instanceof Request ? [new Request(nextUrl, resource), opts] : args, getResponseInit = (response) => ({
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  }), getValidatedNativeMaster = async (info, masterText, masterUrl, recoveryResolutions, selectedVariants, requestSignal, assertCurrent, expiresAt, codecFamily = null) => {
    const masterLines = masterText.split(/\r?\n/), initialPlaylistUrls = [...selectedVariants.values()], deadlineAt = Math.min(expiresAt, Date.now() + 2500), recoveryTarget = _getResolutionByQualityGroup(recoveryResolutions, __TTVAB_STATE__.PreferredQualityGroup) || info.SustainedNativeResolution, targetHeight = Number(String(recoveryTarget?.Resolution || "").split("x")[1]) || 0, candidates = [];
    for (let index = 0; index < masterLines.length - 1; index++) {
      const line = masterLines[index], uri = masterLines[index + 1]?.trim();
      if (!line.startsWith("#EXT-X-STREAM-INF:") || !uri || uri.startsWith("#") || selectedVariants.has(index))
        continue;
      const attrs = _parseAttrs(line), height = Number(String(attrs.RESOLUTION || "").split("x")[1]) || 0, url = _getExactPlaylistUrlKey(uri, masterUrl), priority = url === recoveryTarget?.Url ? 2 : height === targetHeight ? 1 : 0;
      candidates.push({ index, attrs, height, url, priority });
    }
    candidates.sort((left, right) => right.priority - left.priority || right.height - left.height || (Number(right.attrs["FRAME-RATE"]) || 0) - (Number(left.attrs["FRAME-RATE"]) || 0));
    const qualityResults = /* @__PURE__ */ new Map(), qualityCandidates = candidates.slice(0, 12);
    let nextCandidate = 0;
    const validateQualities = async () => {
      for (; nextCandidate < qualityCandidates.length && Date.now() < deadlineAt; ) {
        const candidate = qualityCandidates[nextCandidate++], { index, attrs, height, url: candidateUrl } = candidate, recordResult = (reason) => qualityResults.set(index, `${height}p:${reason}`);
        if (!_getVideoCodecIdentity(attrs.CODECS) || codecFamily && _getVideoCodecFamily(attrs.CODECS) !== codecFamily) {
          recordResult("unknown-codec");
          continue;
        }
        const groups = [
          attrs.AUDIO,
          attrs.VIDEO,
          attrs.SUBTITLES,
          attrs["CLOSED-CAPTIONS"]
        ];
        if (masterLines.some((entry) => entry.startsWith("#EXT-X-MEDIA:") && groups.includes(_parseAttrs(entry)["GROUP-ID"]) && _parseAttrs(entry).URI)) {
          recordResult("external-media");
          continue;
        }
        let result = "clean", previousSequence = null;
        try {
          for (let look = 0; look < 2; look++) {
            if (assertCurrent(), Date.now() >= deadlineAt) {
              result = "deadline";
              break;
            }
            const probe = await _awaitBackupProbeBeforeDeadline(_fetchWithTimeout(realFetch, candidateUrl, { signal: requestSignal }, Math.max(1, deadlineAt - Date.now())), deadlineAt);
            if (assertCurrent(), !probe.completed || Date.now() >= deadlineAt || probe.value.status !== 200) {
              result = !probe.completed || Date.now() >= deadlineAt ? "deadline" : `http-${probe.value.status}`;
              break;
            }
            const text = await probe.value.text();
            if (assertCurrent(), Date.now() >= deadlineAt) {
              result = "deadline";
              break;
            }
            const sequence = _parsePlaylistFirstMediaSequence(text);
            if (_hasPlaylistAdMarkers(text) || _hasExplicitAdMetadata(text) || _playlistHasKnownAdSegments(text) ? result = "ad-marked" : !_playlistHasMediaSegments(text) || text.includes("#EXT-X-SKIP:") || sequence == null ? result = "unplayable" : previousSequence != null && sequence < previousSequence && (result = "rewound"), result !== "clean")
              break;
            previousSequence = sequence;
          }
        } catch {
          assertCurrent(), result = Date.now() >= deadlineAt ? "deadline" : "fetch-error";
        }
        recordResult(result), result === "clean" && selectedVariants.set(index, candidateUrl);
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, qualityCandidates.length) }, () => validateQualities()));
    const qualityOutcomes = qualityCandidates.map(({ index }) => qualityResults.get(index)).filter(Boolean), configuredQuality = /^(?:auto|chunked|audio_only|\d{2,4}p(?:\d{2})?)$/i.test(__TTVAB_STATE__.PreferredQualityGroup || "") ? __TTVAB_STATE__.PreferredQualityGroup : "unknown", sustainedHeight = Number(String(info.SustainedNativeResolution?.Resolution || "").split("x")[1]) || 0;
    assertCurrent();
    const selectedMediaGroups = /* @__PURE__ */ new Set();
    for (const index of selectedVariants.keys()) {
      const attrs = _parseAttrs(masterLines[index]);
      for (const group of [
        attrs.AUDIO,
        attrs.VIDEO,
        attrs.SUBTITLES,
        attrs["CLOSED-CAPTIONS"]
      ])
        group && group !== "NONE" && selectedMediaGroups.add(group);
    }
    const selectedMasterLines = [];
    for (let index = 0; index < masterLines.length; index++) {
      const line = masterLines[index], trimmedLine = line?.trim();
      if (line?.startsWith("#EXT-X-STREAM-INF")) {
        const uri = masterLines[index + 1]?.trim();
        selectedVariants.has(index) && selectedMasterLines.push(line, _absolutizePlaylistUrl(uri, masterUrl)), index++;
        continue;
      }
      if (!line?.startsWith("#EXT-X-I-FRAME-STREAM-INF")) {
        if (line?.startsWith("#EXT-X-MEDIA:")) {
          const mediaAttrs = _parseAttrs(line);
          if (!selectedMediaGroups.has(mediaAttrs["GROUP-ID"]))
            continue;
          if (mediaAttrs.URI)
            return null;
        }
        if (!(trimmedLine && !trimmedLine.startsWith("#"))) {
          if (typeof line != "string" || !line.includes('URI="')) {
            selectedMasterLines.push(line);
            continue;
          }
          selectedMasterLines.push(line.replace(/URI="([^"]+)"/g, (_match, value) => `URI="${_absolutizePlaylistUrl(value, masterUrl)}"`));
        }
      }
    }
    return {
      master: selectedMasterLines.join(`
`),
      playlistUrls: [
        ...initialPlaylistUrls,
        ...qualityCandidates.filter(({ index }) => selectedVariants.has(index)).map(({ url }) => url)
      ]
    };
  }, getPendingPostAdNativeMaster = async (info, playbackContext, requestSignal, assertRequestCurrent) => {
    const pending = info?._PendingPostAdNativeMaster;
    if (!pending)
      return null;
    const rejectPending = () => (_reportPostAdNativeSession(info, "released"), info._PendingPostAdNativeMaster = null, null), mediaKey = _normalizeMediaKey(playbackContext?.MediaKey), cycleStartedAt = Math.max(0, Number(pending.cycleStartedAt) || 0);
    if (playbackContext?.MediaType === "vod" || !mediaKey || _normalizeMediaKey(pending.mediaKey) !== mediaKey || _normalizeMediaKey(__TTVAB_STATE__.PageMediaKey) !== mediaKey || _normalizeMediaKey(__TTVAB_STATE__.CurrentAdMediaKey) || _normalizeMediaKey(__TTVAB_STATE__.LastAdEndedMediaKey) !== mediaKey || Math.max(0, Number(__TTVAB_STATE__.LastAdEndedCycleStartedAt) || 0) !== cycleStartedAt || Date.now() >= Math.max(0, Number(pending.expiresAt) || 0) || Math.max(0, Number(__TTVAB_STATE__.PagePlaybackContextGeneration) || 0) !== Math.max(0, Number(pending.pageGeneration) || 0) || typeof pending.master != "string" || !pending.master || typeof pending.masterUrl != "string" || !pending.masterUrl || typeof pending.playlistUrl != "string" || !pending.playlistUrl)
      return rejectPending();
    if (pending.consumed === !0)
      return null;
    const exactPlaylistUrl = _getExactPlaylistUrlKey(pending.playlistUrl), masterLines = pending.master.split(/\r?\n/);
    let selectedVariantIndex = -1, selectedVariantLine = null, selectedVariantUri = null;
    for (let index = 0; index < masterLines.length - 1; index++) {
      const line = masterLines[index], uri = masterLines[index + 1]?.trim();
      if (!(!line?.startsWith("#EXT-X-STREAM-INF") || !uri || uri.startsWith("#") || _getExactPlaylistUrlKey(uri, pending.masterUrl) !== exactPlaylistUrl)) {
        selectedVariantIndex = index, selectedVariantLine = line, selectedVariantUri = uri;
        break;
      }
    }
    if (!selectedVariantLine || !selectedVariantUri)
      return rejectPending();
    const loaderEpoch = Math.max(0, Number(info.NativeRecoveryLoaderEpoch) || 0), assertPendingCurrent = () => {
      if (assertRequestCurrent(), requestSignal?.aborted || info._PendingPostAdNativeMaster !== pending || pending.consumed === !0 || __TTVAB_STATE__.StreamInfos[mediaKey] !== info || Date.now() >= pending.expiresAt || Math.max(0, Number(info.NativeRecoveryLoaderEpoch) || 0) !== loaderEpoch || _normalizeMediaKey(__TTVAB_STATE__.CurrentAdMediaKey) || Number(__TTVAB_STATE__.LastAdEndedCycleStartedAt) !== cycleStartedAt)
        throw _createCodecHandoffAbortError(requestSignal);
    }, recoveryResolutions = info._NativePlaybackMaster?.master === pending.master && info._NativePlaybackMaster?.masterUrl === pending.masterUrl ? info._NativePlaybackMaster.resolutionList : info.ResolutionList || [], validated = await getValidatedNativeMaster(info, pending.master, pending.masterUrl, recoveryResolutions, /* @__PURE__ */ new Map([[selectedVariantIndex, exactPlaylistUrl]]), requestSignal, assertPendingCurrent, pending.expiresAt);
    return !validated?.master.includes(selectedVariantLine) || !validated.master.includes(exactPlaylistUrl) ? rejectPending() : (pending.masterServedAt = Date.now(), pending.verifiedPlaylistUrls = validated.playlistUrls, pending.loaderEpoch = Math.max(0, Number(info.NativeRecoveryLoaderEpoch) || 0), _reportPostAdNativeSession(info, "master-served"), validated.master);
  }, getCleanNativeMasterAfterReduction = async (info, encodings, requestSignal, assertRequestCurrent) => {
    const saved = info?._NativePlaybackMaster, mediaKey = _normalizeMediaKey(info?.MediaKey), now = Date.now(), quality = __TTVAB_STATE__.PreferredQualityGroup, nativeUrl = _getMediaPlaylistSessionKey(info?.LastCleanNativeUrl), nativeVariant = saved?.resolutionList?.find((entry) => entry.Url === nativeUrl), codecFamily = _getVideoCodecFamily(info?.LastCleanNativeCodec), loaderEpoch = Number(info?.NativeRecoveryLoaderEpoch) || 0, isCurrent = () => !!(!requestSignal?.aborted && __TTVAB_STATE__.IsAdStrippingEnabled === !0 && mediaKey && info?.MediaType === "live" && __TTVAB_STATE__.StreamInfos[mediaKey] === info && _normalizeMediaKey(__TTVAB_STATE__.PageMediaKey) === mediaKey && !_normalizeMediaKey(__TTVAB_STATE__.CurrentAdMediaKey) && !info.IsShowingAd && !info.IsHoldingBackupAfterAd && !info.IsUsingBackupStream && !info.IsUsingFallbackStream && !info.IsUsingModifiedM3U8 && !_getActiveCodecHandoffIdForInfo(info) && !info._PendingPostAdNativeMaster && saved && info._NativePlaybackMaster?.master === saved.master && info._NativePlaybackMaster?.masterUrl === saved.masterUrl && info._NativePlaybackMaster?.mediaKey === saved.mediaKey && info._NativePlaybackMaster?.pageGeneration === saved.pageGeneration && saved.mediaKey === mediaKey && saved.pageGeneration === (Number(__TTVAB_STATE__.PagePlaybackContextGeneration) || 0) && saved.masterUrl === info.UsherBaseUrl && saved.observedAt > 0 && saved.observedAt <= Date.now() && Date.now() - saved.observedAt <= 6e4 && info.LastCleanNativePlaylistAt > 0 && info.LastCleanNativePlaylistAt <= Date.now() && Date.now() - info.LastCleanNativePlaylistAt <= 1e4 && (Number(info.NativeRecoveryLoaderEpoch) || 0) === loaderEpoch && (Number(info.LastCleanNativeLoaderEpoch) || 0) === loaderEpoch && __TTVAB_STATE__.PreferredQualityGroup === quality && _getMediaPlaylistSessionKey(info.LastCleanNativeUrl) === nativeUrl);
    if (!isCurrent() || !nativeVariant || !codecFamily || quality === "audio_only" || !encodings.trimStart().startsWith("#EXTM3U") || _hasPlaylistAdMarkers(encodings) || _hasExplicitAdMetadata(encodings))
      return null;
    const reducedHeight = Math.max(0, ...encodings.split(/\r?\n/).filter((line) => line.startsWith("#EXT-X-STREAM-INF:")).map((line) => Number(String(_parseAttrs(line).RESOLUTION || "").split("x")[1]) || 0)), nativeHeight = Number(String(nativeVariant.Resolution || "").split("x")[1]) || 0, requestedHeight = Number(String(quality || "").match(/^(\d+)p/)?.[1]) || 0, target = _getResolutionByQualityGroup(saved.resolutionList, quality) || info.SustainedNativeResolution;
    if (reducedHeight <= 0 || nativeHeight <= reducedHeight || requestedHeight > 0 && requestedHeight <= reducedHeight || !target?.Url || _getVideoCodecFamily(target.Codecs) !== codecFamily)
      return null;
    try {
      const validated = await getValidatedNativeMaster(info, saved.master, saved.masterUrl, saved.resolutionList, /* @__PURE__ */ new Map(), requestSignal, () => {
        if (assertRequestCurrent(), !isCurrent())
          throw _createRequestAbortError(requestSignal);
      }, now + 2500, codecFamily);
      return assertRequestCurrent(), !isCurrent() || !validated?.playlistUrls.some((url) => saved.resolutionList.some((entry) => entry.Url === url && Number(String(entry.Resolution || "").split("x")[1]) > reducedHeight)) ? null : { master: validated.master, masterUrl: saved.masterUrl };
    } catch {
      return assertRequestCurrent(), null;
    }
  }, observedPlaybackMediaKeys = /* @__PURE__ */ new Map(), requestedMediaBootstrapRecoveryCycles = /* @__PURE__ */ new Set(), isPlaybackObservationCurrent = (owner) => !!(owner && !owner.signal?.aborted && owner.pageMediaKey === _normalizeMediaKey(__TTVAB_STATE__.PageMediaKey) && owner.pageContextGeneration === Math.max(0, Number(__TTVAB_STATE__.PagePlaybackContextGeneration) || 0)), reportPlaybackWorkerObserved = (context, playlistUrl = null, codec = null, requestOwner = null) => {
    if (!isPlaybackObservationCurrent(requestOwner))
      return !1;
    const observedContext = _normalizePlaybackContext(context);
    if (!observedContext.MediaKey)
      return !1;
    const observedPlaylistUrl = typeof playlistUrl == "string" && playlistUrl ? _getExactPlaylistUrlKey(playlistUrl) : null, observedCodec = _getVideoCodecIdentity(codec) || _getVideoCodecFamily(codec) || null, observedDecoderCodec = _getVideoCodecIdentity(context?.EnhancedDecoderCodec) || _getVideoCodecFamily(context?.EnhancedDecoderCodecFamily) || null, observedHandoffId = _getActiveCodecHandoffIdForInfo(context), observationKey = `${requestOwner.pageMediaKey}|${requestOwner.pageContextGeneration}|${observedContext.MediaKey}|${observedPlaylistUrl || "context"}|${observedCodec || "unknown"}|${observedDecoderCodec || "native"}|${observedHandoffId || "settled"}`, now = Date.now(), lastObservedAt = Math.max(0, Number(observedPlaybackMediaKeys.get(observationKey)) || 0);
    if (observedPlaybackMediaKeys.has(observationKey) && now - lastObservedAt < 5e3)
      return !1;
    if (typeof self < "u" && self.postMessage)
      try {
        for (_postWorkerBridgeMessage(self, {
          key: "PlaybackWorkerObserved",
          mediaType: observedContext.MediaType,
          channel: observedContext.ChannelName,
          vodID: observedContext.VodID,
          mediaKey: observedContext.MediaKey,
          pageMediaKey: requestOwner.pageMediaKey,
          pageContextGeneration: requestOwner.pageContextGeneration,
          playlistUrl: observedPlaylistUrl,
          codec: observedCodec,
          decoderCodec: observedDecoderCodec,
          handoffId: observedHandoffId
        }), observedPlaybackMediaKeys.delete(observationKey), observedPlaybackMediaKeys.set(observationKey, now); observedPlaybackMediaKeys.size > 16; ) {
          const oldestObservation = observedPlaybackMediaKeys.keys().next().value;
          if (oldestObservation === void 0)
            break;
          observedPlaybackMediaKeys.delete(oldestObservation);
        }
      } catch {
        return !1;
      }
    return !0;
  }, reportPlaybackWorkerBootstrapObserved = (context, requestOwner) => {
    if (!isPlaybackObservationCurrent(requestOwner))
      return !1;
    const observedContext = _normalizePlaybackContext(context);
    if (!observedContext.MediaKey)
      return !1;
    if (typeof self < "u" && self.postMessage)
      try {
        return _postWorkerBridgeMessage(self, {
          key: "PlaybackWorkerBootstrapObserved",
          mediaType: observedContext.MediaType,
          channel: observedContext.ChannelName,
          vodID: observedContext.VodID,
          mediaKey: observedContext.MediaKey,
          pageMediaKey: requestOwner.pageMediaKey,
          pageContextGeneration: requestOwner.pageContextGeneration
        }), !0;
      } catch {
      }
    return !1;
  };
  __TTVAB_STATE__.RequestMediaBootstrapRecovery = (context, cycleStartedAt) => {
    const recoveryContext = _normalizePlaybackContext(context), normalizedCycleStartedAt = Math.max(0, Number(cycleStartedAt) || 0);
    if (!recoveryContext.MediaKey || normalizedCycleStartedAt <= 0 || _normalizeMediaKey(__TTVAB_STATE__.CurrentAdMediaKey) !== recoveryContext.MediaKey || Math.max(0, Number(__TTVAB_STATE__.AdPodProgressByMediaKey?.[recoveryContext.MediaKey]?.cycleStartedAt) || 0) !== normalizedCycleStartedAt)
      return !1;
    const recoveryKey = `${recoveryContext.MediaKey}|${normalizedCycleStartedAt}`;
    if (requestedMediaBootstrapRecoveryCycles.has(recoveryKey) || typeof self > "u" || !self.postMessage)
      return !1;
    try {
      for (_postWorkerBridgeMessage(self, _createPageScopedWorkerEvent({
        key: "MediaBootstrapRecoveryNeeded",
        mediaType: recoveryContext.MediaType,
        channel: recoveryContext.ChannelName,
        vodID: recoveryContext.VodID,
        mediaKey: recoveryContext.MediaKey,
        cycleStartedAt: normalizedCycleStartedAt
      })), requestedMediaBootstrapRecoveryCycles.add(recoveryKey); requestedMediaBootstrapRecoveryCycles.size > 8; ) {
        const oldestRecoveryKey = requestedMediaBootstrapRecoveryCycles.values().next().value;
        if (oldestRecoveryKey === void 0)
          break;
        requestedMediaBootstrapRecoveryCycles.delete(oldestRecoveryKey);
      }
      return !0;
    } catch {
      return !1;
    }
  }, __TTVAB_STATE__.PrepareFatalMediaRecovery = (request) => {
    const recoveryContext = _normalizePlaybackContext(request), info = recoveryContext.MediaKey && __TTVAB_STATE__.StreamInfos[recoveryContext.MediaKey] || null;
    return _prepareFatalMediaRecovery(info, realFetch, request);
  };
  function _pruneStreamInfos() {
    if (typeof __TTVAB_STATE__ > "u" || !__TTVAB_STATE__)
      return;
    const keys = Object.keys(__TTVAB_STATE__.StreamInfos);
    if (keys.length > 5) {
      const oldKey = keys.sort((a, b) => (__TTVAB_STATE__.StreamInfos[a]?.LastActivityAt || 0) - (__TTVAB_STATE__.StreamInfos[b]?.LastActivityAt || 0))[0], oldInfo = __TTVAB_STATE__.StreamInfos[oldKey];
      delete __TTVAB_STATE__.StreamInfos[oldKey];
      const urlsToDelete = [];
      for (const url in __TTVAB_STATE__.StreamInfosByUrl)
        __TTVAB_STATE__.StreamInfosByUrl[url] === oldInfo && urlsToDelete.push(url);
      for (const url of urlsToDelete)
        delete __TTVAB_STATE__.StreamInfosByUrl[url];
    }
    const MAX_STREAM_INFO_BY_URL = 200, byUrlKeys = Object.keys(__TTVAB_STATE__.StreamInfosByUrl);
    if (byUrlKeys.length > MAX_STREAM_INFO_BY_URL) {
      byUrlKeys.sort((a, b) => (__TTVAB_STATE__.StreamInfosByUrl[a]?.LastActivityAt || 0) - (__TTVAB_STATE__.StreamInfosByUrl[b]?.LastActivityAt || 0));
      for (let i = 0; i < 50 && i < byUrlKeys.length; i++)
        delete __TTVAB_STATE__.StreamInfosByUrl[byUrlKeys[i]];
    }
  }
  async function _getValidatedPreviewMasterFallback(playbackContext, failedMasterUrl, requestSignal = null) {
    const fallbackContext = _normalizePlaybackContext(playbackContext);
    if (__TTVAB_STATE__.AllowPreviewEmergencyAutoplayBackup !== !0 || __TTVAB_STATE__.IsAdStrippingEnabled !== !0 || fallbackContext.MediaType !== "live" || !fallbackContext.MediaKey || _normalizeMediaKey(__TTVAB_STATE__.PageMediaKey) !== fallbackContext.MediaKey || _normalizeMediaKey(__TTVAB_STATE__.CurrentAdMediaKey) || requestSignal?.aborted)
      return null;
    let info = __TTVAB_STATE__.StreamInfos[fallbackContext.MediaKey] || null;
    info || (_pruneStreamInfos(), info = __TTVAB_STATE__.StreamInfos[fallbackContext.MediaKey] = _createStreamInfo(fallbackContext));
    const enhancedDecoderFamily = _getVideoCodecFamily(info.EnhancedDecoderCodec || info.EnhancedDecoderCodecFamily);
    if (Date.now() < Math.max(0, Number(info._PreviewMasterFallbackRetryAt) || 0) || Math.max(0, Number(info.VisibleAdStartedAt) || 0) > 0 || info.IsShowingAd === !0 || info.IsHoldingBackupAfterAd === !0 || info.IsUsingModifiedM3U8 === !0 || enhancedDecoderFamily === "hevc" || enhancedDecoderFamily === "av1" || _getActiveCodecHandoffIdForInfo(info))
      return null;
    info.MediaType = fallbackContext.MediaType, info.MediaKey = fallbackContext.MediaKey, info.ChannelName = fallbackContext.ChannelName, info.VodID = fallbackContext.VodID, info.UsherBaseUrl = failedMasterUrl, info.UsherParams = new URL(failedMasterUrl).search, info.LastActivityAt = Date.now();
    const fallbackTargetResolution = _applyBackupResolutionFloor(_getFallbackResolution(info, "") || info.ResolutionList?.[0] || (typeof __TTVAB_STATE__.PreferredQualityGroup == "string" && __TTVAB_STATE__.PreferredQualityGroup.trim() ? { Name: __TTVAB_STATE__.PreferredQualityGroup.trim() } : null), info.ResolutionList), validationStartedAt = Date.now(), validationDeadlineAt = validationStartedAt + 5e3;
    info._PreviewMasterFallbackRetryAt = validationDeadlineAt + 1e4;
    const fallback = await _awaitWithRequestSignal(_findBackupStream(info, realFetch, 0, fallbackTargetResolution, "avc", validationDeadlineAt), requestSignal);
    if (requestSignal?.aborted || __TTVAB_STATE__.AllowPreviewEmergencyAutoplayBackup !== !0 || __TTVAB_STATE__.IsAdStrippingEnabled !== !0 || _normalizeMediaKey(__TTVAB_STATE__.PageMediaKey) !== fallbackContext.MediaKey || _normalizeMediaKey(__TTVAB_STATE__.CurrentAdMediaKey))
      return null;
    const fallbackType = typeof fallback?.type == "string" && fallback.type ? fallback.type : null, validatedMedia = typeof fallback?.m3u8 == "string" && fallback.m3u8 ? fallback.m3u8 : null, validatedAt = Math.max(0, Number(info.LastCleanBackupAt) || 0), cacheEntry = fallbackType ? info.BackupEncodingsM3U8Cache?.[fallbackType] : null, cachedMaster = typeof cacheEntry == "string" ? cacheEntry : typeof cacheEntry?.m3u8 == "string" ? cacheEntry.m3u8 : null, cachedMasterUrl = typeof cacheEntry == "object" && cacheEntry?.baseUrl ? cacheEntry.baseUrl : info.UsherBaseUrl;
    if (!fallbackType || !validatedMedia || !cachedMaster || validatedAt < validationStartedAt || info.LastCleanBackupPlayerType !== fallbackType || info.LastCleanBackupM3U8 !== validatedMedia || _getVideoCodecFamily(info.LastCleanBackupCodecFamily) !== "avc" || !_playlistHasMediaSegments(validatedMedia) || _hasPlaylistAdMarkers(validatedMedia) || _playlistHasKnownAdSegments(validatedMedia, { includeCached: !1 }))
      return null;
    const compatibleMaster = _stripHevcBackupVariants(info, cachedMaster, info.LastCleanBackupResolution ? { Resolution: info.LastCleanBackupResolution } : null, "avc");
    if (typeof compatibleMaster != "string" || !compatibleMaster.includes("#EXT-X-STREAM-INF"))
      return null;
    const validatedStreamUrl = _getStreamUrl(compatibleMaster, fallbackTargetResolution, cachedMasterUrl), exactValidatedStreamUrl = _getExactPlaylistUrlKey(validatedStreamUrl), selectedResolution = _getBackupVariantResolution(compatibleMaster, validatedStreamUrl, cachedMasterUrl), selectedCodecFamily = _getBackupVariantCodecFamily(compatibleMaster, validatedStreamUrl, cachedMasterUrl);
    if (!exactValidatedStreamUrl || selectedResolution !== info.LastCleanBackupResolution || _getVideoCodecFamily(selectedCodecFamily) !== "avc" || !info.BackupVariantUrls?.has(exactValidatedStreamUrl) || info.BackupVariantPlayerTypes?.get?.(exactValidatedStreamUrl) !== fallbackType)
      return null;
    const masterLines = compatibleMaster.split(/\r?\n/);
    let selectedVariantLine = null, selectedVariantUri = null;
    for (let index = 0; index < masterLines.length - 1; index++) {
      const line = masterLines[index], uri = masterLines[index + 1]?.trim();
      if (!(!line?.startsWith("#EXT-X-STREAM-INF") || !uri || uri.startsWith("#") || _getExactPlaylistUrlKey(uri, cachedMasterUrl) !== exactValidatedStreamUrl)) {
        selectedVariantLine = line, selectedVariantUri = uri;
        break;
      }
    }
    if (!selectedVariantLine || !selectedVariantUri)
      return null;
    const selectedVariantAttrs = _parseAttrs(selectedVariantLine), selectedMediaGroups = new Set([
      selectedVariantAttrs.AUDIO,
      selectedVariantAttrs.VIDEO,
      selectedVariantAttrs.SUBTITLES,
      selectedVariantAttrs["CLOSED-CAPTIONS"]
    ].filter((value) => value && value !== "NONE")), selectedMasterLines = [];
    for (let index = 0; index < masterLines.length; index++) {
      const line = masterLines[index], trimmedLine = line?.trim();
      if (line?.startsWith("#EXT-X-STREAM-INF")) {
        const uri = masterLines[index + 1]?.trim();
        line === selectedVariantLine && uri === selectedVariantUri && selectedMasterLines.push(line, _absolutizePlaylistUrl(uri, cachedMasterUrl)), index++;
        continue;
      }
      if (!line?.startsWith("#EXT-X-I-FRAME-STREAM-INF")) {
        if (line?.startsWith("#EXT-X-MEDIA:")) {
          const mediaAttrs = _parseAttrs(line);
          if (!selectedMediaGroups.has(mediaAttrs["GROUP-ID"]))
            continue;
          if (mediaAttrs.URI)
            return null;
        }
        if (!(trimmedLine && !trimmedLine.startsWith("#"))) {
          if (typeof line != "string" || !line.includes('URI="')) {
            selectedMasterLines.push(line);
            continue;
          }
          selectedMasterLines.push(line.replace(/URI="([^"]+)"/g, (_match, value) => `URI="${_absolutizePlaylistUrl(value, cachedMasterUrl)}"`));
        }
      }
    }
    const master = selectedMasterLines.join(`
`);
    if (!master.includes(selectedVariantLine) || !master.includes(exactValidatedStreamUrl))
      return null;
    info.ActiveBackupPlayerType = fallbackType, info.ActiveBackupResolution = info.LastCleanBackupResolution || null, info.LastActivityAt = Date.now(), info._PreviewMasterFallbackRetryAt = 0;
    for (const alias of _getPlaylistUrlAliases(exactValidatedStreamUrl))
      __TTVAB_STATE__.StreamInfosByUrl[alias] = info;
    return { type: fallbackType, master };
  }
  function _syncStreamInfo(info, encodings, usherUrl, preserveNativeSession = !1) {
    info._PendingPostAdNativeMaster && !preserveNativeSession && (_reportPostAdNativeSession(info, "released"), info._PendingPostAdNativeMaster = null);
    const wasUsingModifiedM3U8 = !!info.IsUsingModifiedM3U8, previousHeight = (info.ResolutionList || []).reduce((height, entry) => Math.max(height, Number(String(entry?.Resolution || "").split("x")[1]) || 0), 0), previousUsherUrl = _getExactPlaylistUrlKey(info.UsherBaseUrl), nextUsherUrl = _getExactPlaylistUrlKey(usherUrl);
    !preserveNativeSession && previousUsherUrl && nextUsherUrl && previousUsherUrl !== nextUsherUrl && _invalidateNativeRecoveryAfterPlayerReload(info, !0), info.EncodingsM3U8 = encodings, info.UsherBaseUrl = usherUrl, info.UsherParams = new URL(usherUrl).search, info.Urls = /* @__PURE__ */ Object.create(null), info.ResolutionList = [], info.ModifiedM3U8 = null, info.IsUsingModifiedM3U8 = !1, info.EnhancedVariantUrls instanceof Set || (info.EnhancedVariantUrls = /* @__PURE__ */ new Set());
    for (const variantUrl in __TTVAB_STATE__.StreamInfosByUrl)
      __TTVAB_STATE__.StreamInfosByUrl[variantUrl] === info && delete __TTVAB_STATE__.StreamInfosByUrl[variantUrl];
    const lines = encodings.split(`
`);
    for (let i = 0, len = lines.length; i < len - 1; i++) {
      const nextLine = lines[i + 1]?.trim();
      if (lines[i]?.startsWith("#EXT-X-STREAM-INF") && nextLine && !nextLine.startsWith("#") && (nextLine.includes(".m3u8") || nextLine.includes("://"))) {
        const attrs = _parseAttrs(lines[i]), resolution = attrs.RESOLUTION;
        let variantUrl = lines[i + 1];
        try {
          variantUrl = new URL(variantUrl, usherUrl).href;
        } catch {
        }
        if (resolution) {
          const resInfo = _getStreamVariantInfo(attrs, lines[i + 1], variantUrl);
          if (_isEnhancedCodecString(resInfo?.Codecs)) {
            const enhancedVariantUrl = _getExactPlaylistUrlKey(variantUrl, usherUrl);
            enhancedVariantUrl && info.EnhancedVariantUrls.add(enhancedVariantUrl);
          }
          for (const alias of _getPlaylistUrlAliases(variantUrl))
            info.Urls[alias] = resInfo;
          for (const alias of _getPlaylistUrlAliases(lines[i + 1], usherUrl))
            info.Urls[alias] = resInfo;
          info.ResolutionList.push(resInfo);
        }
        for (const alias of _getPlaylistUrlAliases(variantUrl))
          __TTVAB_STATE__.StreamInfosByUrl[alias] = info;
        for (const alias of _getPlaylistUrlAliases(lines[i + 1], usherUrl))
          __TTVAB_STATE__.StreamInfosByUrl[alias] = info;
      }
    }
    const nextHeight = info.ResolutionList.reduce((height, entry) => Math.max(height, Number(String(entry?.Resolution || "").split("x")[1]) || 0), 0);
    for (!info._NativePlaybackMaster && !preserveNativeSession && info.MediaType === "live" && __TTVAB_STATE__.IsAdStrippingEnabled === !0 && _normalizeMediaKey(__TTVAB_STATE__.PageMediaKey) === info.MediaKey && !info.IsShowingAd && !info.IsHoldingBackupAfterAd && !info.IsUsingBackupStream && !info.IsUsingFallbackStream && nextHeight > 0 && encodings.trimStart().startsWith("#EXTM3U") && (info._NativePlaybackMaster = {
      master: encodings,
      masterUrl: usherUrl,
      resolutionList: info.ResolutionList.slice(),
      mediaKey: info.MediaKey,
      pageGeneration: Number(__TTVAB_STATE__.PagePlaybackContextGeneration) || 0,
      observedAt: Date.now()
    }), previousHeight > nextHeight && nextHeight > 0; info.EnhancedVariantUrls.size > 100; ) {
      const oldest = info.EnhancedVariantUrls.values().next().value;
      if (oldest === void 0)
        break;
      info.EnhancedVariantUrls.delete(oldest);
    }
    for (const enhancedVariantUrl of info.EnhancedVariantUrls)
      __TTVAB_STATE__.StreamInfosByUrl[enhancedVariantUrl] = info;
    const avcList = info.ResolutionList.filter((r) => _getVideoCodecFamily(r.Codecs) === "avc");
    if (info.ResolutionList.some((r) => _isEnhancedCodecString(r.Codecs)) && avcList.length > 0) {
      info.ModifiedM3U8 = _dropEnhancedVariantLines(lines).kept.join(`
`);
      const activeCodecHandoffId = typeof __TTVAB_STATE__.ActiveCodecHandoffId == "string" && __TTVAB_STATE__.ActiveCodecHandoffId ? __TTVAB_STATE__.ActiveCodecHandoffId : null, activeCodecHandoffCycleStartedAt = _getCodecHandoffCycleStartedAt(activeCodecHandoffId), activeCodecHandoffMatches = !!(activeCodecHandoffId && _normalizeMediaKey(__TTVAB_STATE__.ActiveCodecHandoffMediaKey) === _normalizeMediaKey(info.MediaKey) && _isCodecHandoffCycleCurrent(info.MediaKey, activeCodecHandoffCycleStartedAt, info)), activeAdMediaMatches = !!(_normalizeMediaKey(info.MediaKey) && _normalizeMediaKey(__TTVAB_STATE__.CurrentAdMediaKey) === _normalizeMediaKey(info.MediaKey));
      activeCodecHandoffMatches && (info._CodecHandoffPendingId = activeCodecHandoffId, info.EnhancedDecoderCodecFamily = null, info.EnhancedDecoderCodec = null);
      const hasAcknowledgedCodecHandoff = !!(info._CodecHandoffPendingId && info._CodecHandoffAcknowledgedId === info._CodecHandoffPendingId && _isCodecHandoffCycleCurrent(info.MediaKey, _getCodecHandoffCycleStartedAt(info._CodecHandoffPendingId), info));
      info.IsUsingModifiedM3U8 = activeAdMediaMatches && (activeCodecHandoffMatches || hasAcknowledgedCodecHandoff) && __TTVAB_STATE__.IsAdStrippingEnabled === !0;
    }
    wasUsingModifiedM3U8 && !info.ModifiedM3U8 && (info.IsUsingModifiedM3U8 = !1);
  }
  globalThis.fetch = async function(...args) {
    let requestUrl = null;
    try {
      const [resource, opts] = args;
      if (requestUrl = typeof resource == "string" ? resource : resource instanceof URL ? resource.href : typeof Request < "u" && resource instanceof Request ? resource.url : null, !requestUrl)
        return await realFetch.apply(this, args);
      let url = requestUrl.trimEnd();
      const playbackRequestOwner = {
        pageMediaKey: _normalizeMediaKey(__TTVAB_STATE__.PageMediaKey),
        pageContextGeneration: Math.max(0, Number(__TTVAB_STATE__.PagePlaybackContextGeneration) || 0),
        signal: opts?.signal || (typeof Request < "u" && resource instanceof Request ? resource.signal : null)
      }, adRequestMediaKey = adRequestPlaybackContext ? isPlaybackObservationCurrent(adRequestPlaybackContext) ? adRequestPlaybackContext.mediaKey : null : __TTVAB_STATE__.PageMediaType === "vod" ? playbackRequestOwner.pageMediaKey : null, requestMethod = opts?.method || (resource instanceof Request ? resource.method : "GET");
      if (String(requestMethod).toUpperCase() === "GET" && _getVodAdRequest(url, adRequestMediaKey)) {
        const signal = opts?.signal !== void 0 ? opts.signal : resource instanceof Request ? resource.signal : null;
        if (signal?.aborted)
          throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
        return new Response(null, { status: 204, statusText: "No Content" });
      }
      const shouldBlockAdSegments = __TTVAB_STATE__.IsAdStrippingEnabled === !0, shouldBlockCachedAdSegments = !!(shouldBlockAdSegments && (__TTVAB_STATE__.CurrentAdMediaKey || __TTVAB_STATE__.CurrentAdChannel || __TTVAB_STATE__.SimulatedAdsDepth > 0));
      if (shouldBlockAdSegments && url.includes("/__ttvab_empty_hold_segment.ts") && typeof _isEmptyAdHoldSegmentUrl == "function" && _isEmptyAdHoldSegmentUrl(url)) {
        let emptyHoldMediaKey = null;
        try {
          emptyHoldMediaKey = _normalizeMediaKey(new URL(url).searchParams.get("media"));
        } catch {
        }
        const emptyHoldInfo = emptyHoldMediaKey && __TTVAB_STATE__.StreamInfos?.[emptyHoldMediaKey] || null, emptyHoldDecoderFamily = _getVideoCodecFamily(emptyHoldInfo?.EnhancedDecoderCodec || emptyHoldInfo?.EnhancedDecoderCodecFamily);
        if (emptyHoldDecoderFamily === "hevc" || emptyHoldDecoderFamily === "av1") {
          const emptyHoldRequestSignal = opts?.signal || (typeof Request < "u" && resource instanceof Request ? resource.signal : null);
          throw _createCodecHandoffAbortError(emptyHoldRequestSignal);
        }
        return await _getEmptyAdHoldResponse(url, realFetch, opts?.signal || (typeof Request < "u" && resource instanceof Request ? resource.signal : null));
      }
      const segmentCodecOwners = __TTVAB_STATE__.SegmentCodecOwners;
      let segmentOwner = segmentCodecOwners?.get?.(url);
      segmentOwner === void 0 && (segmentOwner = segmentCodecOwners?.get?.(_getExactPlaylistUrlKey(url)));
      const segmentMediaKey = _normalizeMediaKey(segmentOwner?.mediaKey), segmentInfo = segmentMediaKey && __TTVAB_STATE__.StreamInfos?.[segmentMediaKey] || null;
      if (shouldBlockAdSegments && typeof _isKnownAdSegmentUrl == "function" && _isKnownAdSegmentUrl(url, {
        includeCached: shouldBlockCachedAdSegments
      })) {
        const segmentDecoderFamily = _getVideoCodecFamily(segmentInfo?.EnhancedDecoderCodec || segmentInfo?.EnhancedDecoderCodecFamily);
        if (segmentOwner?.codecFamily === "avc" && segmentDecoderFamily !== "hevc" && segmentDecoderFamily !== "av1") {
          const response2 = await realFetch(_EMPTY_SEGMENT_URL);
          return response2?.ok && segmentInfo?.MediaKey && reportPlaybackWorkerObserved(segmentInfo, null, null, playbackRequestOwner), response2;
        }
        const segmentRequestSignal = opts?.signal || (typeof Request < "u" && resource instanceof Request ? resource.signal : null);
        throw _createCodecHandoffAbortError(segmentRequestSignal);
      }
      const playbackContext = /\.m3u8(?:$|[?#])/i.test(url) ? _getPlaybackContextFromUsherUrl(url) : null;
      if (playbackContext?.MediaKey) {
        const requestMediaKey = playbackContext.MediaKey, requestPageMediaKey = _normalizeMediaKey(__TTVAB_STATE__.PageMediaKey), requestContextGeneration = Math.max(0, Number(__TTVAB_STATE__.PagePlaybackContextGeneration) || 0), requestSequence = ++masterRequestSequence, requestSignal = opts?.signal || (typeof Request < "u" && resource instanceof Request ? resource.signal : null), assertMasterRequestCurrent = () => {
          if (requestSignal?.aborted || _normalizeMediaKey(__TTVAB_STATE__.PageMediaKey) !== requestPageMediaKey || Math.max(0, Number(__TTVAB_STATE__.PagePlaybackContextGeneration) || 0) !== requestContextGeneration || Math.max(0, Number(committedMasterRequestByMediaKey.get(requestMediaKey)) || 0) > requestSequence)
            throw _createRequestAbortError(requestSignal);
        };
        __TTVAB_STATE__.V2API = url.includes("/api/v2/") || url.includes("/vod/v2/");
        const logTarget = playbackContext.MediaType === "vod" ? `vod ${playbackContext.VodID}` : playbackContext.ChannelName, reportPreviewMasterRecoveryFailure = (reason, status = 0) => {
          if (__TTVAB_STATE__.AllowPreviewEmergencyAutoplayBackup !== !0 || playbackContext.MediaType !== "live" || _normalizeMediaKey(__TTVAB_STATE__.PageMediaKey) !== requestMediaKey)
            return !1;
          const reasonCode = typeof reason == "string" && reason ? reason.slice(0, 48) : "failed", statusCode = Number.isFinite(status) && status >= 100 && status <= 599 ? Math.trunc(status) : 0;
          return !0;
        };
        if (__TTVAB_STATE__.RewriteNativePlaybackAccessToken === !0 && __TTVAB_STATE__.ForceAccessTokenPlayerType) {
          const urlObj = new URL(url);
          urlObj.searchParams.delete("parent_domains"), url = urlObj.toString();
        }
        let response2;
        try {
          response2 = await realFetch.apply(this, getFetchArgs(resource, opts, args, url));
        } catch (error) {
          if (assertMasterRequestCurrent(), !(__TTVAB_STATE__.AllowPreviewEmergencyAutoplayBackup === !0 && __TTVAB_STATE__.IsAdStrippingEnabled === !0 && playbackContext.MediaType === "live" && error?.name === "TypeError" && !requestSignal?.aborted))
            throw error;
          const retryUrl = new URL(url), previousCacheKey = retryUrl.searchParams.get("p");
          let nextCacheKey = String(Math.floor(Math.random() * 1e7));
          nextCacheKey === previousCacheKey && (nextCacheKey = String((Number(nextCacheKey) + 1) % 1e7)), retryUrl.searchParams.set("p", nextCacheKey), url = retryUrl.toString();
          const retryOptions = {
            ...opts && typeof opts == "object" ? opts : {},
            cache: "no-store"
          };
          try {
            response2 = await realFetch.apply(this, [
              typeof Request < "u" && resource instanceof Request ? new Request(url, resource) : url,
              retryOptions
            ]);
          } catch (retryError) {
            assertMasterRequestCurrent();
            let previewFailureReason = "retry-failed";
            if (retryError?.name === "TypeError" && !requestSignal?.aborted)
              try {
                const fallback = await _getValidatedPreviewMasterFallback(playbackContext, url, requestSignal);
                if (fallback)
                  return assertMasterRequestCurrent(), commitMasterRequest(requestMediaKey, requestSequence), reportPlaybackWorkerBootstrapObserved(playbackContext, playbackRequestOwner), new Response(fallback.master, {
                    status: 200,
                    headers: {
                      "Content-Type": "application/vnd.apple.mpegurl"
                    }
                  });
                previewFailureReason = "clean-fallback-unavailable";
              } catch (fallbackError) {
                if (requestSignal?.aborted || fallbackError?.name === "AbortError")
                  throw fallbackError;
                previewFailureReason = "fallback-validation-failed";
              }
            throw !requestSignal?.aborted && retryError?.name !== "AbortError" && reportPreviewMasterRecoveryFailure(previewFailureReason), retryError;
          }
        }
        if (assertMasterRequestCurrent(), response2.status !== 200)
          return reportPreviewMasterRecoveryFailure("http-status", response2.status), response2;
        let encodings = await response2.text();
        assertMasterRequestCurrent();
        const serverTime = _getServerTime(encodings);
        let info = __TTVAB_STATE__.StreamInfos[playbackContext.MediaKey];
        const pendingPostAdNativeMaster = await getPendingPostAdNativeMaster(info, playbackContext, requestSignal, assertMasterRequestCurrent);
        if (assertMasterRequestCurrent(), pendingPostAdNativeMaster) {
          const pending = info._PendingPostAdNativeMaster;
          return (info.EncodingsM3U8 !== pending.master || info.UsherBaseUrl !== pending.masterUrl) && _syncStreamInfo(info, pending.master, pending.masterUrl, !0), commitMasterRequest(requestMediaKey, requestSequence), info.LastActivityAt = Date.now(), reportPlaybackWorkerBootstrapObserved(playbackContext, playbackRequestOwner), new Response(_replaceServerTime(pendingPostAdNativeMaster, serverTime), getResponseInit(response2));
        }
        const recoveredNativeMaster = await getCleanNativeMasterAfterReduction(info, encodings, requestSignal, assertMasterRequestCurrent);
        assertMasterRequestCurrent(), recoveredNativeMaster && (encodings = recoveredNativeMaster.master);
        const previousModifiedM3U8 = typeof info?.ModifiedM3U8 == "string" && info.ModifiedM3U8 ? info.ModifiedM3U8 : null;
        try {
          info?.EncodingsM3U8 ? (info.MediaType = playbackContext.MediaType, info.MediaKey = playbackContext.MediaKey, info.ChannelName = playbackContext.ChannelName, info.VodID = playbackContext.VodID) : (_pruneStreamInfos(), info = __TTVAB_STATE__.StreamInfos[playbackContext.MediaKey] = _createStreamInfo(playbackContext)), _syncStreamInfo(info, encodings, recoveredNativeMaster?.masterUrl || url), commitMasterRequest(requestMediaKey, requestSequence), info.LastActivityAt = Date.now();
          const keepExactPreviewOnAvc = !!(__TTVAB_STATE__.AllowPreviewEmergencyAutoplayBackup === !0 && __TTVAB_STATE__.IsAdStrippingEnabled === !0 && info.ModifiedM3U8), playlist = info.IsUsingModifiedM3U8 || keepExactPreviewOnAvc ? info.ModifiedM3U8 : info.EncodingsM3U8;
          return reportPlaybackWorkerBootstrapObserved(playbackContext, playbackRequestOwner), new Response(_replaceServerTime(playlist, serverTime), getResponseInit(response2));
        } catch {
          if (info && _getActiveCodecHandoffIdForInfo(info) && __TTVAB_STATE__.IsAdStrippingEnabled === !0) {
            const filteredMaster = previousModifiedM3U8 || _dropEnhancedVariantLines(encodings.split(`
`)).kept.join(`
`);
            if (filteredMaster && filteredMaster !== encodings && filteredMaster.includes("#EXT-X-STREAM-INF"))
              return reportPlaybackWorkerBootstrapObserved(playbackContext, playbackRequestOwner), new Response(_replaceServerTime(filteredMaster, serverTime), getResponseInit(response2));
            const masterRequestSignal = opts?.signal || (typeof Request < "u" && resource instanceof Request ? resource.signal : null);
            throw _createCodecHandoffAbortError(masterRequestSignal);
          }
          return reportPlaybackWorkerBootstrapObserved(playbackContext, playbackRequestOwner), new Response(encodings, getResponseInit(response2));
        }
      }
      if (/\.m3u8(?:$|\?)/.test(url)) {
        const requestStartInfo = _getStreamInfoForPlaylist(url), requestStartMediaKey = _normalizeMediaKey(requestStartInfo?.MediaKey), requestStartDecoderCodec = requestStartInfo?.EnhancedDecoderCodec || requestStartInfo?.EnhancedDecoderCodecFamily, requestStartDecoderCodecFamily = _getVideoCodecFamily(requestStartDecoderCodec), requestStartDecoderCodecIdentity = _getVideoCodecIdentity(requestStartDecoderCodec), requestStartCodecs = _getDirectPlaybackResolutionForUrl(requestStartInfo, url)?.Codecs || _getPlaylistUrlAliases(url).map((alias) => _pageSideVariantCodecByUrl.get(alias)).find(Boolean) || null, requestStartCodecFamily = _getVideoCodecFamily(requestStartCodecs), requestStartCodecIdentity = _getVideoCodecIdentity(requestStartCodecs), requestStartCodecMatchesDecoder = requestStartDecoderCodecIdentity ? requestStartCodecIdentity === requestStartDecoderCodecIdentity : !!(requestStartDecoderCodecFamily && requestStartCodecFamily === requestStartDecoderCodecFamily), requestStartMayUseCachedAdSegments = !!(requestStartInfo && requestStartMediaKey && _normalizeMediaKey(__TTVAB_STATE__.CurrentAdMediaKey) === requestStartMediaKey), requestStartCycleStartedAt = requestStartMayUseCachedAdSegments ? Math.max(0, Number(requestStartInfo?.VisibleAdStartedAt) || 0, Number(__TTVAB_STATE__.AdPodProgressByMediaKey?.[requestStartMediaKey]?.cycleStartedAt) || 0) : 0, requestStartContext = {
          requestStartedAt: Date.now(),
          postAdNativeMasterServedAt: Math.max(0, Number(requestStartInfo?._PendingPostAdNativeMaster?.masterServedAt) || 0),
          mediaKey: requestStartMediaKey,
          loaderEpoch: Math.max(0, Number(requestStartInfo?.NativeRecoveryLoaderEpoch) || 0),
          backupSearchEpoch: Math.max(0, Number(requestStartInfo?.BackupSearchEpoch) || 0),
          cycleStartedAt: requestStartCycleStartedAt,
          enhancedDecoderCodec: requestStartDecoderCodec || null,
          requestCodec: requestStartCodecs,
          includeCachedAdSegments: requestStartMayUseCachedAdSegments
        }, requestStartHasEnhancedDecoderOwner = requestStartDecoderCodecFamily === "hevc" || requestStartDecoderCodecFamily === "av1", mediaRequestSignal = opts?.signal || (typeof Request < "u" && resource instanceof Request ? resource.signal : null), response2 = await realFetch.apply(this, getFetchArgs(resource, opts, args, _getEmptyHoldUpstreamUrl(requestStartInfo, url)));
        if (__TTVAB_STATE__.IsAdStrippingEnabled !== !0)
          return response2.status === 200 && requestStartInfo && reportPlaybackWorkerObserved(requestStartInfo, url, requestStartCodecs, playbackRequestOwner), response2;
        if (response2.status === 200) {
          const text = await response2.text(), responseInfo = requestStartInfo || _getStreamInfoForPlaylist(url), reportSuccessfulMediaResponse = () => {
            const successfulInfo = responseInfo || _getStreamInfoForPlaylist(url);
            if (successfulInfo?.MediaKey) {
              const successfulCodecs = _getDirectPlaybackResolutionForUrl(successfulInfo, url)?.Codecs || requestStartCodecs;
              reportPlaybackWorkerObserved(successfulInfo, url, successfulCodecs, playbackRequestOwner);
            }
          }, returnNativeMediaResponse = () => (reportSuccessfulMediaResponse(), new Response(text, getResponseInit(response2)));
          if (__TTVAB_STATE__.IsAdStrippingEnabled !== !0)
            return returnNativeMediaResponse();
          if (!isPlaybackObservationCurrent(playbackRequestOwner))
            throw _createCodecHandoffAbortError(mediaRequestSignal);
          const responseMediaKey = _normalizeMediaKey(responseInfo?.MediaKey), responseHasExactActiveAdContext = !!(responseInfo && responseMediaKey && _normalizeMediaKey(__TTVAB_STATE__.CurrentAdMediaKey) === responseMediaKey), responseDecoderCodec = responseInfo?.EnhancedDecoderCodec || responseInfo?.EnhancedDecoderCodecFamily, responseDecoderCodecFamily = _getVideoCodecFamily(responseDecoderCodec), responseDecoderCodecIdentity = _getVideoCodecIdentity(responseDecoderCodec), responseHasEnhancedDecoderOwner = responseDecoderCodecFamily === "hevc" || responseDecoderCodecFamily === "av1", responseActivatedCodecIsolation = !!(responseHasExactActiveAdContext && (!requestStartMayUseCachedAdSegments || !requestStartHasEnhancedDecoderOwner && responseHasEnhancedDecoderOwner) && (requestStartHasEnhancedDecoderOwner && !requestStartCodecMatchesDecoder || responseHasEnhancedDecoderOwner && !(responseDecoderCodecIdentity ? requestStartCodecIdentity === responseDecoderCodecIdentity : responseDecoderCodecFamily && requestStartCodecFamily === responseDecoderCodecFamily)));
          try {
            if (responseActivatedCodecIsolation) {
              const activatedRequestSignal = opts?.signal || (typeof Request < "u" && resource instanceof Request ? resource.signal : null);
              throw _createCodecHandoffAbortError(activatedRequestSignal);
            }
            const processedText = await _processM3U8(url, text, realFetch, mediaRequestSignal, requestStartContext);
            if (__TTVAB_STATE__.IsAdStrippingEnabled !== !0)
              return returnNativeMediaResponse();
            if (!isPlaybackObservationCurrent(playbackRequestOwner))
              throw _createCodecHandoffAbortError(mediaRequestSignal);
            return reportSuccessfulMediaResponse(), new Response(processedText, getResponseInit(response2));
          } catch (err) {
            if (__TTVAB_STATE__.IsAdStrippingEnabled !== !0 && mediaRequestSignal?.aborted !== !0)
              return returnNativeMediaResponse();
            if (err?.name === "AbortError")
              throw err;
            const failedInfo = requestStartInfo || _getStreamInfoForPlaylist(url), failedMediaKey = _normalizeMediaKey(failedInfo?.MediaKey), mayUseCachedAdSegments = !!(requestStartMayUseCachedAdSegments || failedInfo && failedMediaKey && _normalizeMediaKey(__TTVAB_STATE__.CurrentAdMediaKey) === failedMediaKey), requestWasAdMarked = _hasPlaylistAdMarkers(text) || _playlistHasKnownAdSegments(text, {
              includeCached: mayUseCachedAdSegments
            }), failedDecoderCodec = failedInfo?.EnhancedDecoderCodec || failedInfo?.EnhancedDecoderCodecFamily, failedDecoderCodecFamily = _getVideoCodecFamily(failedDecoderCodec), failedDecoderCodecIdentity = _getVideoCodecIdentity(failedDecoderCodec), failedNeedsCodecIsolation = !!(mayUseCachedAdSegments && (requestStartHasEnhancedDecoderOwner && !requestStartCodecMatchesDecoder || (failedDecoderCodecFamily === "hevc" || failedDecoderCodecFamily === "av1") && !(failedDecoderCodecIdentity ? requestStartCodecIdentity === failedDecoderCodecIdentity : failedDecoderCodecFamily && requestStartCodecFamily === failedDecoderCodecFamily)));
            if (!requestWasAdMarked) {
              if (failedNeedsCodecIsolation) {
                const failedRequestSignal = opts?.signal || (typeof Request < "u" && resource instanceof Request ? resource.signal : null);
                throw _createCodecHandoffAbortError(failedRequestSignal);
              }
              return reportSuccessfulMediaResponse(), new Response(_applyEmptyHoldPlaylistContinuity(failedInfo, url, text) ?? text, getResponseInit(response2));
            }
            if (_isEnhancedCodecString(_getDirectPlaybackResolutionForUrl(failedInfo, url)?.Codecs) || requestStartDecoderCodecFamily === "hevc" || requestStartDecoderCodecFamily === "av1" || failedDecoderCodecFamily === "hevc" || failedDecoderCodecFamily === "av1" || _getPlaylistUrlAliases(url).some((alias) => failedInfo?.EnhancedVariantUrls?.has(alias) || failedInfo?.EnhancedBackupVariantUrls?.has(alias))) {
              const failedRequestSignal = opts?.signal || (typeof Request < "u" && resource instanceof Request ? resource.signal : null);
              throw _createCodecHandoffAbortError(failedRequestSignal);
            }
            if (!failedInfo) {
              const failedRequestSignal = opts?.signal || (typeof Request < "u" && resource instanceof Request ? resource.signal : null);
              throw _createCodecHandoffAbortError(failedRequestSignal);
            }
            if ((requestStartCodecFamily || _getVideoCodecFamily(_getDirectPlaybackResolutionForUrl(failedInfo, url)?.Codecs)) !== "avc") {
              const failedRequestSignal = opts?.signal || (typeof Request < "u" && resource instanceof Request ? resource.signal : null);
              throw _createCodecHandoffAbortError(failedRequestSignal);
            }
            const failClosedPlaylist = _stripAds(text, !0, failedInfo);
            return reportSuccessfulMediaResponse(), new Response(_applyEmptyHoldPlaylistContinuity(failedInfo, url, failClosedPlaylist) ?? failClosedPlaylist, getResponseInit(response2));
          }
        }
        return response2;
      }
      const response = await realFetch.apply(this, args);
      return response?.ok && segmentInfo?.MediaKey && reportPlaybackWorkerObserved(segmentInfo, null, null, playbackRequestOwner), response;
    } catch (e) {
      const safeUrl = typeof requestUrl == "string" ? requestUrl.trimEnd() : null, isPlaybackRequest = !!(safeUrl && _getPlaybackContextFromUsherUrl(safeUrl)?.MediaKey || safeUrl && /\.m3u8(?:$|\?)/.test(safeUrl)), errorMessage = typeof e?.message == "string" ? e.message : String(e), isExpectedCancellation = e?.name === "AbortError" || /request cancel(?:ed|led)|cancel(?:ed|led)/i.test(errorMessage);
      throw e;
    }
  };
}
function _getVodAdRequest(urlStr, mediaKeyOrResolver) {
  if (__TTVAB_STATE__.IsAdStrippingEnabled !== !0)
    return null;
  const resolveMediaKey = typeof mediaKeyOrResolver == "function" ? mediaKeyOrResolver : null;
  let normalizedMediaKey = resolveMediaKey ? null : _normalizeMediaKey(mediaKeyOrResolver);
  if (!resolveMediaKey && !normalizedMediaKey?.startsWith("vod:"))
    return null;
  try {
    const parsedUrl = new URL(urlStr), isKnownAdOrigin = parsedUrl.origin === "https://edge.ads.twitch.tv" || parsedUrl.origin === "https://vaes.amazon-adsystem.com", isKnownAdPath = parsedUrl.pathname === "/2018-01-01/3p/ads" || parsedUrl.pathname === "/ads" || parsedUrl.pathname === "/ads/format";
    if (!isKnownAdOrigin || !isKnownAdPath || resolveMediaKey && (normalizedMediaKey = _normalizeMediaKey(resolveMediaKey()), !normalizedMediaKey?.startsWith("vod:")))
      return null;
    const sessionID = parsedUrl.searchParams.get("sid") || null;
    return {
      mediaKey: normalizedMediaKey,
      sessionID: sessionID && sessionID.length <= 512 ? sessionID : null
    };
  } catch {
    return null;
  }
}
function _isWorkerCommand(message) {
  if (message.targetMediaKey != null && typeof message.targetMediaKey != "string")
    return !1;
  const value = message.value;
  switch (message.key) {
    case "UpdateClientVersion":
    case "UpdateClientSession":
    case "UpdateDeviceId":
    case "UpdateClientIntegrityHeader":
    case "UpdateAuthorizationHeader":
    case "UpdateGQLHash":
    case "UpdateLastNativePlaybackAccessTokenPlayerType":
    case "UpdatePreferredQualityGroup":
      return value === null || typeof value == "string";
    case "UpdateToggleState":
    case "UpdateAdSpoofingState":
    case "UpdateAutoplayBackupState":
    case "UpdatePlayerHasPlayedOnce":
    case "UpdatePlayerIsPlaying":
      return typeof value == "boolean";
    case "UpdatePagePlaybackVisibleSinceAt":
    case "UpdateBackupSearchForceRefresh":
      return typeof value == "number" && Number.isFinite(value);
    case "Ping":
      return value == null;
    case "UpdatePageContext":
      return _hasWorkerMessageFields(value, {
        preservedMediaKey: "string",
        playbackContextGeneration: "number",
        allowPreviewEmergencyAutoplayBackup: "boolean"
      });
    case "UpdateCurrentAdContext":
      return value === null || _hasWorkerMessageFields(value);
    case "ReleasePlaybackContext":
      return _hasWorkerMessageFields(value);
    case "UpdateLastAdEndContext":
      return _hasWorkerMessageFields(value, {
        endedAt: "number",
        cycleStartedAt: "number"
      });
    case "UpdateAdPodProgress":
      return _hasWorkerMessageFields(value, {
        expectedPodLength: "number",
        maxAdPodPosition: "number",
        observedZeroAdPodPosition: "boolean",
        cycleStartedAt: "number",
        updatedAt: "number"
      }) && (value.adIds === void 0 || Array.isArray(value.adIds) && value.adIds.every((id) => typeof id == "string"));
    case "ClearAdPodProgress":
      return _hasWorkerMessageFields(value, { beforeCycleStartedAt: "number" }) && typeof value.mediaKey == "string";
    case "ResetAdCycleState":
      return _hasWorkerMessageFields(value, { cycleStartedAt: "number" });
    case "UpdatePinnedBackupPlayerContext":
      return value === null || _hasWorkerMessageFields(value, {
        type: "string",
        cycleStartedAt: "number"
      });
    case "PrepareFatalMediaRecovery":
      return _hasWorkerMessageFields(value, {
        recoveryId: "string",
        recoveryKind: "string",
        requestedAt: "number",
        cycleStartedAt: "number"
      }) && typeof value.recoveryId == "string";
    case "UpdateCodecHandoffContext":
    case "PreparePostAdNativeReload":
    case "TriggeredPlayerReload":
      return message.key === "TriggeredPlayerReload" && value === null || _hasWorkerMessageFields(value, {
        reason: "string",
        handoffId: "string",
        clearHandoffId: "string",
        cycleStartedAt: "number",
        reloadAt: "number",
        preserveNativeSession: "boolean"
      });
    case "CodecHandoffReloadFailed":
      return _hasWorkerMessageFields(value, {
        handoffId: "string",
        cycleStartedAt: "number"
      }) && typeof value.handoffId == "string";
    case "ResetPlaybackRecoveryState":
      return _hasWorkerMessageFields(value, {
        clearAdContext: "boolean",
        previousMediaKey: "string",
        preservedMediaKey: "string"
      });
    case "FetchResponse":
      return _hasWorkerMessageFields(value, {
        id: "string",
        status: "number",
        statusText: "string",
        ok: "boolean",
        redirected: "boolean",
        type: "string",
        url: "string",
        body: "string",
        error: "string"
      }) && typeof value.id == "string" && (value.headers === void 0 || value.headers !== null && typeof value.headers == "object" && !Array.isArray(value.headers) && Object.values(value.headers).every((entry) => typeof entry == "string"));
    case "ReleasePostAdNativeSession":
      return _hasWorkerMessageFields(value, {
        cycleStartedAt: "number",
        reloadAt: "number"
      }) && typeof value.mediaKey == "string" && typeof value.cycleStartedAt == "number" && typeof value.reloadAt == "number";
    default:
      return !1;
  }
}
function _getWorkerCommand(value) {
  const message = _getWorkerBridgeMessage(value);
  return message && _isWorkerCommand(message) ? message : null;
}
function _startPlaybackWorker(seed) {
  _declareState(self), __TTVAB_STATE__.GQLDeviceID = seed.state.GQLDeviceID, __TTVAB_STATE__.AuthorizationHeader = seed.state.AuthorizationHeader, __TTVAB_STATE__.ClientIntegrityHeader = seed.state.ClientIntegrityHeader, __TTVAB_STATE__.ClientVersion = seed.state.ClientVersion, __TTVAB_STATE__.ClientSession = seed.state.ClientSession, __TTVAB_STATE__.PlaybackAccessTokenHash = seed.state.PlaybackAccessTokenHash, __TTVAB_STATE__.LastNativePlaybackAccessTokenPlayerType = seed.state.LastNativePlaybackAccessTokenPlayerType, __TTVAB_STATE__.CurrentAdChannel = seed.state.CurrentAdChannel, __TTVAB_STATE__.CurrentAdMediaKey = seed.state.CurrentAdMediaKey, __TTVAB_STATE__.AdPodProgressByMediaKey = seed.state.AdPodProgressByMediaKey, __TTVAB_STATE__.LastAdEndedAt = seed.state.LastAdEndedAt, __TTVAB_STATE__.LastAdEndedChannel = seed.state.LastAdEndedChannel, __TTVAB_STATE__.LastAdEndedMediaKey = seed.state.LastAdEndedMediaKey, __TTVAB_STATE__.LastAdEndedCycleStartedAt = seed.state.LastAdEndedCycleStartedAt, __TTVAB_STATE__.PinnedBackupPlayerType = seed.state.PinnedBackupPlayerType, __TTVAB_STATE__.PinnedBackupPlayerChannel = seed.state.PinnedBackupPlayerChannel, __TTVAB_STATE__.PinnedBackupPlayerMediaKey = seed.state.PinnedBackupPlayerMediaKey, __TTVAB_STATE__.ActiveCodecHandoffId = seed.state.ActiveCodecHandoffId, __TTVAB_STATE__.ActiveCodecHandoffChannel = seed.state.ActiveCodecHandoffChannel, __TTVAB_STATE__.ActiveCodecHandoffMediaKey = seed.state.ActiveCodecHandoffMediaKey, __TTVAB_STATE__.IsAdStrippingEnabled = seed.state.IsAdStrippingEnabled, __TTVAB_STATE__.DisableAdSpoofing = seed.state.DisableAdSpoofing, __TTVAB_STATE__.DisableAutoplayBackup = seed.state.DisableAutoplayBackup, __TTVAB_STATE__.PageMediaType = seed.state.PageMediaType, __TTVAB_STATE__.PageChannel = seed.state.PageChannel, __TTVAB_STATE__.PageVodID = seed.state.PageVodID, __TTVAB_STATE__.PageMediaKey = seed.state.PageMediaKey, __TTVAB_STATE__.PagePlaybackContextGeneration = seed.state.PagePlaybackContextGeneration, __TTVAB_STATE__.AllowPreviewEmergencyAutoplayBackup = seed.state.AllowPreviewEmergencyAutoplayBackup, __TTVAB_STATE__.PagePlaybackVisibleSinceAt = seed.state.PagePlaybackVisibleSinceAt, __TTVAB_STATE__.PreferredQualityGroup = seed.state.PreferredQualityGroup, __TTVAB_STATE__.PlayerHasPlayedOnce = seed.state.PlayerHasPlayedOnce, __TTVAB_STATE__.PlayerIsPlaying = seed.state.PlayerIsPlaying, __TTVAB_STATE__.HasTriggeredPlayerReload = seed.state.HasTriggeredPlayerReload, __TTVAB_STATE__.PendingTriggeredPlayerReloadChannel = seed.state.PendingTriggeredPlayerReloadChannel, __TTVAB_STATE__.PendingTriggeredPlayerReloadMediaKey = seed.state.PendingTriggeredPlayerReloadMediaKey, __TTVAB_STATE__.PendingTriggeredPlayerReloadAt = seed.state.PendingTriggeredPlayerReloadAt, __TTVAB_STATE__.PendingTriggeredPlayerReloadCycleStartedAt = seed.state.PendingTriggeredPlayerReloadCycleStartedAt, self.addEventListener("message", (e) => {
    const data = _getWorkerCommand(e.data);
    if (data)
      switch (e.stopImmediatePropagation?.(), data.key) {
        case "UpdateClientVersion":
          __TTVAB_STATE__.ClientVersion = data.value;
          break;
        case "UpdateClientSession":
          __TTVAB_STATE__.ClientSession = data.value;
          break;
        case "UpdateDeviceId":
          __TTVAB_STATE__.GQLDeviceID = data.value;
          break;
        case "UpdateClientIntegrityHeader":
          __TTVAB_STATE__.ClientIntegrityHeader = data.value;
          break;
        case "UpdateAuthorizationHeader":
          __TTVAB_STATE__.AuthorizationHeader = data.value;
          break;
        case "UpdateToggleState":
          {
            const enabled = data.value === !0;
            if (!enabled) {
              for (const streamInfo of Object.values(__TTVAB_STATE__.StreamInfos))
                _resetStreamAdState(streamInfo);
              __TTVAB_STATE__.CurrentAdChannel = null, __TTVAB_STATE__.CurrentAdMediaKey = null, __TTVAB_STATE__.PinnedBackupPlayerType = null, __TTVAB_STATE__.PinnedBackupPlayerChannel = null, __TTVAB_STATE__.PinnedBackupPlayerMediaKey = null, __TTVAB_STATE__.ActiveCodecHandoffId = null, __TTVAB_STATE__.ActiveCodecHandoffChannel = null, __TTVAB_STATE__.ActiveCodecHandoffMediaKey = null, __TTVAB_STATE__.AdPodProgressByMediaKey = /* @__PURE__ */ Object.create(null), __TTVAB_STATE__.LastAdEndedAt = 0, __TTVAB_STATE__.LastAdEndedChannel = null, __TTVAB_STATE__.LastAdEndedMediaKey = null, __TTVAB_STATE__.LastAdEndedCycleStartedAt = 0, __TTVAB_STATE__.HasTriggeredPlayerReload = !1, __TTVAB_STATE__.PendingTriggeredPlayerReloadChannel = null, __TTVAB_STATE__.PendingTriggeredPlayerReloadMediaKey = null, __TTVAB_STATE__.PendingTriggeredPlayerReloadAt = 0, __TTVAB_STATE__.PendingTriggeredPlayerReloadCycleStartedAt = 0;
            }
            __TTVAB_STATE__.IsAdStrippingEnabled = enabled;
          }
          break;
        case "UpdateAdSpoofingState":
          __TTVAB_STATE__.DisableAdSpoofing = data.value === !0;
          break;
        case "UpdateAutoplayBackupState":
          {
            const shouldDisableAutoplayBackup = data.value === !0;
            if (__TTVAB_STATE__.DisableAutoplayBackup === shouldDisableAutoplayBackup)
              break;
            __TTVAB_STATE__.DisableAutoplayBackup = shouldDisableAutoplayBackup;
            for (const streamInfo of Object.values(__TTVAB_STATE__.StreamInfos))
              streamInfo._LastBackupSearchCompletedAt = 0;
          }
          break;
        case "UpdateGQLHash":
          __TTVAB_STATE__.PlaybackAccessTokenHash = data.value;
          break;
        case "UpdateLastNativePlaybackAccessTokenPlayerType":
          __TTVAB_STATE__.LastNativePlaybackAccessTokenPlayerType = data.value;
          break;
        case "UpdatePlayerHasPlayedOnce":
          __TTVAB_STATE__.PlayerHasPlayedOnce = data.value === !0;
          break;
        case "UpdatePlayerIsPlaying":
          __TTVAB_STATE__.PlayerIsPlaying = data.value === !0;
          break;
        case "Ping":
          _postWorkerBridgeMessage(self, { key: "Pong", value: null });
          break;
        case "UpdatePageContext":
          {
            const nextPageContext = _normalizePlaybackContext(data.value), preservedMediaKey = _normalizeMediaKey(data.value?.preservedMediaKey);
            if (!preservedMediaKey || __TTVAB_STATE__.PageMediaKey !== preservedMediaKey) {
              __TTVAB_STATE__.PageMediaType = nextPageContext.MediaType, __TTVAB_STATE__.PageChannel = nextPageContext.ChannelName, __TTVAB_STATE__.PageVodID = nextPageContext.VodID, __TTVAB_STATE__.PageMediaKey = nextPageContext.MediaKey, __TTVAB_STATE__.PagePlaybackContextGeneration = Math.max(0, Number(data.value?.playbackContextGeneration) || 0), typeof data.value?.allowPreviewEmergencyAutoplayBackup == "boolean" && (__TTVAB_STATE__.AllowPreviewEmergencyAutoplayBackup = data.value.allowPreviewEmergencyAutoplayBackup);
              const pendingReloadMediaKey = _normalizeMediaKey(__TTVAB_STATE__.PendingTriggeredPlayerReloadMediaKey), pendingReloadChannel = _normalizeChannelName(__TTVAB_STATE__.PendingTriggeredPlayerReloadChannel);
              (pendingReloadMediaKey && pendingReloadMediaKey !== nextPageContext.MediaKey || !pendingReloadMediaKey && pendingReloadChannel && pendingReloadChannel !== nextPageContext.ChannelName) && (__TTVAB_STATE__.HasTriggeredPlayerReload = !1, __TTVAB_STATE__.PendingTriggeredPlayerReloadChannel = null, __TTVAB_STATE__.PendingTriggeredPlayerReloadMediaKey = null, __TTVAB_STATE__.PendingTriggeredPlayerReloadAt = 0, __TTVAB_STATE__.PendingTriggeredPlayerReloadCycleStartedAt = 0);
            }
          }
          break;
        case "UpdatePreferredQualityGroup":
          __TTVAB_STATE__.PreferredQualityGroup = data.value || null;
          break;
        case "UpdatePagePlaybackVisibleSinceAt":
          __TTVAB_STATE__.PagePlaybackVisibleSinceAt = Math.max(0, Number(data.value) || 0);
          break;
        case "UpdateCurrentAdContext":
          {
            const nextAdContext = _normalizePlaybackContext(data.value);
            if (__TTVAB_STATE__.IsAdStrippingEnabled !== !0 && nextAdContext.MediaKey)
              break;
            __TTVAB_STATE__.CurrentAdChannel = nextAdContext.ChannelName, __TTVAB_STATE__.CurrentAdMediaKey = nextAdContext.MediaKey;
          }
          break;
        case "UpdateLastAdEndContext":
          {
            const lastEndContext = _normalizePlaybackContext(data.value);
            if (__TTVAB_STATE__.IsAdStrippingEnabled !== !0 && (lastEndContext.MediaKey || Number(data.value?.endedAt) > 0))
              break;
            __TTVAB_STATE__.LastAdEndedAt = Math.max(0, Number(data.value?.endedAt) || 0), __TTVAB_STATE__.LastAdEndedChannel = lastEndContext.ChannelName, __TTVAB_STATE__.LastAdEndedMediaKey = lastEndContext.MediaKey, __TTVAB_STATE__.LastAdEndedCycleStartedAt = Math.max(0, Number(data.value?.cycleStartedAt) || 0);
          }
          break;
        case "UpdateAdPodProgress":
          {
            if (__TTVAB_STATE__.IsAdStrippingEnabled !== !0)
              break;
            const progressContext = _normalizePlaybackContext(data.value), progressInfo = progressContext.MediaKey && __TTVAB_STATE__.StreamInfos[progressContext.MediaKey] || null;
            progressInfo ? _applyAdPodProgressToInfo(progressInfo, data.value) : _mergeAdPodProgress(data.value);
          }
          break;
        case "ClearAdPodProgress":
          _clearAdPodProgress(data.value?.mediaKey, data.value?.beforeCycleStartedAt);
          break;
        case "ResetAdCycleState":
          _resetWorkerAdCycleState(data.value);
          break;
        case "UpdatePinnedBackupPlayerContext":
          {
            const nextPinnedContext = _normalizePlaybackContext(data.value), nextPinnedType = data.value?.type || null;
            if (__TTVAB_STATE__.IsAdStrippingEnabled !== !0 && (nextPinnedType || nextPinnedContext.MediaKey))
              break;
            const nextPinnedCycleStartedAt = Math.max(0, Number(data.value?.cycleStartedAt) || 0), nextPinnedInfo = nextPinnedContext.MediaKey && __TTVAB_STATE__.StreamInfos[nextPinnedContext.MediaKey] || null;
            if (nextPinnedType && (!nextPinnedInfo || !_isCodecHandoffCycleCurrent(nextPinnedContext.MediaKey, nextPinnedCycleStartedAt, nextPinnedInfo)))
              break;
            __TTVAB_STATE__.PinnedBackupPlayerType = nextPinnedType, __TTVAB_STATE__.PinnedBackupPlayerChannel = nextPinnedContext.ChannelName, __TTVAB_STATE__.PinnedBackupPlayerMediaKey = nextPinnedContext.MediaKey;
          }
          break;
        case "PrepareFatalMediaRecovery":
          if (__TTVAB_STATE__.IsAdStrippingEnabled !== !0)
            break;
          typeof __TTVAB_STATE__.PrepareFatalMediaRecovery == "function" && __TTVAB_STATE__.PrepareFatalMediaRecovery(data.value);
          break;
        case "UpdateCodecHandoffContext":
          {
            const nextCodecHandoffContext = _normalizePlaybackContext(data.value), nextHandoffId = typeof data.value?.handoffId == "string" && data.value.handoffId ? data.value.handoffId : null;
            if (__TTVAB_STATE__.IsAdStrippingEnabled !== !0 && nextHandoffId)
              break;
            const clearHandoffId = typeof data.value?.clearHandoffId == "string" && data.value.clearHandoffId ? data.value.clearHandoffId : null;
            if (clearHandoffId) {
              for (const streamInfo of Object.values(__TTVAB_STATE__.StreamInfos))
                nextCodecHandoffContext.MediaKey && _normalizeMediaKey(streamInfo?.MediaKey) !== nextCodecHandoffContext.MediaKey || _clearCodecHandoffState(streamInfo, clearHandoffId);
              __TTVAB_STATE__.ActiveCodecHandoffId === clearHandoffId && (__TTVAB_STATE__.ActiveCodecHandoffId = null, __TTVAB_STATE__.ActiveCodecHandoffChannel = null, __TTVAB_STATE__.ActiveCodecHandoffMediaKey = null);
              break;
            }
            if (!nextHandoffId)
              break;
            const nextCycleStartedAt = Math.max(0, Number(data.value?.cycleStartedAt) || 0), encodedCycleStartedAt = _getCodecHandoffCycleStartedAt(nextHandoffId), currentAdMediaKey = _normalizeMediaKey(__TTVAB_STATE__.CurrentAdMediaKey), currentAdChannel = _normalizeChannelName(__TTVAB_STATE__.CurrentAdChannel);
            if (!nextCodecHandoffContext.MediaKey || nextCycleStartedAt <= 0 || encodedCycleStartedAt !== nextCycleStartedAt || currentAdMediaKey !== nextCodecHandoffContext.MediaKey || currentAdChannel && nextCodecHandoffContext.ChannelName && currentAdChannel !== nextCodecHandoffContext.ChannelName)
              break;
            const nextHandoffInfo = __TTVAB_STATE__.StreamInfos[nextCodecHandoffContext.MediaKey] || null;
            if (!nextHandoffInfo || !_isCodecHandoffCycleCurrent(nextCodecHandoffContext.MediaKey, nextCycleStartedAt, nextHandoffInfo))
              break;
            for (const streamInfo of Object.values(__TTVAB_STATE__.StreamInfos))
              nextCodecHandoffContext.MediaKey && _normalizeMediaKey(streamInfo?.MediaKey) !== nextCodecHandoffContext.MediaKey || !nextCodecHandoffContext.MediaKey && nextCodecHandoffContext.ChannelName && _normalizeChannelName(streamInfo?.ChannelName) !== nextCodecHandoffContext.ChannelName || _isCodecHandoffCycleCurrent(streamInfo.MediaKey, nextCycleStartedAt, streamInfo) && (streamInfo._CodecHandoffPendingId !== nextHandoffId && (streamInfo._CodecHandoffPendingId = nextHandoffId, streamInfo._CodecHandoffAcknowledgedId = null, streamInfo._CodecHandoffFailedId = null), streamInfo.ModifiedM3U8 && __TTVAB_STATE__.IsAdStrippingEnabled === !0 && (streamInfo.IsUsingModifiedM3U8 = !0));
            __TTVAB_STATE__.ActiveCodecHandoffId = nextHandoffId, __TTVAB_STATE__.ActiveCodecHandoffChannel = nextCodecHandoffContext.ChannelName, __TTVAB_STATE__.ActiveCodecHandoffMediaKey = nextCodecHandoffContext.MediaKey;
          }
          break;
        case "CodecHandoffReloadFailed":
          {
            const failedHandoffId = typeof data.value?.handoffId == "string" ? data.value.handoffId : null;
            if (!failedHandoffId)
              break;
            const failedContext = _normalizePlaybackContext(data.value), failedInfo = failedContext.MediaKey && __TTVAB_STATE__.StreamInfos[failedContext.MediaKey] || null;
            _markCodecHandoffReloadFailed(failedInfo, failedHandoffId), __TTVAB_STATE__.ActiveCodecHandoffId === failedHandoffId && (__TTVAB_STATE__.ActiveCodecHandoffId = null, __TTVAB_STATE__.ActiveCodecHandoffChannel = null, __TTVAB_STATE__.ActiveCodecHandoffMediaKey = null);
          }
          break;
        case "UpdateBackupSearchForceRefresh":
          __TTVAB_STATE__.BackupSearchForceRefreshAt = __TTVAB_STATE__.IsAdStrippingEnabled === !0 && Number(data.value) || 0;
          break;
        case "ResetPlaybackRecoveryState":
          {
            const preservedMediaKey = _normalizeMediaKey(data.value?.preservedMediaKey);
            if (!(preservedMediaKey && __TTVAB_STATE__.PageMediaKey === preservedMediaKey) && (__TTVAB_STATE__.HasTriggeredPlayerReload = !1, __TTVAB_STATE__.PendingTriggeredPlayerReloadChannel = null, __TTVAB_STATE__.PendingTriggeredPlayerReloadMediaKey = null, __TTVAB_STATE__.PendingTriggeredPlayerReloadAt = 0, __TTVAB_STATE__.PendingTriggeredPlayerReloadCycleStartedAt = 0, __TTVAB_STATE__.LastAdRecoveryReloadAt = 0, __TTVAB_STATE__.LastAdRecoveryResumeAt = 0, __TTVAB_STATE__.ShouldResumeAfterAd = !1, __TTVAB_STATE__.ShouldResumeAfterAdChannel = null, __TTVAB_STATE__.ShouldResumeAfterAdMediaKey = null, __TTVAB_STATE__.ShouldResumeAfterAdUntil = 0, data.value?.clearAdContext)) {
              for (const streamInfo of Object.values(__TTVAB_STATE__.StreamInfos))
                _clearCodecHandoffState(streamInfo);
              __TTVAB_STATE__.CurrentAdChannel = null, __TTVAB_STATE__.CurrentAdMediaKey = null, __TTVAB_STATE__.PinnedBackupPlayerType = null, __TTVAB_STATE__.PinnedBackupPlayerChannel = null, __TTVAB_STATE__.PinnedBackupPlayerMediaKey = null, __TTVAB_STATE__.ActiveCodecHandoffId = null, __TTVAB_STATE__.ActiveCodecHandoffChannel = null, __TTVAB_STATE__.ActiveCodecHandoffMediaKey = null, __TTVAB_STATE__.LastAdEndedAt = 0, __TTVAB_STATE__.LastAdEndedChannel = null, __TTVAB_STATE__.LastAdEndedMediaKey = null, __TTVAB_STATE__.LastAdEndedCycleStartedAt = 0;
            }
            const prevMediaKey = data.value?.previousMediaKey || null;
            if (prevMediaKey && prevMediaKey !== preservedMediaKey && _clearAdPodProgress(prevMediaKey), prevMediaKey && prevMediaKey !== preservedMediaKey && typeof __TTVAB_STATE__.StreamInfos == "object" && delete __TTVAB_STATE__.StreamInfos[prevMediaKey], prevMediaKey && prevMediaKey !== preservedMediaKey && typeof __TTVAB_STATE__.StreamInfosByUrl == "object")
              for (const u in __TTVAB_STATE__.StreamInfosByUrl)
                __TTVAB_STATE__.StreamInfosByUrl[u]?.MediaKey === prevMediaKey && delete __TTVAB_STATE__.StreamInfosByUrl[u];
          }
          break;
        case "ReleasePlaybackContext":
          {
            const releasedMediaKey = _normalizePlaybackContext(data.value).MediaKey;
            if (!releasedMediaKey)
              break;
            if (__TTVAB_STATE__.PagePlaybackContextGeneration = Math.max(0, Number(__TTVAB_STATE__.PagePlaybackContextGeneration) || 0) + 1, _clearAdPodProgress(releasedMediaKey), releasedMediaKey && typeof __TTVAB_STATE__.StreamInfos == "object" && delete __TTVAB_STATE__.StreamInfos[releasedMediaKey], releasedMediaKey && typeof __TTVAB_STATE__.StreamInfosByUrl == "object")
              for (const u in __TTVAB_STATE__.StreamInfosByUrl)
                __TTVAB_STATE__.StreamInfosByUrl[u]?.MediaKey === releasedMediaKey && delete __TTVAB_STATE__.StreamInfosByUrl[u];
            __TTVAB_STATE__.PageMediaKey === releasedMediaKey && (__TTVAB_STATE__.PageMediaType = null, __TTVAB_STATE__.PageChannel = null, __TTVAB_STATE__.PageVodID = null, __TTVAB_STATE__.PageMediaKey = null), __TTVAB_STATE__.CurrentAdMediaKey === releasedMediaKey && (__TTVAB_STATE__.CurrentAdChannel = null, __TTVAB_STATE__.CurrentAdMediaKey = null), __TTVAB_STATE__.PinnedBackupPlayerMediaKey === releasedMediaKey && (__TTVAB_STATE__.PinnedBackupPlayerType = null, __TTVAB_STATE__.PinnedBackupPlayerChannel = null, __TTVAB_STATE__.PinnedBackupPlayerMediaKey = null), __TTVAB_STATE__.ActiveCodecHandoffMediaKey === releasedMediaKey && (__TTVAB_STATE__.ActiveCodecHandoffId = null, __TTVAB_STATE__.ActiveCodecHandoffChannel = null, __TTVAB_STATE__.ActiveCodecHandoffMediaKey = null), __TTVAB_STATE__.ShouldResumeAfterAdMediaKey === releasedMediaKey && (__TTVAB_STATE__.ShouldResumeAfterAd = !1, __TTVAB_STATE__.ShouldResumeAfterAdChannel = null, __TTVAB_STATE__.ShouldResumeAfterAdMediaKey = null, __TTVAB_STATE__.ShouldResumeAfterAdUntil = 0);
          }
          break;
        case "FetchResponse":
          {
            const responseData = data.value, requestId = responseData?.id || null, pendingRequests = __TTVAB_STATE__.PendingFetchRequests;
            if (!requestId || !pendingRequests?.has(requestId))
              break;
            const pendingRequest = pendingRequests.get(requestId);
            pendingRequests.delete(requestId), responseData?.error ? pendingRequest.reject(responseData.error) : pendingRequest.resolve(responseData);
          }
          break;
        case "PreparePostAdNativeReload":
          _updatePostAdNativeMasterReload(__TTVAB_STATE__.StreamInfos[data.value?.mediaKey], data.value, !0);
          break;
        case "ReleasePostAdNativeSession":
          {
            const info = __TTVAB_STATE__.StreamInfos[data.value?.mediaKey], session = info?._PendingPostAdNativeMaster, confirmation = info?._PendingNativeReloadConfirmation;
            confirmation && confirmation.cycleStartedAt === Number(data.value?.cycleStartedAt) && confirmation.reloadAt <= Number(data.value?.reloadAt) && (info._PendingNativeReloadConfirmation = null), session && session.cycleStartedAt === Number(data.value?.cycleStartedAt) && (Number(session.reloadAt) || 0) <= Number(data.value?.reloadAt) && (_reportPostAdNativeSession(info, "released"), info._PendingPostAdNativeMaster = null);
          }
          break;
        case "TriggeredPlayerReload":
          {
            const reloadContext = _normalizePlaybackContext(data.value || {
              mediaType: __TTVAB_STATE__.PageMediaType,
              channelName: __TTVAB_STATE__.PageChannel,
              vodID: __TTVAB_STATE__.PageVodID,
              mediaKey: __TTVAB_STATE__.PageMediaKey
            }), handoffId = data.value?.reason === "codec-handoff" && typeof data.value?.handoffId == "string" ? data.value.handoffId : null, handoffCycleStartedAt = Math.max(0, Number(data.value?.cycleStartedAt) || 0), reloadAt = Math.max(0, Number(data.value?.reloadAt) || 0), handoffInfo = reloadContext.MediaKey && __TTVAB_STATE__.StreamInfos[reloadContext.MediaKey] || Object.values(__TTVAB_STATE__.StreamInfos).find((entry) => entry?.MediaKey === reloadContext.MediaKey || !reloadContext.MediaKey && entry?.ChannelName === reloadContext.ChannelName) || null, handoffOwnsCurrentAd = !!(handoffId && handoffCycleStartedAt > 0 && _getCodecHandoffCycleStartedAt(handoffId) === handoffCycleStartedAt && reloadContext.MediaKey && handoffInfo && _isCodecHandoffCycleCurrent(reloadContext.MediaKey, handoffCycleStartedAt, handoffInfo) && (!_normalizeChannelName(__TTVAB_STATE__.CurrentAdChannel) || !reloadContext.ChannelName || _normalizeChannelName(__TTVAB_STATE__.CurrentAdChannel) === reloadContext.ChannelName));
            if (handoffId && !handoffOwnsCurrentAd || !handoffId && handoffCycleStartedAt > 0 && !_isPageLifecycleCycleCurrent(reloadContext.MediaKey, handoffCycleStartedAt))
              break;
            handoffOwnsCurrentAd && (__TTVAB_STATE__.ActiveCodecHandoffId = handoffId, __TTVAB_STATE__.ActiveCodecHandoffChannel = reloadContext.ChannelName, __TTVAB_STATE__.ActiveCodecHandoffMediaKey = reloadContext.MediaKey), handoffOwnsCurrentAd && handoffInfo?._CodecHandoffPendingId === handoffId && (handoffInfo._CodecHandoffAcknowledgedId = handoffId);
            const confirmation = handoffInfo?._PendingNativeReloadConfirmation;
            if (confirmation?.reloadAt === reloadAt && confirmation.cycleStartedAt === handoffCycleStartedAt && confirmation.mediaKey === reloadContext.MediaKey && confirmation.pageGeneration === (Number(__TTVAB_STATE__.PagePlaybackContextGeneration) || 0) && confirmation.loaderEpoch === (Number(handoffInfo.NativeRecoveryLoaderEpoch) || 0) && Date.now() - reloadAt < 3e4)
              break;
            const repeatsPendingReload = reloadAt > 0 && _normalizeMediaKey(__TTVAB_STATE__.PendingTriggeredPlayerReloadMediaKey) === reloadContext.MediaKey && Math.max(0, Number(__TTVAB_STATE__.PendingTriggeredPlayerReloadAt) || 0) === reloadAt && Math.max(0, Number(__TTVAB_STATE__.PendingTriggeredPlayerReloadCycleStartedAt) || 0) === handoffCycleStartedAt;
            handoffInfo && !repeatsPendingReload && (_invalidateNativeRecoveryAfterPlayerReload(handoffInfo, !0), _updatePostAdNativeMasterReload(handoffInfo, data.value)), __TTVAB_STATE__.HasTriggeredPlayerReload = !0, __TTVAB_STATE__.PendingTriggeredPlayerReloadChannel = reloadContext.ChannelName, __TTVAB_STATE__.PendingTriggeredPlayerReloadMediaKey = reloadContext.MediaKey, __TTVAB_STATE__.PendingTriggeredPlayerReloadAt = reloadAt || Date.now(), __TTVAB_STATE__.PendingTriggeredPlayerReloadCycleStartedAt = handoffCycleStartedAt;
          }
          break;
        default:
          break;
      }
  }), _hookWorkerFetch();
}
_startPlaybackWorker(_TTVAB_WORKER_SEED);
