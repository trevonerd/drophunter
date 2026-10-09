// Adapted from TTV-AB v20.0.0, GosuDRM.
// https://github.com/GosuDRM/TTV-AB/tree/11c2a7ea17fcda83c21129e3bfddd208385be142
// See public/licenses/ttv-ab.txt.
export function startTwitchAdblock(_DROPHUNTER_WORKER_SOURCE) {
const _C = {
    VERSION: "20.0.0",
    INTERNAL_VERSION: 2e5,
    AD_SIGNIFIER: "stitched",
    CLIENT_ID: "kimne78kx3ncx6brgo4mv6wki5h1ko",
    PLAYER_TYPES: ["site", "embed", "popout", "mobile_web", "autoplay"],
    FALLBACK_TYPE: "embed",
    FORCE_TYPE: "popout",
    RELOAD_TIME: 1500,
    PLAYER_RELOAD_DEBOUNCE_MS: 1500,
    AD_CYCLE_STALE_MS: 3e4,
    AD_END_GRACE_MS: 500,
    AD_END_MAX_WAIT_MS: 4e3,
    AD_END_BACKUP_HOLD_MAX_MS: 9e4,
    AD_END_MIN_CLEAN_PLAYLISTS: 3,
    AD_END_MIN_NATIVE_RECOVERY_PROBES: 3,
    AD_END_NATIVE_RECOVERY_PROBE_COOLDOWN_MS: 500,
    AD_END_MAX_FAILED_NATIVE_PROBES: 6,
    AD_RECOVERY_RELOAD_COOLDOWN_MS: 3e4,
    PINNED_BACKUP_STALL_DETECTION_MS: 3e3,
    PINNED_BACKUP_STALL_POLL_MS: 1500,
    BUFFERING_FIX: !0,
    RELOAD_AFTER_AD: !0,
    REWRITE_NATIVE_PLAYBACK_ACCESS_TOKEN: !1,
    PLAYER_BUFFERING_DO_PLAYER_RELOAD: !1,
    LQ_HQ_HOLD_MIN_MS: 8e3
};
const _S = {
    workers: [],
    workerRefs: [],
    conflicts: ["twitch", "isVariantA"],
    reinsertPatterns: ["isVariantA"],
    toleratedWorkerWrappers: [
        {
            name: "TwitchNoSub",
            signatures: ["${patch_url}", "twitchBlobUrl", "getWasmWorkerJs"]
        }
    ]
};
const _MAX_DORMANT_WORKER_REFS = 128;
const _MAX_PLAYER_RELOAD_MEDIA_KEYS = 32;
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
function _isWorkerFetchOptions(value) {
  if (!value || typeof value != "object" || Array.isArray(value))
    return !1;
  const options = value;
  for (const field of ["method", "referrer", "integrity"])
    if (options[field] !== void 0 && typeof options[field] != "string")
      return !1;
  if (options.body != null && typeof options.body != "string" || options.keepalive !== void 0 && typeof options.keepalive != "boolean")
    return !1;
  const enums = {
    cache: [
      "default",
      "no-store",
      "reload",
      "no-cache",
      "force-cache",
      "only-if-cached"
    ],
    credentials: ["omit", "same-origin", "include"],
    mode: ["navigate", "same-origin", "no-cors", "cors"],
    redirect: ["follow", "error", "manual"],
    referrerPolicy: [
      "",
      "no-referrer",
      "no-referrer-when-downgrade",
      "same-origin",
      "origin",
      "strict-origin",
      "origin-when-cross-origin",
      "strict-origin-when-cross-origin",
      "unsafe-url"
    ],
    priority: ["high", "low", "auto"]
  };
  for (const [field, values] of Object.entries(enums))
    if (options[field] !== void 0 && (typeof options[field] != "string" || !values.includes(options[field])))
      return !1;
  const headers = options.headers;
  return headers === void 0 || (Array.isArray(headers) ? headers.every((entry) => Array.isArray(entry) && entry.length === 2 && entry.every((part) => typeof part == "string")) : headers !== null && typeof headers == "object" && Object.values(headers).every((entry) => typeof entry == "string"));
}
function _isWorkerEvent(message) {
  if (!_hasWorkerMessageFields(message, {
    channel: "string",
    pageChannel: "string",
    pageMediaKey: "string",
    pageContextGeneration: "number",
    cycleStartedAt: "number",
    handoffId: "string"
  }))
    return !1;
  switch (message.key) {
    case "Pong":
      return message.value == null;
    case "CancelFetchRequest":
      return _hasWorkerMessageFields(message.value) && typeof message.value.id == "string";
    case "FetchRequest":
      return _hasWorkerMessageFields(message.value) && typeof message.value.id == "string" && typeof message.value.url == "string" && (message.value.options == null || _isWorkerFetchOptions(message.value.options));
    case "PlaybackWorkerObserved":
      return _hasWorkerMessageFields(message, {
        playlistUrl: "string",
        codec: "string",
        decoderCodec: "string"
      });
    case "PlaybackWorkerBootstrapObserved":
    case "MediaBootstrapRecoveryNeeded":
    case "PauseResumePlayer":
      return !0;
    case "AdPodProgress":
      return _hasWorkerMessageFields(message, {
        expectedPodLength: "number",
        maxAdPodPosition: "number",
        observedZeroAdPodPosition: "boolean",
        updatedAt: "number"
      }) && (message.adIds === void 0 || Array.isArray(message.adIds) && message.adIds.every((id) => typeof id == "string"));
    case "AdDetected":
      return _hasWorkerMessageFields(message, {
        continued: "boolean",
        detectedAt: "number",
        playlistUrl: "string",
        codec: "string"
      });
    case "AdEnded":
      return _hasWorkerMessageFields(message, {
        endedAt: "number",
        holdingBackup: "boolean",
        willReload: "boolean"
      });
    case "BackupPlayerTypeSelected":
      return message.value === null || typeof message.value == "string";
    case "FatalMediaRecoveryReady":
      return _hasWorkerMessageFields(message, {
        verifiedAt: "number",
        requiresCodecHandoff: "boolean",
        backupPlayerType: "string"
      }) && typeof message.recoveryId == "string";
    case "PostAdNativeReloadReady":
      return _hasWorkerMessageFields(message, {
        reloadAt: "number",
        confirmedAt: "number",
        loaderEpoch: "number"
      });
    case "NativePlaybackRestored":
      return _hasWorkerMessageFields(message, {
        restoredAt: "number",
        fromSilentBackupHold: "boolean",
        requiresReload: "boolean",
        continuePlayback: "boolean",
        refreshAccessToken: "boolean"
      });
    case "ReloadPlayer":
      return _hasWorkerMessageFields(message, {
        reason: "string",
        refreshAccessToken: "boolean",
        newMediaPlayerInstance: "boolean"
      });
    default:
      return !1;
  }
}
function _getWorkerEvent(value) {
  const message = _getWorkerBridgeMessage(value);
  return message && _isWorkerEvent(message) ? message : null;
}
function _postWorkerBridgeMessage(target, message) {
  if (!target || typeof target.postMessage != "function")
    return !1;
  const envelope = _createWorkerBridgeMessage(message);
  return envelope ? (target.postMessage(envelope), !0) : !1;
}
function _forgetDormantWorker(worker) {
  if (!Array.isArray(_S.workerRefs) || _S.workerRefs.length === 0)
    return !1;
  const previousLength = _S.workerRefs.length;
  return _S.workerRefs = _S.workerRefs.filter((workerRef) => {
    const candidate = workerRef?.deref?.();
    return candidate && candidate !== worker;
  }), _S.workerRefs.length !== previousLength;
}
function _rememberDormantWorker(worker) {
  return !worker || typeof WeakRef != "function" ? !1 : (Array.isArray(_S.workerRefs) || (_S.workerRefs = []), _forgetDormantWorker(worker), _S.workerRefs.push(new WeakRef(worker)), _S.workerRefs.length > _MAX_DORMANT_WORKER_REFS && (_S.workerRefs = _S.workerRefs.filter((workerRef) => workerRef?.deref?.()).slice(-_MAX_DORMANT_WORKER_REFS)), !0);
}
function _broadcastWorkers(messages) {
  const queue = Array.isArray(messages) ? messages : [messages], workerRefs = Array.isArray(_S.workerRefs) ? _S.workerRefs : [];
  if (queue.length === 0 || _S.workers.length === 0 && workerRefs.length === 0)
    return;
  const aliveWorkers = [], aliveWorkerRefs = [], seenWorkers = /* @__PURE__ */ new Set(), sendMessages = (worker) => {
    if (!worker || seenWorkers.has(worker) || worker.__TTVABIntentionallyTerminated || worker.__TTVABCrashed)
      return !1;
    seenWorkers.add(worker);
    let isAlive = !0;
    for (const message of queue)
      try {
        const targetMediaKey = _normalizeMediaKey(message?.targetMediaKey), workerPlaybackContext = typeof _getWorkerPlaybackContext == "function" ? _getWorkerPlaybackContext(worker) : null, requiresExactTarget = message?.key === "UpdatePagePlaybackVisibleSinceAt";
        if (targetMediaKey && (requiresExactTarget && workerPlaybackContext?.MediaKey !== targetMediaKey || !requiresExactTarget && workerPlaybackContext?.MediaKey && workerPlaybackContext.MediaKey !== targetMediaKey))
          continue;
        if (message?.key === "UpdatePageContext" || message?.key === "ResetPlaybackRecoveryState") {
          const preservedMediaKey = _normalizeMediaKey(message.value?.preservedMediaKey), workerMediaKey = _normalizeMediaKey(worker?.__TTVABPageMediaKey);
          if (preservedMediaKey && (workerMediaKey === preservedMediaKey || typeof _getActivePictureInPictureWorkerContext == "function" && _getActivePictureInPictureWorkerContext(worker, preservedMediaKey)))
            continue;
          message.key === "UpdatePageContext" && typeof _rememberWorkerPageContext == "function" && _rememberWorkerPageContext(worker, message.value);
        }
        if (!_postWorkerBridgeMessage(worker, message)) {
          isAlive = !1;
          break;
        }
      } catch {
        isAlive = !1;
        break;
      }
    return isAlive;
  };
  for (const worker of _S.workers)
    sendMessages(worker) && aliveWorkers.push(worker);
  for (const workerRef of workerRefs) {
    const worker = workerRef?.deref?.();
    sendMessages(worker) && aliveWorkerRefs.push(workerRef);
  }
  _S.workers = aliveWorkers, _S.workerRefs = aliveWorkerRefs.slice(-_MAX_DORMANT_WORKER_REFS);
}
function _setPagePlaybackContext(context, options = {}) {
  if (typeof __TTVAB_STATE__ > "u" || !__TTVAB_STATE__)
    return _normalizePlaybackContext(context);
  const normalizedContext = _normalizePlaybackContext(context), previousMediaKey = __TTVAB_STATE__.PageMediaKey || null, previousRouteKey = __TTVAB_STATE__.PagePlaybackRouteKey || previousMediaKey, nextRouteKey = options.pageRouteKey || normalizedContext.MediaKey, didRouteKeyChange = previousRouteKey !== nextRouteKey, previousPreviewEmergencyAutoplay = __TTVAB_STATE__.AllowPreviewEmergencyAutoplayBackup === !0, nextPreviewEmergencyAutoplay = typeof options.allowPreviewEmergencyAutoplayBackup == "boolean" ? options.allowPreviewEmergencyAutoplayBackup : previousPreviewEmergencyAutoplay, activePipContext = typeof _getActivePictureInPicturePlaybackContext == "function" ? _getActivePictureInPicturePlaybackContext() : null, preservedMediaKey = _normalizeMediaKey(activePipContext?.MediaKey), preservesCurrentAd = !!(preservedMediaKey && _normalizeMediaKey(__TTVAB_STATE__.CurrentAdMediaKey) === preservedMediaKey), preservesPinnedBackup = !!(preservedMediaKey && _normalizeMediaKey(__TTVAB_STATE__.PinnedBackupPlayerMediaKey) === preservedMediaKey), preservesCodecHandoff = !!(preservedMediaKey && _normalizeMediaKey(__TTVAB_STATE__.ActiveCodecHandoffMediaKey) === preservedMediaKey), preservesResumeIntent = !!(preservedMediaKey && __TTVAB_STATE__.ShouldResumeAfterAd === !0 && _normalizeMediaKey(__TTVAB_STATE__.ShouldResumeAfterAdMediaKey) === preservedMediaKey), preservesLastAdEnd = !!(preservedMediaKey && _normalizeMediaKey(__TTVAB_STATE__.LastAdEndedMediaKey) === preservedMediaKey), preservesPendingReload = !!(preservedMediaKey && _normalizeMediaKey(__TTVAB_STATE__.PendingTriggeredPlayerReloadMediaKey) === preservedMediaKey);
  let didResetAdScopedState = !1;
  const hasChanged = __TTVAB_STATE__.PageMediaType !== normalizedContext.MediaType || __TTVAB_STATE__.PageChannel !== normalizedContext.ChannelName || __TTVAB_STATE__.PageVodID !== normalizedContext.VodID || previousMediaKey !== normalizedContext.MediaKey || previousPreviewEmergencyAutoplay !== nextPreviewEmergencyAutoplay || didRouteKeyChange, didMediaKeyChange = previousMediaKey !== normalizedContext.MediaKey;
  if (__TTVAB_STATE__.PageMediaType = normalizedContext.MediaType, __TTVAB_STATE__.PageChannel = normalizedContext.ChannelName, __TTVAB_STATE__.PageVodID = normalizedContext.VodID, __TTVAB_STATE__.PageMediaKey = normalizedContext.MediaKey, __TTVAB_STATE__.PagePlaybackRouteKey = nextRouteKey, __TTVAB_STATE__.AllowPreviewEmergencyAutoplayBackup = nextPreviewEmergencyAutoplay, (didMediaKeyChange || didRouteKeyChange) && (__TTVAB_STATE__.PagePlaybackContextGeneration = Math.max(0, Number(__TTVAB_STATE__.PagePlaybackContextGeneration) || 0) + 1), didMediaKeyChange) {
    if (typeof _resetPlaybackIntentForNavigation == "function" && _resetPlaybackIntentForNavigation(normalizedContext.ChannelName, normalizedContext.MediaKey, 2500, preservedMediaKey), typeof _clearSuppressedMediaTracking == "function" && _clearSuppressedMediaTracking({
      restoreConnected: !1,
      preserveMediaKey: preservedMediaKey
    }), typeof _clearPlaybackRecoveryTimeouts == "function" && _clearPlaybackRecoveryTimeouts(preservedMediaKey), preservesPendingReload || (__TTVAB_STATE__.HasTriggeredPlayerReload = !1, __TTVAB_STATE__.PendingTriggeredPlayerReloadChannel = null, __TTVAB_STATE__.PendingTriggeredPlayerReloadMediaKey = null, __TTVAB_STATE__.PendingTriggeredPlayerReloadAt = 0, __TTVAB_STATE__.PendingTriggeredPlayerReloadCycleStartedAt = 0), __TTVAB_STATE__.LastPlayerReloadAt = 0, preservesResumeIntent || (__TTVAB_STATE__.ShouldResumeAfterAd = !1, __TTVAB_STATE__.ShouldResumeAfterAdChannel = null, __TTVAB_STATE__.ShouldResumeAfterAdMediaKey = null, __TTVAB_STATE__.ShouldResumeAfterAdUntil = 0), preservesCurrentAd || (__TTVAB_STATE__.LastAdRecoveryReloadAt = 0, __TTVAB_STATE__.LastAdRecoveryResumeAt = 0, __TTVAB_STATE__._AdRecoveryConsecutiveFailures = 0), preservesLastAdEnd || (__TTVAB_STATE__.LastAdEndedAt = 0, __TTVAB_STATE__.LastAdEndedChannel = null, __TTVAB_STATE__.LastAdEndedMediaKey = null, __TTVAB_STATE__.LastAdEndedCycleStartedAt = 0), previousMediaKey && previousMediaKey !== preservedMediaKey) {
      _invalidateAdCycleAsyncWork(__TTVAB_STATE__.StreamInfos[previousMediaKey]), delete __TTVAB_STATE__.StreamInfos[previousMediaKey], delete __TTVAB_STATE__.AdPodProgressByMediaKey?.[previousMediaKey];
      for (const url in __TTVAB_STATE__.StreamInfosByUrl)
        __TTVAB_STATE__.StreamInfosByUrl[url]?.MediaKey === previousMediaKey && delete __TTVAB_STATE__.StreamInfosByUrl[url];
    }
    preservesCurrentAd || (__TTVAB_STATE__.CurrentAdChannel = null, __TTVAB_STATE__.CurrentAdMediaKey = null), preservesPinnedBackup || (__TTVAB_STATE__.PinnedBackupPlayerType = null, __TTVAB_STATE__.PinnedBackupPlayerChannel = null, __TTVAB_STATE__.PinnedBackupPlayerMediaKey = null), preservesCodecHandoff || (__TTVAB_STATE__.ActiveCodecHandoffId = null, __TTVAB_STATE__.ActiveCodecHandoffChannel = null, __TTVAB_STATE__.ActiveCodecHandoffMediaKey = null), didResetAdScopedState = !0;
  }
  if (options.broadcast !== !1 && hasChanged) {
    const messages = [
      {
        key: "UpdatePageContext",
        value: {
          mediaType: normalizedContext.MediaType,
          channelName: normalizedContext.ChannelName,
          vodID: normalizedContext.VodID,
          mediaKey: normalizedContext.MediaKey,
          allowPreviewEmergencyAutoplayBackup: nextPreviewEmergencyAutoplay,
          playbackContextGeneration: Math.max(0, Number(__TTVAB_STATE__.PagePlaybackContextGeneration) || 0),
          preservedMediaKey
        }
      }
    ];
    didMediaKeyChange && messages.push({
      key: "ResetPlaybackRecoveryState",
      value: {
        clearAdContext: didResetAdScopedState,
        previousMediaKey: previousMediaKey || null,
        preservedMediaKey
      }
    }), didResetAdScopedState && !preservedMediaKey && (messages.push({
      key: "UpdateCurrentAdContext",
      value: null
    }), messages.push({
      key: "UpdatePinnedBackupPlayerContext",
      value: null
    })), _broadcastWorkers(messages), didMediaKeyChange && typeof _syncPagePlaybackVisibilityState == "function" && _syncPagePlaybackVisibilityState();
  }
  return normalizedContext;
}
function _releasePlaybackContext(context) {
  if (typeof __TTVAB_STATE__ > "u" || !__TTVAB_STATE__)
    return !1;
  const releasedContext = _normalizePlaybackContext(context), releasedMediaKey = releasedContext.MediaKey;
  if (!releasedMediaKey)
    return !1;
  _invalidateAdCycleAsyncWork(__TTVAB_STATE__.StreamInfos[releasedMediaKey]), delete __TTVAB_STATE__.StreamInfos[releasedMediaKey], delete __TTVAB_STATE__.AdPodProgressByMediaKey?.[releasedMediaKey], delete __TTVAB_STATE__.LastPlayerReloadAtByMediaKey?.[releasedMediaKey];
  for (const url in __TTVAB_STATE__.StreamInfosByUrl)
    __TTVAB_STATE__.StreamInfosByUrl[url]?.MediaKey === releasedMediaKey && delete __TTVAB_STATE__.StreamInfosByUrl[url];
  return _normalizeMediaKey(__TTVAB_STATE__.CurrentAdMediaKey) === releasedMediaKey && (__TTVAB_STATE__.CurrentAdChannel = null, __TTVAB_STATE__.CurrentAdMediaKey = null), _normalizeMediaKey(__TTVAB_STATE__.PinnedBackupPlayerMediaKey) === releasedMediaKey && (__TTVAB_STATE__.PinnedBackupPlayerType = null, __TTVAB_STATE__.PinnedBackupPlayerChannel = null, __TTVAB_STATE__.PinnedBackupPlayerMediaKey = null), _normalizeMediaKey(__TTVAB_STATE__.ActiveCodecHandoffMediaKey) === releasedMediaKey && (__TTVAB_STATE__.ActiveCodecHandoffId = null, __TTVAB_STATE__.ActiveCodecHandoffChannel = null, __TTVAB_STATE__.ActiveCodecHandoffMediaKey = null), _normalizeMediaKey(__TTVAB_STATE__.LastAdEndedMediaKey) === releasedMediaKey && (__TTVAB_STATE__.LastAdEndedAt = 0, __TTVAB_STATE__.LastAdEndedChannel = null, __TTVAB_STATE__.LastAdEndedMediaKey = null, __TTVAB_STATE__.LastAdEndedCycleStartedAt = 0), _normalizeMediaKey(__TTVAB_STATE__.PendingTriggeredPlayerReloadMediaKey) === releasedMediaKey && (__TTVAB_STATE__.HasTriggeredPlayerReload = !1, __TTVAB_STATE__.PendingTriggeredPlayerReloadChannel = null, __TTVAB_STATE__.PendingTriggeredPlayerReloadMediaKey = null, __TTVAB_STATE__.PendingTriggeredPlayerReloadAt = 0, __TTVAB_STATE__.PendingTriggeredPlayerReloadCycleStartedAt = 0), _normalizeMediaKey(__TTVAB_STATE__.ShouldResumeAfterAdMediaKey) === releasedMediaKey && (__TTVAB_STATE__.ShouldResumeAfterAd = !1, __TTVAB_STATE__.ShouldResumeAfterAdChannel = null, __TTVAB_STATE__.ShouldResumeAfterAdMediaKey = null, __TTVAB_STATE__.ShouldResumeAfterAdUntil = 0), typeof _clearPlaybackRecoveryTimeoutsForContext == "function" && _clearPlaybackRecoveryTimeoutsForContext(releasedMediaKey), typeof _clearSuppressedMediaTracking == "function" && _clearSuppressedMediaTracking({
    restoreConnected: !0,
    onlyMediaKey: releasedMediaKey
  }), _broadcastWorkers({
    key: "ReleasePlaybackContext",
    targetMediaKey: releasedMediaKey,
    value: {
      mediaType: releasedContext.MediaType,
      channelName: releasedContext.ChannelName,
      vodID: releasedContext.VodID,
      mediaKey: releasedMediaKey
    }
  }), !0;
}
function _getPlayerReloadAtForMediaKey(mediaKey) {
  const normalizedMediaKey = _normalizeMediaKey(mediaKey);
  return normalizedMediaKey ? Math.max(0, Number(__TTVAB_STATE__?.LastPlayerReloadAtByMediaKey?.[normalizedMediaKey]) || 0) : 0;
}
function _recordPlayerReloadAt(mediaKey, at = Date.now()) {
  const normalizedMediaKey = _normalizeMediaKey(mediaKey), normalizedAt = Math.max(0, Number(at) || 0);
  if (!normalizedMediaKey || normalizedAt <= 0)
    return 0;
  (!__TTVAB_STATE__.LastPlayerReloadAtByMediaKey || typeof __TTVAB_STATE__.LastPlayerReloadAtByMediaKey != "object") && (__TTVAB_STATE__.LastPlayerReloadAtByMediaKey = /* @__PURE__ */ Object.create(null)), delete __TTVAB_STATE__.LastPlayerReloadAtByMediaKey[normalizedMediaKey], __TTVAB_STATE__.LastPlayerReloadAtByMediaKey[normalizedMediaKey] = normalizedAt;
  const protectedMediaKeys = new Set([
    _normalizeMediaKey(__TTVAB_STATE__.PageMediaKey),
    _normalizeMediaKey(__TTVAB_STATE__.CurrentAdMediaKey),
    _normalizeMediaKey(__TTVAB_STATE__.PinnedBackupPlayerMediaKey),
    _normalizeMediaKey(typeof _getActivePictureInPicturePlaybackContext == "function" ? _getActivePictureInPicturePlaybackContext()?.MediaKey : null)
  ].filter(Boolean));
  let reloadMediaKeys = Object.keys(__TTVAB_STATE__.LastPlayerReloadAtByMediaKey);
  for (const candidateMediaKey of reloadMediaKeys) {
    if (reloadMediaKeys.length <= _MAX_PLAYER_RELOAD_MEDIA_KEYS)
      break;
    protectedMediaKeys.has(candidateMediaKey) || (delete __TTVAB_STATE__.LastPlayerReloadAtByMediaKey[candidateMediaKey], reloadMediaKeys = reloadMediaKeys.filter((mediaKeyEntry) => mediaKeyEntry !== candidateMediaKey));
  }
  return normalizedAt;
}
function _syncPagePlaybackContext(options = {}) {
  const pageUrl = globalThis?.location?.href || "", playbackContext = _getPlaybackContextFromUrl(pageUrl);
  let pageRouteKey = playbackContext.MediaKey;
  if (!pageRouteKey)
    try {
      const parsedUrl = new URL(pageUrl);
      pageRouteKey = `${parsedUrl.origin}${parsedUrl.pathname}`;
    } catch {
    }
  return _setPagePlaybackContext(playbackContext, {
    ...options,
    pageRouteKey,
    allowPreviewEmergencyAutoplayBackup: _isPreviewsPlayerUrl(pageUrl)
  });
}
function _invalidateAdCycleAsyncWork(info) {
  return info ? (info.BackupSearchEpoch = Math.max(0, Number(info.BackupSearchEpoch) || 0) + 1, info._BackupSearchPromises?.clear?.(), info._BackupSearchPromise = null, info._BackupSearchKey = null, info._BackupSearchStartedAt = 0, info._BackupSearchStartToken = null, info._LastBackupSearchCompletedAt = 0, info._BackupProbation = null, info.BackupPlaylistMetadata?.clear?.(), info.LastCleanBackupM3U8 = null, info.LastCleanBackupResolution = null, info.LastCleanBackupAt = 0, info._IncompletePodCleanStartedAt = 0, info._IncompletePodCleanPlaylistCount = 0, info._IncompletePodLastMediaSequence = null, info._IncompletePodCandidateUrl = null, info.NativeRecoveryProbeEpoch = Math.max(0, Number(info.NativeRecoveryProbeEpoch) || 0) + 1, info._NativeRecoveryProbeInFlight = !1, info._NativeRecoveryProbeToken = null, info.LastNativeRecoveryProbeAt = 0, info.LastNativeRecoveryReadyPlayerType = null, info.NativeRecoveryCleanCount = 0, info.NativeRecoveryProbeStreamUrl = null, info.NativeRecoveryProbeMediaKey = null, info.NativeRecoveryProbePlayerType = null, info.NativeRecoveryProbeCycleStartedAt = 0, info.NativeRecoveryProbeLastMediaSequence = null, info.NativeRecoveryProbeLastAdvancedAt = 0, info.NativeRecoveryAdPlaylistUrls?.clear?.(), info.NativeRecoveryAdMediaKey = null, info.NativeRecoveryAdStartedAt = 0, info.NativeRecoveryCandidateUrl = null, info.NativeRecoveryCandidateMediaKey = null, info.NativeRecoveryCandidateCycleStartedAt = 0, info.NativeRecoveryCandidateStage = null, info.NativeRecoveryCandidateStartedAt = 0, info.NativeRecoveryCandidateCleanCount = 0, info.NativeRecoveryCandidateLastMediaSequence = null, info.ConsecutiveFailedNativeProbes = 0, info._FatalMediaRecoveryRequestId = null, info.RequestedAds?.clear?.(), info._AdRequestController && (info._AdRequestController.abort?.(), info._AdRequestController = null), info._AdCycleRequestController && (info._AdCycleRequestController.abort?.(), info._AdCycleRequestController = null), !0) : !1;
}
const _drophunterBlockedAdIds = new Set();
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
  if (__TTVAB_STATE__.IsAdStrippingEnabled) {
    const previousCount = _drophunterBlockedAdIds.size;
    for (const adId of adIds) _drophunterBlockedAdIds.add(adId);
    if (_drophunterBlockedAdIds.size > previousCount) {
      document.documentElement.dataset.drophunterAdsBlocked = String(_drophunterBlockedAdIds.size);
      window.dispatchEvent(new Event("__drophunter_ads_blocked__"));
    }
  }
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
const _ATTR_REGEX = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
const _AD_METADATA_RE = /stitched-ad|X-TV-TWITCH-AD|\/adsquared\/|SCTE35-OUT|EXT-X-CUE-OUT|EXT-X-DATERANGE:(?:[^\r\n]*,)?CLASS="twitch-(?:stitched-)?ad(?:-|")|"(?:MIDROLL|midroll)"/;
const _RESERVED_ROUTE_SEGMENTS = /* @__PURE__ */ new Set([
    "activate",
    "bits",
    "browse",
    "clip",
    "clips",
    "collections",
    "dashboard",
    "directory",
    "downloads",
    "drops",
    "embed",
    "event",
    "following",
    "friends",
    "inventory",
    "jobs",
    "login",
    "manager",
    "messages",
    "moderator",
    "p",
    "player",
    "popout",
    "prime",
    "products",
    "search",
    "settings",
    "signup",
    "store",
    "subscriptions",
    "team",
    "turbo",
    "u",
    "user",
    "video",
    "videos",
    "wallet"
]);
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
function _isPreviewsPlayerUrl(rawUrl) {
  try {
    const baseUrl = typeof globalThis?.location?.href == "string" ? globalThis.location.href : "https://www.twitch.tv/", parsedUrl = new URL(String(rawUrl || ""), baseUrl), previewType = parsedUrl.searchParams.get("tp_prev");
    return !!(parsedUrl.protocol === "https:" && parsedUrl.hostname.toLowerCase() === "player.twitch.tv" && (previewType === "s" || previewType === "d") && _normalizeChannelName(parsedUrl.searchParams.get("channel")));
  } catch {
    return !1;
  }
}
function _getPlaybackContextFromUrl(rawUrl) {
  let parsedUrl = null, pathname = "";
  try {
    const baseUrl = typeof globalThis?.location?.href == "string" ? globalThis.location.href : "https://www.twitch.tv/";
    parsedUrl = new URL(String(rawUrl || ""), baseUrl), pathname = parsedUrl.pathname;
  } catch {
    pathname = typeof rawUrl == "string" ? rawUrl : "";
  }
  if (String(parsedUrl?.hostname || "").toLowerCase() === "player.twitch.tv") {
    const queryChannel = _normalizeChannelName(parsedUrl?.searchParams?.get("channel") || null), rawVideoQuery = parsedUrl?.searchParams?.get("video") || parsedUrl?.searchParams?.get("vod") || null, queryVodID = _normalizeVodID(typeof rawVideoQuery == "string" ? rawVideoQuery.replace(/^v/i, "") : rawVideoQuery);
    if (queryChannel)
      return _normalizePlaybackContext({
        MediaType: "live",
        ChannelName: queryChannel
      });
    if (queryVodID)
      return _normalizePlaybackContext({
        MediaType: "vod",
        VodID: queryVodID
      });
  }
  const segments = String(pathname || "").split("/").filter(Boolean), firstSegment = segments[0] || null, lowerFirstSegment = String(firstSegment || "").toLowerCase();
  if (lowerFirstSegment === "videos" || lowerFirstSegment === "video")
    return _normalizePlaybackContext({
      MediaType: "vod",
      VodID: (segments[1] || "").replace(/^v/i, "") || null
    });
  if (lowerFirstSegment === "popout") {
    const popoutChannel = _normalizeChannelName(segments[1] || null);
    return popoutChannel && String(segments[2] || "").toLowerCase() === "player" ? _normalizePlaybackContext({
      MediaType: "live",
      ChannelName: popoutChannel
    }) : _normalizePlaybackContext(null);
  }
  if (lowerFirstSegment === "embed" || lowerFirstSegment === "moderator") {
    const nestedChannel = _normalizeChannelName(segments[1] || null);
    return _normalizePlaybackContext(nestedChannel ? {
      MediaType: "live",
      ChannelName: nestedChannel
    } : null);
  }
  if (segments.length !== 1)
    return _normalizePlaybackContext(null);
  const liveChannel = _normalizeChannelName(firstSegment);
  return liveChannel && !_RESERVED_ROUTE_SEGMENTS.has(liveChannel) ? _normalizePlaybackContext({
    MediaType: "live",
    ChannelName: liveChannel
  }) : _normalizePlaybackContext(null);
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
function _isHevcCodecString(codecs) {
  const c = _getVideoCodecIdentity(codecs) || "";
  return c.startsWith("hev") || c.startsWith("hvc");
}
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
function _getPostAdReentryContinuationMs() {
  return 8e3;
}
function _resetNativeRecoveryReadyState(info, preserveProbeAt = !1, preserveProbeSession = !1) {
  info && (info.NativeRecoveryProbeEpoch = (Number(info.NativeRecoveryProbeEpoch) || 0) + 1, info._NativeRecoveryProbeInFlight = !1, info._NativeRecoveryProbeToken = null, preserveProbeAt || (info.LastNativeRecoveryProbeAt = 0), info.LastNativeRecoveryReadyPlayerType = null, info.NativeRecoveryCleanCount = 0, preserveProbeSession || (info.NativeRecoveryProbeStreamUrl = null, info.NativeRecoveryProbeMediaKey = null, info.NativeRecoveryProbePlayerType = null, info.NativeRecoveryProbeCycleStartedAt = 0, info.NativeRecoveryProbeLastMediaSequence = null, info.NativeRecoveryProbeLastAdvancedAt = 0));
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
function _getActiveCodecHandoffIdForInfo(info) {
  const visibleCycleStartedAt = Math.max(0, Number(info?.VisibleAdStartedAt) || 0);
  return typeof info?._CodecHandoffPendingId == "string" && info._CodecHandoffPendingId && _getCodecHandoffCycleStartedAt(info._CodecHandoffPendingId) === visibleCycleStartedAt && _isCodecHandoffCycleCurrent(info?.MediaKey, visibleCycleStartedAt, info) ? info._CodecHandoffPendingId : typeof __TTVAB_STATE__?.ActiveCodecHandoffId == "string" && __TTVAB_STATE__.ActiveCodecHandoffId && _normalizeMediaKey(__TTVAB_STATE__.ActiveCodecHandoffMediaKey) === _normalizeMediaKey(info?.MediaKey) && _getCodecHandoffCycleStartedAt(__TTVAB_STATE__.ActiveCodecHandoffId) === visibleCycleStartedAt && _isCodecHandoffCycleCurrent(info?.MediaKey, visibleCycleStartedAt, info) ? __TTVAB_STATE__.ActiveCodecHandoffId : null;
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
function _createCodecHandoffAbortError(requestSignal = null) {
  const reason = requestSignal?.reason;
  if (reason && typeof reason == "object" && reason.name === "AbortError")
    return reason;
  if (typeof DOMException == "function")
    return new DOMException("Retired enhanced-codec playlist request", "AbortError");
  const error = new Error("Retired enhanced-codec playlist request");
  return error.name = "AbortError", error;
}
function _cleanWorker(W) {
  const CleanWorker = class extends W {
  }, proto = CleanWorker.prototype;
  for (const key of _S.conflicts)
    if (key in proto)
      try {
        Object.defineProperty(proto, key, {
          configurable: !0,
          writable: !0,
          value: void 0
        });
      } catch {
      }
  return CleanWorker;
}
function _getReinsert(W) {
  const src = W.toString(), result = [];
  for (const pattern of _S.reinsertPatterns)
    (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(pattern) ? new RegExp(`\\b${pattern}\\b`).test(src) : src.includes(pattern)) && result.push(pattern);
  return result;
}
function _reinsert(W, names) {
  for (const name of names)
    if (typeof window[name] == "function")
      try {
        W.prototype[name] = window[name];
      } catch {
      }
  return W;
}
function _isValid(v) {
  if (typeof v != "function")
    return !1;
  let src = null;
  try {
    src = String(v.toString());
  } catch {
    return !1;
  }
  if (_S.toleratedWorkerWrappers.some((ext) => ext.signatures.every((sig) => src.includes(sig))))
    return !0;
  const hasConflict = _S.conflicts.some((c) => src.includes(c)), hasReinsert = _S.reinsertPatterns.some((p) => src.includes(p));
  if (hasConflict) {
    const matched = _S.conflicts.filter((c) => src.includes(c));
  }
  return !hasConflict && !hasReinsert;
}
const _PLAYBACK_WORKER_SOURCE = _DROPHUNTER_WORKER_SOURCE;
const _POST_AD_REMOVABLE_SELECTORS = [
    '[data-a-target="video-player-pip-container"]',
    '[data-a-target="video-player-mini-player"]',
    ".video-player__pip-container",
    ".video-player__mini-player",
    ".mini-player",
    '[class*="mini-player"]',
    '[class*="pip-container"]',
    '[data-test-selector="display-ad"]',
    '[data-test-selector="ad-banner"]',
    '[data-a-target="ads-banner"]',
    'iframe[data-test-selector^="sda-iframe-"]',
    'iframe[title="Stream Display Ad"]',
    'iframe[class*="stream-display-ad__iframe_lower-third"]',
    '[data-ttvab-player-ad-banner="true"]'
];
const _POST_AD_RESET_ONLY_SELECTORS = [
    ".stream-display-ad",
    '[class*="stream-display-ad"]',
    ".video-player--stream-display-ad",
    '[class*="video-player--stream-display-ad"]'
];
const _POST_AD_REMOVABLE_SELECTOR_GROUP = _POST_AD_REMOVABLE_SELECTORS.join(", ");
const _POST_AD_RESET_SELECTOR_GROUP = _POST_AD_RESET_ONLY_SELECTORS.join(", ");
let _pendingPostAdArtifactCleanup = null;
const _pageSideEmptyHoldInfoByUrl = /* @__PURE__ */ new Map();
const _pageSideVariantCodecByUrl = /* @__PURE__ */ new Map();
const _pageSidePlaybackOwnerByUrl = /* @__PURE__ */ new Map();
const _pageAdCycleControlByMediaKey = /* @__PURE__ */ new Map();
const _trackedExtensionBlobUrls = /* @__PURE__ */ new Set();
const _CRASHED_WORKER_RECOVERY_MESSAGE_KEYS = /* @__PURE__ */ new Set([
    "CancelFetchRequest",
    "FetchRequest",
    "LogEntry",
    "PreviewMasterRecoveryFailed",
    "AdBlocked",
    "AdSecondsBlocked",
    "AdDetected",
    "AdPodProgress",
    "BackupPlayerTypeSelected",
    "FatalMediaRecoveryReady",
    "AdEnded",
    "NativePlaybackRestored",
    "PauseResumePlayer",
    "ReloadPlayer"
]);
function _claimPageAdCycleControl(mediaKey, cycleStartedAt, workerGeneration, eventAt, allowConfirmedTerminalTakeover = !1, terminalWorker = null) {
  const normalizedMediaKey = _normalizeMediaKey(mediaKey), normalizedCycleStartedAt = Math.max(0, Number(cycleStartedAt) || 0), normalizedWorkerGeneration = Math.max(0, Number(workerGeneration) || 0), normalizedEventAt = Math.max(0, Number(eventAt) || 0);
  if (!normalizedMediaKey || normalizedCycleStartedAt <= 0 || normalizedWorkerGeneration <= 0 || normalizedEventAt <= 0 || !Number.isFinite(normalizedCycleStartedAt) || !Number.isFinite(normalizedWorkerGeneration) || !Number.isFinite(normalizedEventAt))
    return !1;
  const previous = _pageAdCycleControlByMediaKey.get(normalizedMediaKey) || null, previousCycleStartedAt = Math.max(0, Number(previous?.cycleStartedAt) || 0), canTakeOverProvisionalTerminalControl = !!(allowConfirmedTerminalTakeover === !0 && _isConfirmedPlaybackOwnerFinishingProvisionalAdCycle(normalizedMediaKey, normalizedCycleStartedAt, terminalWorker));
  if (previous && (previousCycleStartedAt > normalizedCycleStartedAt || previousCycleStartedAt === normalizedCycleStartedAt && (Math.max(0, Number(previous.latestEventAt) || 0) > normalizedEventAt || !canTakeOverProvisionalTerminalControl && Math.max(0, Number(previous.workerGeneration) || 0) > normalizedWorkerGeneration)))
    return !1;
  for (_pageAdCycleControlByMediaKey.delete(normalizedMediaKey), _pageAdCycleControlByMediaKey.set(normalizedMediaKey, {
    cycleStartedAt: normalizedCycleStartedAt,
    workerGeneration: normalizedWorkerGeneration,
    latestEventAt: normalizedEventAt
  }); _pageAdCycleControlByMediaKey.size > 32; ) {
    const oldestMediaKey = _pageAdCycleControlByMediaKey.keys().next().value;
    if (oldestMediaKey === void 0)
      break;
    _pageAdCycleControlByMediaKey.delete(oldestMediaKey);
  }
  return !0;
}
function _isConfirmedPlaybackOwnerFinishingProvisionalAdCycle(mediaKey, cycleStartedAt, worker, now = Date.now()) {
  const normalizedMediaKey = _normalizeMediaKey(mediaKey), normalizedCycleStartedAt = Math.max(0, Number(cycleStartedAt) || 0), normalizedWorkerGeneration = Math.max(0, Number(worker?.__TTVABGeneration) || 0), normalizedNow = Math.max(0, Number(now) || 0), control = normalizedMediaKey && _pageAdCycleControlByMediaKey.get(normalizedMediaKey) || null, controlWorkerGeneration = Math.max(0, Number(control?.workerGeneration) || 0), playbackContext = { MediaKey: normalizedMediaKey }, confirmedPlaybackOwnerGeneration = _getConfirmedWorkerPlaybackOwnerGeneration(normalizedMediaKey), healthyPlaybackOwner = _getHealthyObservedPlaybackWorker(playbackContext, null, normalizedNow, 0, !0), matchingConfirmedWorkers = Array.isArray(_S?.workers) ? _S.workers.filter((candidate) => candidate && Math.max(0, Number(candidate.__TTVABGeneration) || 0) === confirmedPlaybackOwnerGeneration && _getWorkerRecoveryContextKey(_getWorkerPlaybackContext(candidate)) === _getWorkerRecoveryContextKey(playbackContext)) : [], recoveryState = _getWorkerRecoveryState(playbackContext, !1), retiredThroughGeneration = Math.max(0, Number(recoveryState?.retiredThroughGeneration) || 0);
  return !!(normalizedMediaKey && normalizedCycleStartedAt > 0 && normalizedWorkerGeneration > 0 && normalizedNow > 0 && Math.max(0, Number(control?.cycleStartedAt) || 0) === normalizedCycleStartedAt && controlWorkerGeneration > normalizedWorkerGeneration && confirmedPlaybackOwnerGeneration === normalizedWorkerGeneration && matchingConfirmedWorkers.length === 1 && matchingConfirmedWorkers[0] === worker && healthyPlaybackOwner === worker && retiredThroughGeneration < normalizedWorkerGeneration && !_isWorkerGenerationRetired(worker, playbackContext));
}
function _isPageAdCycleControlEventCurrent(mediaKey, cycleStartedAt, workerGeneration, eventAt, terminalWorker = null) {
  const normalizedMediaKey = _normalizeMediaKey(mediaKey);
  if (!normalizedMediaKey)
    return !1;
  const normalizedCycleStartedAt = Math.max(0, Number(cycleStartedAt) || 0), normalizedWorkerGeneration = Math.max(0, Number(workerGeneration) || 0), normalizedEventAt = Math.max(0, Number(eventAt) || 0);
  if (normalizedCycleStartedAt <= 0 || normalizedWorkerGeneration <= 0 || normalizedEventAt <= 0 || !Number.isFinite(normalizedCycleStartedAt) || !Number.isFinite(normalizedWorkerGeneration) || !Number.isFinite(normalizedEventAt))
    return !1;
  const control = _pageAdCycleControlByMediaKey.get(normalizedMediaKey) || null;
  if (!control)
    return !0;
  const controlCycleStartedAt = Math.max(0, Number(control.cycleStartedAt) || 0);
  if (normalizedCycleStartedAt > controlCycleStartedAt)
    return !0;
  if (normalizedCycleStartedAt !== controlCycleStartedAt || normalizedEventAt < Math.max(0, Number(control.latestEventAt) || 0))
    return !1;
  const controlWorkerGeneration = Math.max(0, Number(control.workerGeneration) || 0);
  if (normalizedWorkerGeneration === controlWorkerGeneration || _isConfirmedPlaybackOwnerFinishingProvisionalAdCycle(normalizedMediaKey, normalizedCycleStartedAt, terminalWorker))
    return !0;
  const playbackOwnerGeneration = _getConfirmedWorkerPlaybackOwnerGeneration(normalizedMediaKey);
  return normalizedWorkerGeneration > controlWorkerGeneration && playbackOwnerGeneration >= normalizedWorkerGeneration;
}
function _getConfirmedWorkerPlaybackOwnerGeneration(mediaKey) {
  const normalizedMediaKey = _normalizeMediaKey(mediaKey);
  return normalizedMediaKey ? Math.max(0, Number(_WorkerPlaybackOwnerGenerationByContext.get(_getWorkerRecoveryContextKey({ MediaKey: normalizedMediaKey }))) || 0) : 0;
}
function _reassignPageAdCycleControlAfterWorkerRetirement(mediaKey, retiredWorkerGeneration, retiredWorker, now = Date.now()) {
  const normalizedMediaKey = _normalizeMediaKey(mediaKey), normalizedFailedGeneration = Math.max(0, Number(retiredWorkerGeneration) || 0), control = normalizedMediaKey && _pageAdCycleControlByMediaKey.get(normalizedMediaKey) || null, playbackOwnerGeneration = _getConfirmedWorkerPlaybackOwnerGeneration(normalizedMediaKey), healthyPlaybackOwner = normalizedMediaKey ? _getHealthyObservedPlaybackWorker({ MediaKey: normalizedMediaKey }, retiredWorker, now, 0, !0) : null, healthyOwnerGeneration = Math.max(0, Number(healthyPlaybackOwner?.__TTVABGeneration) || 0);
  return !control || normalizedFailedGeneration <= 0 || playbackOwnerGeneration <= 0 || playbackOwnerGeneration >= normalizedFailedGeneration || healthyOwnerGeneration !== playbackOwnerGeneration || Math.max(0, Number(control.workerGeneration) || 0) !== normalizedFailedGeneration ? !1 : (control.workerGeneration = playbackOwnerGeneration, !0);
}
function _rememberPageSidePlaybackOwner(mediaKey, playlistUrl, codec = null, adCycleStartedAt = 0, ownership = null) {
  const normalizedMediaKey = _normalizeMediaKey(mediaKey), codecFamily = _getVideoCodecFamily(codec);
  if (!normalizedMediaKey || typeof playlistUrl != "string" || !playlistUrl)
    return !1;
  const observedAt = Date.now(), normalizedCycleStartedAt = Math.max(0, Number(adCycleStartedAt) || 0), exactPlaylistUrl = _getExactPlaylistUrlKey(playlistUrl);
  if (!exactPlaylistUrl)
    return !1;
  const previous = _pageSidePlaybackOwnerByUrl.get(exactPlaylistUrl) || null, hasSamePreviousOwner = _normalizeMediaKey(previous?.mediaKey) === normalizedMediaKey, isConfirmedPlayback = ownership?.confirmedPlayback === !0, isAdMarked = ownership?.adMarked === !0, previousCycleStartedAt = hasSamePreviousOwner ? Math.max(0, Number(previous?.adCycleStartedAt) || 0) : 0, confirmedPlaybackAt = isConfirmedPlayback ? observedAt : hasSamePreviousOwner ? Math.max(0, Number(previous?.confirmedPlaybackAt) || 0) : 0;
  _pageSidePlaybackOwnerByUrl.delete(exactPlaylistUrl), _pageSidePlaybackOwnerByUrl.set(exactPlaylistUrl, {
    mediaKey: normalizedMediaKey,
    codecFamily: isConfirmedPlayback ? codecFamily || null : (hasSamePreviousOwner ? previous?.codecFamily : null) || null,
    observedAt,
    confirmedPlaybackAt,
    workerGeneration: isConfirmedPlayback ? Math.max(0, Number(ownership?.workerGeneration) || 0) : hasSamePreviousOwner ? Math.max(0, Number(previous?.workerGeneration) || 0) : 0,
    handoffId: isConfirmedPlayback ? typeof ownership?.handoffId == "string" && ownership.handoffId ? ownership.handoffId : null : hasSamePreviousOwner && previous?.handoffId || null,
    decoderCodecFamily: isConfirmedPlayback ? _getVideoCodecFamily(ownership?.decoderCodec) : hasSamePreviousOwner && previous?.decoderCodecFamily || null,
    lastAdMarkedAt: isAdMarked ? observedAt : hasSamePreviousOwner ? Math.max(0, Number(previous?.lastAdMarkedAt) || 0) : 0,
    adCycleStartedAt: Math.max(previousCycleStartedAt, normalizedCycleStartedAt)
  });
  let remembered = !0;
  for (const alias of _getPlaylistUrlAliases(playlistUrl))
    alias && (isConfirmedPlayback && codecFamily ? (_pageSideVariantCodecByUrl.delete(alias), _pageSideVariantCodecByUrl.set(alias, codecFamily)) : (isConfirmedPlayback || !hasSamePreviousOwner) && _pageSideVariantCodecByUrl.delete(alias), remembered = !0);
  for (; _pageSidePlaybackOwnerByUrl.size > 40; ) {
    const oldest = _pageSidePlaybackOwnerByUrl.keys().next().value;
    if (oldest === void 0)
      break;
    _pageSidePlaybackOwnerByUrl.delete(oldest);
  }
  for (; _pageSideVariantCodecByUrl.size > 40; ) {
    const oldest = _pageSideVariantCodecByUrl.keys().next().value;
    if (oldest === void 0)
      break;
    _pageSideVariantCodecByUrl.delete(oldest);
  }
  return remembered;
}
function _getTrustedPageSidePlaybackOwner(url, mediaKey, cycleStartedAt = 0) {
  const normalizedMediaKey = _normalizeMediaKey(mediaKey), normalizedCycleStartedAt = Math.max(0, Number(cycleStartedAt) || 0);
  if (!normalizedMediaKey)
    return null;
  const exactOwner = _pageSidePlaybackOwnerByUrl.get(_getExactPlaylistUrlKey(url));
  if (_normalizeMediaKey(exactOwner?.mediaKey) !== normalizedMediaKey || Math.max(0, Number(exactOwner?.confirmedPlaybackAt) || 0) <= 0 || normalizedCycleStartedAt > 0 && Math.max(0, Number(exactOwner?.adCycleStartedAt) || 0) !== normalizedCycleStartedAt)
    return null;
  const recoveryState = _getWorkerRecoveryState({ MediaKey: normalizedMediaKey }, !1), playbackOwnerGeneration = Math.max(0, Number(_WorkerPlaybackOwnerGenerationByContext.get(_getWorkerRecoveryContextKey({ MediaKey: normalizedMediaKey }))) || 0), exactOwnerGeneration = Math.max(0, Number(exactOwner.workerGeneration) || 0), relevantReloadAt = _getPlayerReloadAtForMediaKey(normalizedMediaKey);
  if (exactOwnerGeneration <= 0 || playbackOwnerGeneration <= 0 || exactOwnerGeneration !== playbackOwnerGeneration || Math.max(0, Number(recoveryState?.retiredThroughGeneration) || 0) > 0 && exactOwnerGeneration <= Math.max(0, Number(recoveryState.retiredThroughGeneration) || 0) || Math.max(0, Number(exactOwner.confirmedPlaybackAt) || 0) <= relevantReloadAt || _normalizeMediaKey(__TTVAB_STATE__?.ActiveCodecHandoffMediaKey) === normalizedMediaKey && __TTVAB_STATE__?.ActiveCodecHandoffId || exactOwner.handoffId)
    return null;
  const codecFamily = _getVideoCodecFamily(exactOwner.codecFamily), decoderCodecFamily = _getVideoCodecFamily(exactOwner.decoderCodecFamily);
  return !codecFamily || decoderCodecFamily && decoderCodecFamily !== codecFamily ? null : exactOwner;
}
function _canServePageSideAvcHold(url, mediaKey, cycleStartedAt) {
  return _getVideoCodecFamily(_getTrustedPageSidePlaybackOwner(url, mediaKey, cycleStartedAt)?.codecFamily) === "avc";
}
function _hidePostAdArtifact(el) {
  el instanceof Element && (el.style.setProperty("display", "none", "important"), el.style.setProperty("visibility", "hidden", "important"), el.style.setProperty("pointer-events", "none", "important"), el.setAttribute("data-ttvab-post-ad-hidden", "true"));
}
function _isPostAdPlayerLayoutWrapper(el) {
  return el instanceof Element ? !!(el.querySelector?.("video") || el.matches?.('[data-a-target="video-player"]') || el.matches?.('[class*="video-player"]')) : !1;
}
function _resetPostAdDisplayArtifact(el) {
  if (el instanceof Element) {
    if (typeof el.className == "string" && el.className.includes("stream-display-ad") && (el.className = el.className.split(/\s+/).filter((className) => className && !className.includes("stream-display-ad")).join(" ")), _isPostAdPlayerLayoutWrapper(el)) {
      el.removeAttribute("data-ttvab-post-ad-hidden"), el.style.removeProperty("display"), el.style.removeProperty("visibility"), el.style.removeProperty("pointer-events"), el.style.setProperty("padding", "0", "important"), el.style.setProperty("margin", "0", "important"), el.style.setProperty("background", "transparent", "important"), el.style.setProperty("background-color", "transparent", "important"), el.style.setProperty("width", "100%", "important"), el.style.setProperty("height", "100%", "important"), el.style.setProperty("max-width", "100%", "important"), el.style.setProperty("max-height", "100%", "important"), el.style.setProperty("inset", "0", "important");
      return;
    }
    _hidePostAdArtifact(el);
  }
}
function _runPostAdArtifactCleanup() {
  try {
    for (const el of document.querySelectorAll(_POST_AD_REMOVABLE_SELECTOR_GROUP))
      _resetPostAdDisplayArtifact(el);
    for (const el of document.querySelectorAll(_POST_AD_RESET_SELECTOR_GROUP))
      _resetPostAdDisplayArtifact(el);
  } catch {
  }
}
function _runPostAdPlayerTask(isPausePlay, isReload, options, attempt = 0) {
  const channel = options?.channel || null, mediaKey = options?.mediaKey || null, hasPendingIntent = typeof _doPlayerTask == "function" && (typeof _hasPendingAdResumeIntent != "function" || _hasPendingAdResumeIntent(channel, mediaKey));
  if (typeof _doPlayerTask != "function" ? "player-task-unavailable" : typeof _hasUserPauseIntent == "function" && _hasUserPauseIntent(channel, mediaKey) ? "user-paused" : typeof _shouldSuppressAutomaticPlaybackResume == "function" && _shouldSuppressAutomaticPlaybackResume(channel, mediaKey) ? "secondary-player" : hasPendingIntent ? null : "no-resume-intent")
    return !1;
  let didRun = !1;
  try {
    didRun = _doPlayerTask(isPausePlay, isReload, options) === !0;
  } catch {
  }
  if (didRun)
    return !0;
  const retryDelays = [80, 250, 700];
  return attempt >= retryDelays.length || typeof _schedulePlaybackRecoveryTimeout != "function" || _schedulePlaybackRecoveryTimeout(() => _runPostAdPlayerTask(isPausePlay, isReload, options, attempt + 1), retryDelays[attempt], options?.channel || null, options?.mediaKey || null, Math.max(0, Number(options?.cycleStartedAt) || 0)), !1;
}
function _schedulePostAdArtifactCleanup(channel = null, mediaKey = null, cycleStartedAt = 0) {
  _pendingPostAdArtifactCleanup?.id && clearTimeout(_pendingPostAdArtifactCleanup.id);
  const entry = {
    id: 0,
    channel,
    mediaKey,
    cycleStartedAt: Math.max(0, Number(cycleStartedAt) || 0)
  };
  return entry.id = setTimeout(() => {
    _pendingPostAdArtifactCleanup === entry && (_pendingPostAdArtifactCleanup = null, !(typeof _isPlaybackRecoveryContextCurrent == "function" && !_isPlaybackRecoveryContextCurrent(entry.channel, entry.mediaKey)) && _isPageLifecycleCycleCurrent(entry.mediaKey, entry.cycleStartedAt) && _runPostAdArtifactCleanup());
  }, 80), _pendingPostAdArtifactCleanup = entry, entry.id;
}
function _isPageLifecycleCycleCurrent(mediaKey, cycleStartedAt) {
  const normalizedMediaKey = _normalizeMediaKey(mediaKey), expectedCycleStartedAt = Math.max(0, Number(cycleStartedAt) || 0);
  return !normalizedMediaKey || expectedCycleStartedAt <= 0 ? !1 : _isCodecHandoffCycleCurrent(normalizedMediaKey, expectedCycleStartedAt) ? !0 : _normalizeMediaKey(__TTVAB_STATE__?.CurrentAdMediaKey) ? !1 : _normalizeMediaKey(__TTVAB_STATE__?.LastAdEndedMediaKey) === normalizedMediaKey && Math.max(0, Number(__TTVAB_STATE__?.LastAdEndedCycleStartedAt) || 0) === expectedCycleStartedAt && Date.now() - Math.max(0, Number(__TTVAB_STATE__?.LastAdEndedAt) || 0) < 3e4;
}
function _syncStoredDeviceId() {
  try {
    const deviceId = localStorage.getItem("unique_id");
    if (typeof deviceId == "string" && deviceId && /^[a-f0-9]{8,64}$/i.test(deviceId))
      return __TTVAB_STATE__.GQLDeviceID = deviceId, deviceId;
  } catch {
  }
  return null;
}
function _readBlobUrlSync(blobUrl) {
  try {
    if (typeof XMLHttpRequest != "function")
      return null;
    const xhr = new XMLHttpRequest();
    return xhr.open("GET", blobUrl, !1), xhr.send(null), typeof xhr.responseText == "string" && xhr.responseText ? xhr.responseText : null;
  } catch {
    return null;
  }
}
function _hookRevokeObjectURL() {
  if (typeof URL < "u" && typeof URL.revokeObjectURL == "function") {
    const originalRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = function(url) {
      typeof url == "string" && url.startsWith("blob:") && _trackedExtensionBlobUrls.has(url) ? (_trackedExtensionBlobUrls.delete(url), setTimeout(() => {
        try {
          originalRevoke.call(this, url);
        } catch {
        }
      }, 3500)) : originalRevoke.call(this, url);
    };
  }
}
const HW_MAX_RESTART = 3;
const HW_WATCHDOG_INTERVAL_MS = 5e3;
const HW_PONG_TIMEOUT_MS = 15e3;
const HW_INITIAL_PONG_TIMEOUT_MS = 15e3;
const HW_MAX_MISSED_PONGS = 2;
const HW_MAX_MISSED_PONGS_HIDDEN = 6;
const HW_HIDDEN_STALE_MIN_MS = 9e4;
const HW_RECOVERY_COOLDOWN_MS = 3e4;
const HW_RECOVERY_PLAYER_WAIT_MS = 3e4;
const HW_RECOVERY_SUCCESSOR_TIMEOUT_MS = 3e4;
const HW_RECOVERY_STABLE_MS = 6e4;
const HW_MAX_TRACKED_WORKERS = 40;
let _workerGeneration = 0;
let _workerRecoveryEpoch = 0;
const _WorkerRecoveryStates = /* @__PURE__ */ new Map();
const _WorkerPlaybackOwnerGenerationByContext = /* @__PURE__ */ new Map();
const _WorkerTerminationRecoveryByContext = /* @__PURE__ */ new Map();
function _clearWorkerInitialHeartbeat(worker) {
  worker?.__TTVABInitialHeartbeatTimer != null && (clearTimeout(worker.__TTVABInitialHeartbeatTimer), worker.__TTVABInitialHeartbeatTimer = null);
}
function _scheduleWorkerInitialHeartbeat(worker, pagePlaybackContext) {
  _clearWorkerInitialHeartbeat(worker);
  const pageContextGeneration = Math.max(0, Number(__TTVAB_STATE__?.PagePlaybackContextGeneration) || 0), workerRef = new WeakRef(worker);
  let lastCheckedAt = Date.now();
  const checkHeartbeat = () => {
    const currentWorker = workerRef.deref();
    if (!currentWorker || (currentWorker.__TTVABInitialHeartbeatTimer = null, currentWorker.__TTVABCrashed || currentWorker.__TTVABIntentionallyTerminated || currentWorker.__TTVABFirstPongAt || !_isWorkerRecoveryPageCurrent(currentWorker, pagePlaybackContext?.MediaKey, pageContextGeneration)))
      return;
    _installPageSideM3U8Override();
    const now = Date.now(), elapsed = now - lastCheckedAt;
    lastCheckedAt = now;
    const isThrottled = _isWorkerLifecycleThrottled(pagePlaybackContext), schedulingGraceMs = isThrottled ? HW_HIDDEN_STALE_MIN_MS : HW_INITIAL_PONG_TIMEOUT_MS + HW_PONG_TIMEOUT_MS, timerWasSuspended = elapsed < 0 || elapsed > schedulingGraceMs;
    if (timerWasSuspended) {
      currentWorker.__TTVABMissedPongs = 0, currentWorker.__TTVABLastPingSentAt = now;
      try {
        _postWorkerBridgeMessage(currentWorker, { key: "Ping", value: null });
      } catch {
      }
    }
    if (isThrottled || timerWasSuspended) {
      currentWorker.__TTVABInitialHeartbeatTimer = setTimeout(checkHeartbeat, HW_INITIAL_PONG_TIMEOUT_MS);
      return;
    }
    _recoverCrashedWorker(currentWorker, pagePlaybackContext, "Worker startup heartbeat timed out; checking playback recovery", "warning");
  };
  worker.__TTVABInitialHeartbeatTimer = setTimeout(checkHeartbeat, HW_INITIAL_PONG_TIMEOUT_MS);
}
function _isWorkerLifecycleThrottled(playbackContext = null) {
  return typeof _isPlaybackPageUnfocused == "function" ? _isPlaybackPageUnfocused(playbackContext) === !0 : typeof _isNativeDocumentHidden == "function" && _isNativeDocumentHidden(playbackContext) === !0;
}
function _getWorkerRecoveryContextKey(context) {
  const normalizedContext = _normalizePlaybackContext(context);
  return normalizedContext.MediaKey ? normalizedContext.MediaKey : normalizedContext.ChannelName ? `channel:${normalizedContext.ChannelName}` : "unknown";
}
function _getActivePictureInPictureWorkerContext(worker, mediaKey = null) {
  if (!worker || typeof _getActivePictureInPicturePlaybackContext != "function")
    return null;
  const context = _getActivePictureInPicturePlaybackContext();
  return !context?.MediaKey || context.workerRef?.deref?.() !== worker || mediaKey && _normalizeMediaKey(mediaKey) !== context.MediaKey ? null : context;
}
function _isWorkerRecoveryPageCurrent(worker, mediaKey, pageContextGeneration) {
  return pageContextGeneration === Math.max(0, Number(__TTVAB_STATE__?.PagePlaybackContextGeneration) || 0) || !!_getActivePictureInPictureWorkerContext(worker, mediaKey);
}
function _isWorkerCurrentPlayerMedia(worker, mediaKey) {
  if (typeof _getPlayerAndState != "function" || typeof _getPlayerCore != "function")
    return !1;
  try {
    const { player, state } = _getPlayerAndState();
    if (_getPlayerCore(player)?.worker !== worker)
      return !1;
    const content = state?.props?.content, context = _normalizePlaybackContext({
      MediaType: content?.type,
      ChannelName: content?.channelLogin,
      VodID: content?.vodID
    });
    return !!(mediaKey && context.MediaKey === mediaKey);
  } catch {
    return !1;
  }
}
function _getWorkerObservedPageContext(worker, data, observedContext, workerContext) {
  const pageMediaKey = _normalizeMediaKey(data?.pageMediaKey), pageContextGeneration = Number(data?.pageContextGeneration);
  return !observedContext.MediaKey || !pageMediaKey || pageMediaKey !== workerContext.MediaKey || pageMediaKey !== _normalizeMediaKey(__TTVAB_STATE__.PageMediaKey) || pageMediaKey !== _getPlaybackContextFromUrl(window.location.href).MediaKey || !Number.isFinite(pageContextGeneration) || pageContextGeneration !== Math.max(0, Number(__TTVAB_STATE__.PagePlaybackContextGeneration) || 0) || !_isWorkerCurrentPlayerMedia(worker, observedContext.MediaKey) ? null : {
    pageMediaKey,
    pageContextGeneration,
    mediaKey: observedContext.MediaKey
  };
}
function _rememberWorkerPageContext(worker, context) {
  if (!worker)
    return _normalizePlaybackContext(context);
  const normalizedContext = _normalizePlaybackContext(context), previousMediaKey = _normalizeMediaKey(worker.__TTVABPageMediaKey);
  return previousMediaKey && previousMediaKey !== _normalizeMediaKey(normalizedContext.MediaKey) && (worker.__TTVABPlaybackPageContext = null, worker.__TTVABPlaybackObservedAtByMediaKey?.delete?.(previousMediaKey), worker.__TTVABPlaybackBootstrapObservedAtByMediaKey?.delete?.(previousMediaKey)), worker.__TTVABPageMediaType = normalizedContext.MediaType || null, worker.__TTVABPageChannel = normalizedContext.ChannelName || null, worker.__TTVABPageVodID = normalizedContext.VodID || null, worker.__TTVABPageMediaKey = normalizedContext.MediaKey || null, normalizedContext;
}
function _getWorkerPlaybackContext(worker, fallbackContext = null) {
  const pipContext = _getActivePictureInPictureWorkerContext(worker);
  return _normalizePlaybackContext(pipContext || {
    MediaType: worker?.__TTVABPageMediaType || fallbackContext?.MediaType || __TTVAB_STATE__?.PageMediaType || null,
    ChannelName: worker?.__TTVABPageChannel || fallbackContext?.ChannelName || __TTVAB_STATE__?.PageChannel || null,
    VodID: worker?.__TTVABPageVodID || fallbackContext?.VodID || __TTVAB_STATE__?.PageVodID || null,
    MediaKey: worker?.__TTVABPageMediaKey || fallbackContext?.MediaKey || __TTVAB_STATE__?.PageMediaKey || null
  });
}
function _getWorkerRecoveryState(context, create = !0) {
  const contextKey = _getWorkerRecoveryContextKey(context);
  let state = _WorkerRecoveryStates.get(contextKey) || null;
  if (!state && create)
    for (state = {
      contextKey,
      context: _normalizePlaybackContext(context),
      attempts: 0,
      lastAttemptAt: 0,
      limitLogged: !1,
      noticeShownAt: 0,
      activeEpoch: 0,
      pageContextGeneration: 0,
      failedGeneration: 0,
      crashedAt: 0,
      bootstrapDeadlineAt: 0,
      pipWaitDeadlineAt: 0,
      retiredThroughGeneration: 0,
      expectedAfterGeneration: 0,
      reloadDispatchedAt: 0,
      lastReloadAt: 0,
      playerWaitDeadlineAt: 0,
      playerWaitSuspendedAt: 0,
      successorDeadlineAt: 0,
      stableGeneration: 0,
      stableSince: 0,
      terminalRearmCycleStartedAt: 0,
      terminalRearmAttemptedAt: 0,
      hiddenLastMediaTime: -1,
      hiddenLastMediaRef: null,
      timerID: null,
      phase: "idle"
    }, _WorkerRecoveryStates.set(contextKey, state); _WorkerRecoveryStates.size > 32; ) {
      const removable = Array.from(_WorkerRecoveryStates.entries()).find(([key, entry]) => key !== contextKey && !entry?.activeEpoch);
      if (!removable)
        break;
      _WorkerRecoveryStates.delete(removable[0]);
    }
  return state;
}
function _recordWorkerRecoveryAttempt(context, now = Date.now()) {
  const state = _getWorkerRecoveryState(context);
  return !state || state.attempts >= HW_MAX_RESTART ? !1 : (state.attempts++, state.lastAttemptAt = now, state.limitLogged = !1, !0);
}
function _resetWorkerRecoveryStateIfStable(worker, context, now = Date.now()) {
  const state = _getWorkerRecoveryState(context, !1);
  if (!state)
    return;
  const workerGeneration = Math.max(0, Number(worker?.__TTVABGeneration) || 0), observationAt = _getWorkerPlaybackObservationAt(worker, context), observationFreshnessMs = _isWorkerLifecycleThrottled(context) ? HW_HIDDEN_STALE_MIN_MS : HW_PONG_TIMEOUT_MS;
  state.phase !== "stabilizing" || state.stableGeneration !== workerGeneration || state.stableSince <= 0 || now - state.stableSince < HW_RECOVERY_STABLE_MS || !_isWorkerHeartbeatHealthy(worker, now, context) || observationAt < state.stableSince || now - observationAt > observationFreshnessMs || (state.attempts = 0, state.lastAttemptAt = 0, state.lastReloadAt = 0, state.playerWaitDeadlineAt = 0, state.playerWaitSuspendedAt = 0, state.limitLogged = !1, state.noticeShownAt = 0, state.stableGeneration = 0, state.stableSince = 0, state.terminalRearmCycleStartedAt = 0, state.terminalRearmAttemptedAt = 0, state.phase = "idle");
}
function _getWorkerPlaybackObservationAt(worker, context, bootstrap = !1) {
  let mediaKey = _normalizeMediaKey(_normalizePlaybackContext(context).MediaKey);
  if (!mediaKey)
    return 0;
  const pageContext = worker?.__TTVABPlaybackPageContext;
  if (pageContext?.pageMediaKey === mediaKey && !_getActivePictureInPictureWorkerContext(worker, mediaKey)) {
    if (pageContext.pageMediaKey !== _normalizeMediaKey(__TTVAB_STATE__?.PageMediaKey) || pageContext.pageMediaKey !== _getPlaybackContextFromUrl(window.location.href).MediaKey || pageContext.pageContextGeneration !== Math.max(0, Number(__TTVAB_STATE__?.PagePlaybackContextGeneration) || 0) || !_isWorkerCurrentPlayerMedia(worker, pageContext.mediaKey))
      return 0;
    mediaKey = pageContext.mediaKey;
  }
  const observations = bootstrap ? worker?.__TTVABPlaybackBootstrapObservedAtByMediaKey : worker?.__TTVABPlaybackObservedAtByMediaKey;
  return Math.max(0, Number(observations?.get?.(mediaKey)) || 0);
}
function _isWorkerHeartbeatHealthy(worker, now = Date.now(), playbackContext = null) {
  if (!worker || worker.__TTVABCrashed || worker.__TTVABIntentionallyTerminated)
    return !1;
  const firstPongAt = Math.max(0, Number(worker.__TTVABFirstPongAt) || 0), lastPongAt = Math.max(0, Number(worker.__TTVABLastPongAt) || 0), heartbeatTimeoutMs = _isWorkerLifecycleThrottled(playbackContext || _getWorkerPlaybackContext(worker)) ? HW_HIDDEN_STALE_MIN_MS : HW_PONG_TIMEOUT_MS;
  return firstPongAt > 0 && lastPongAt > 0 && now - lastPongAt <= heartbeatTimeoutMs;
}
function _promoteWorkerPlaybackOwner(worker, now = Date.now(), playbackContext = null) {
  const context = _normalizePlaybackContext(playbackContext || _getWorkerPlaybackContext(worker));
  if (!_isWorkerHeartbeatHealthy(worker, now, context))
    return !1;
  const generation = Math.max(0, Number(worker.__TTVABGeneration) || 0);
  if (generation <= 0)
    return !1;
  const mediaKey = _normalizeMediaKey(context.MediaKey), observationAt = _getWorkerPlaybackObservationAt(worker, context);
  if (!mediaKey || observationAt <= 0)
    return !1;
  const contextKey = _getWorkerRecoveryContextKey(context), currentGeneration = Math.max(0, Number(_WorkerPlaybackOwnerGenerationByContext.get(contextKey)) || 0), observationFreshnessMs = _isWorkerLifecycleThrottled(context) ? HW_HIDDEN_STALE_MIN_MS : HW_PONG_TIMEOUT_MS;
  if (generation > currentGeneration && now - observationAt > observationFreshnessMs)
    return !1;
  const didPromote = generation >= currentGeneration;
  if (didPromote) {
    _WorkerPlaybackOwnerGenerationByContext.delete(contextKey), _WorkerPlaybackOwnerGenerationByContext.set(contextKey, generation);
    const recoveryState = _getWorkerRecoveryState(context, !1);
  }
  for (; _WorkerPlaybackOwnerGenerationByContext.size > 32; ) {
    const oldestContextKey = _WorkerPlaybackOwnerGenerationByContext.keys().next().value;
    if (oldestContextKey === void 0 || oldestContextKey === contextKey)
      break;
    _WorkerPlaybackOwnerGenerationByContext.delete(oldestContextKey);
  }
  return didPromote;
}
function _beginExhaustedWorkerRecoveryStabilization(worker, context, now = Date.now()) {
  const recoveryState = _getWorkerRecoveryState(context, !1), priorPhase = recoveryState?.phase || null;
  if (priorPhase !== "exhausted" && priorPhase !== "cancelled" && priorPhase !== "degraded-pip")
    return !1;
  const workerContext = _getWorkerPlaybackContext(worker);
  if (_isPlaybackContextMismatch(workerContext, context))
    return !1;
  const workerGeneration = Math.max(0, Number(worker?.__TTVABGeneration) || 0), observationAt = _getWorkerPlaybackObservationAt(worker, context), observationFreshnessMs = _isWorkerLifecycleThrottled(context) ? HW_HIDDEN_STALE_MIN_MS : HW_PONG_TIMEOUT_MS, playbackOwnerGeneration = Math.max(0, Number(_WorkerPlaybackOwnerGenerationByContext.get(_getWorkerRecoveryContextKey(context))) || 0);
  return workerGeneration <= Math.max(0, Number(recoveryState.failedGeneration) || 0) || observationAt <= Math.max(0, Number(recoveryState.crashedAt) || 0) || now - observationAt > observationFreshnessMs || workerGeneration < playbackOwnerGeneration || !_isWorkerHeartbeatHealthy(worker, now, context) ? !1 : (recoveryState.retiredThroughGeneration = Math.max(0, Number(recoveryState.retiredThroughGeneration) || 0, Number(recoveryState.failedGeneration) || 0), recoveryState.stableGeneration = workerGeneration, recoveryState.stableSince = now, recoveryState.activeEpoch = 0, recoveryState.phase = "stabilizing", _promoteWorkerPlaybackOwner(worker, now, context), !0);
}
function _markWorkerPong(worker, now = Date.now()) {
  if (!worker || worker.__TTVABIntentionallyTerminated || worker.__TTVABCrashed)
    return;
  _clearWorkerInitialHeartbeat(worker);
  const workerContext = _getWorkerPlaybackContext(worker), recoveryState = _getWorkerRecoveryState(workerContext, !1);
  recoveryState?.phase === "stabilizing" && recoveryState.stableGeneration === worker.__TTVABGeneration && !_isWorkerHeartbeatHealthy(worker, now, workerContext) && (recoveryState.stableSince = now), worker.__TTVABLastPongAt = now, worker.__TTVABFirstPongAt || (worker.__TTVABFirstPongAt = now), worker.__TTVABMissedPongs = 0, _promoteWorkerPlaybackOwner(worker, now) && _getWorkerPlaybackObservationAt(worker, workerContext) > 0 && (_beginExhaustedWorkerRecoveryStabilization(worker, workerContext, now), _resetWorkerRecoveryStateIfStable(worker, workerContext, now));
}
function _isProtectedTrackedWorker(worker, trackedWorkers) {
  const workerContext = _getWorkerPlaybackContext(worker), contextKey = _getWorkerRecoveryContextKey(workerContext), workerGeneration = Math.max(0, Number(worker?.__TTVABGeneration) || 0), pageContext = _normalizePlaybackContext({
    MediaType: __TTVAB_STATE__?.PageMediaType,
    ChannelName: __TTVAB_STATE__?.PageChannel,
    VodID: __TTVAB_STATE__?.PageVodID,
    MediaKey: __TTVAB_STATE__?.PageMediaKey
  }), contextIsCurrent = !_isPlaybackContextMismatch(workerContext, pageContext), contextIsPip = !!(typeof _isActivePictureInPicturePlaybackContext == "function" && _isActivePictureInPicturePlaybackContext(workerContext));
  if (!contextIsCurrent && !contextIsPip)
    return !1;
  if (Math.max(0, Number(_WorkerPlaybackOwnerGenerationByContext.get(contextKey)) || 0) === workerGeneration || trackedWorkers.reduce((latest, candidate) => _getWorkerRecoveryContextKey(_getWorkerPlaybackContext(candidate)) !== contextKey ? latest : Math.max(latest, Math.max(0, Number(candidate?.__TTVABGeneration) || 0)), 0) === workerGeneration)
    return !0;
  const recoveryState = _getWorkerRecoveryState(workerContext, !1);
  return recoveryState?.activeEpoch > 0 && (workerGeneration === recoveryState.failedGeneration || workerGeneration === recoveryState.stableGeneration);
}
function _promoteTrackedWorker(worker) {
  return worker ? (_forgetDormantWorker(worker), _S.workers.includes(worker) || _S.workers.push(worker), pruneTrackedWorkers(), _S.workers.includes(worker)) : !1;
}
const pruneTrackedWorkers = (excludedWorkers = []) => {
    const excluded = new Set(excludedWorkers.filter(Boolean)), aliveWorkers = [], seenWorkers = /* @__PURE__ */ new Set();
    for (const worker of _S.workers)
        !worker || excluded.has(worker) || seenWorkers.has(worker) || worker.__TTVABIntentionallyTerminated || worker.__TTVABCrashed || (aliveWorkers.push(worker), seenWorkers.add(worker));
    for (const worker of excluded)
        _forgetDormantWorker(worker);
    if (aliveWorkers.length > HW_MAX_TRACKED_WORKERS) {
        const retainedWorkers = [...aliveWorkers];
        for (const worker of aliveWorkers) {
            if (retainedWorkers.length <= HW_MAX_TRACKED_WORKERS)
                break;
            if (_isProtectedTrackedWorker(worker, aliveWorkers))
                continue;
            const index = retainedWorkers.indexOf(worker);
            index < 0 || (retainedWorkers.splice(index, 1), _rememberDormantWorker(worker));
        }
        for (; retainedWorkers.length > HW_MAX_TRACKED_WORKERS;) {
            const worker = retainedWorkers.shift();
            worker && _rememberDormantWorker(worker);
        }
        _S.workers = retainedWorkers;
        return;
    }
    _S.workers = aliveWorkers;
};
function _isPlaybackContextMismatch(expectedContext, currentContext) {
  const normalizedExpectedContext = _normalizePlaybackContext(expectedContext), normalizedCurrentContext = _normalizePlaybackContext(currentContext);
  return normalizedExpectedContext.MediaKey ? normalizedCurrentContext.MediaKey !== normalizedExpectedContext.MediaKey : normalizedExpectedContext.ChannelName ? normalizedCurrentContext.ChannelName !== normalizedExpectedContext.ChannelName : !1;
}
function _getHighestWorkerGenerationForPlaybackContext(playbackContext) {
  const contextKey = _getWorkerRecoveryContextKey(playbackContext);
  let highestGeneration = 0;
  for (const candidate of _S.workers)
    !candidate || _getWorkerRecoveryContextKey(_getWorkerPlaybackContext(candidate)) !== contextKey || (highestGeneration = Math.max(highestGeneration, 0, Number(candidate.__TTVABGeneration) || 0));
  return highestGeneration;
}
function _getQualifiedReplacementWorker(worker, playbackContext, boundaryAt, minimumGeneration, now = Date.now(), requireCreatedAfterBoundary = !0) {
  const contextKey = _getWorkerRecoveryContextKey(playbackContext), normalizedBoundaryAt = Math.max(0, Number(boundaryAt) || 0), normalizedMinimumGeneration = Math.max(0, Number(minimumGeneration) || 0), observationFreshnessMs = _isWorkerLifecycleThrottled(playbackContext) ? HW_HIDDEN_STALE_MIN_MS : HW_PONG_TIMEOUT_MS;
  let replacement = null, replacementGeneration = 0;
  for (const candidate of _S.workers) {
    if (!candidate || candidate === worker || _getWorkerRecoveryContextKey(_getWorkerPlaybackContext(candidate)) !== contextKey || !_isWorkerHeartbeatHealthy(candidate, now, playbackContext))
      continue;
    const candidateGeneration = Math.max(0, Number(candidate.__TTVABGeneration) || 0), candidateCreatedAt = Math.max(0, Number(candidate.__TTVABCreatedAt) || 0), observedAt = _getWorkerPlaybackObservationAt(candidate, playbackContext);
    candidateGeneration <= normalizedMinimumGeneration || candidateCreatedAt <= 0 || requireCreatedAfterBoundary && candidateCreatedAt < normalizedBoundaryAt || observedAt <= 0 || observedAt < normalizedBoundaryAt || now - observedAt > observationFreshnessMs || candidateGeneration <= replacementGeneration || (replacement = candidate, replacementGeneration = candidateGeneration);
  }
  return replacement;
}
function _hasStartingReplacementWorker(worker, playbackContext, minimumGeneration, bootstrapDeadlineAt, now = Date.now()) {
  const contextKey = _getWorkerRecoveryContextKey(playbackContext), normalizedMinimumGeneration = Math.max(0, Number(minimumGeneration) || 0), normalizedBootstrapDeadlineAt = Math.max(0, Number(bootstrapDeadlineAt) || 0);
  return normalizedBootstrapDeadlineAt <= 0 || now >= normalizedBootstrapDeadlineAt ? !1 : _S.workers.some((candidate) => !candidate || candidate === worker || candidate.__TTVABCrashed || candidate.__TTVABIntentionallyTerminated || _getWorkerRecoveryContextKey(_getWorkerPlaybackContext(candidate)) !== contextKey ? !1 : Math.max(0, Number(candidate.__TTVABGeneration) || 0) > normalizedMinimumGeneration);
}
function _getHealthyObservedPlaybackWorker(playbackContext, excludedWorker = null, now = Date.now(), observedAfter = 0, requireFreshObservation = !0) {
  const contextKey = _getWorkerRecoveryContextKey(playbackContext), minimumObservedAt = Math.max(0, Number(observedAfter) || 0), observationFreshnessMs = _isWorkerLifecycleThrottled(playbackContext) ? HW_HIDDEN_STALE_MIN_MS : HW_PONG_TIMEOUT_MS;
  let playbackOwner = null, playbackOwnerGeneration = 0;
  for (const candidate of _S.workers) {
    if (!candidate || candidate === excludedWorker || _getWorkerRecoveryContextKey(_getWorkerPlaybackContext(candidate)) !== contextKey || !_isWorkerHeartbeatHealthy(candidate, now, playbackContext))
      continue;
    const observedAt = _getWorkerPlaybackObservationAt(candidate, playbackContext), candidateGeneration = Math.max(0, Number(candidate.__TTVABGeneration) || 0);
    observedAt <= 0 || observedAt < minimumObservedAt || requireFreshObservation && now - observedAt > observationFreshnessMs || candidateGeneration <= playbackOwnerGeneration || (playbackOwner = candidate, playbackOwnerGeneration = candidateGeneration);
  }
  return playbackOwner;
}
function _handleMediaBootstrapRecoveryRequest(worker, data, pagePlaybackContext, currentPageContext) {
  const recoveryContext = _normalizePlaybackContext({
    MediaType: data?.mediaType,
    ChannelName: data?.channel,
    VodID: data?.vodID,
    MediaKey: data?.mediaKey
  }), cycleStartedAt = Math.max(0, Number(data?.cycleStartedAt) || 0), workerContext = _getWorkerPlaybackContext(worker, pagePlaybackContext), contextIsCurrent = !_isPlaybackContextMismatch(recoveryContext, currentPageContext), contextIsPip = !!(typeof _isActivePictureInPicturePlaybackContext == "function" && _isActivePictureInPicturePlaybackContext(recoveryContext));
  return !recoveryContext.MediaKey || cycleStartedAt <= 0 || _isPlaybackContextMismatch(workerContext, recoveryContext) || !contextIsCurrent && !contextIsPip || _normalizeMediaKey(__TTVAB_STATE__?.CurrentAdMediaKey) !== recoveryContext.MediaKey || Math.max(0, Number(__TTVAB_STATE__?.AdPodProgressByMediaKey?.[recoveryContext.MediaKey]?.cycleStartedAt) || 0) !== cycleStartedAt ? !1 : _recoverCrashedWorker(worker, recoveryContext, "Playback worker received media before stream bootstrap", "warning");
}
function _canHandleCrashedWorkerMessage(data, worker, pagePlaybackContext, currentPageContext) {
  const key = typeof data?.key == "string" ? data.key : null;
  if (!key || !_CRASHED_WORKER_RECOVERY_MESSAGE_KEYS.has(key))
    return !1;
  const workerContext = _getWorkerPlaybackContext(worker, pagePlaybackContext);
  if (!(!_isPlaybackContextMismatch(workerContext, currentPageContext) || typeof _isActivePictureInPicturePlaybackContext == "function" && _isActivePictureInPicturePlaybackContext(workerContext)))
    return !1;
  const contextKey = _getWorkerRecoveryContextKey(workerContext), recoveryState = _getWorkerRecoveryState(workerContext, !1), explicitlyRetiredThroughGeneration = Math.max(0, Number(recoveryState?.retiredThroughGeneration) || 0), playbackOwnerGeneration = Math.max(0, Number(_WorkerPlaybackOwnerGenerationByContext.get(contextKey)) || 0), workerGeneration = Math.max(0, Number(worker?.__TTVABGeneration) || 0);
  return key === "AdDetected" || key === "AdPodProgress" ? recoveryState?.activeEpoch > 0 && workerGeneration > explicitlyRetiredThroughGeneration && workerGeneration === recoveryState.failedGeneration : (explicitlyRetiredThroughGeneration <= 0 || workerGeneration > explicitlyRetiredThroughGeneration) && (playbackOwnerGeneration <= 0 || workerGeneration >= playbackOwnerGeneration);
}
function _isWorkerGenerationRetired(worker, pagePlaybackContext = null) {
  const workerGeneration = Math.max(0, Number(worker?.__TTVABGeneration) || 0);
  if (workerGeneration <= 0)
    return !1;
  const workerContext = _getWorkerPlaybackContext(worker, pagePlaybackContext);
  return Math.max(0, Number(_WorkerPlaybackOwnerGenerationByContext.get(_getWorkerRecoveryContextKey(workerContext))) || 0) > workerGeneration;
}
function _clearWorkerTerminationRecovery(mediaKey) {
  const worker = _WorkerTerminationRecoveryByContext.get(mediaKey);
  worker && (worker.__TTVABTerminationRecoveryTimer != null && (clearTimeout(worker.__TTVABTerminationRecoveryTimer), worker.__TTVABTerminationRecoveryTimer = null), _WorkerTerminationRecoveryByContext.delete(mediaKey));
}
function _scheduleTerminatedPlaybackWorkerRecovery(worker, pagePlaybackContext) {
  if (!worker || worker.__TTVABCrashed || Math.max(0, Number(worker.__TTVABTerminatedAt) || 0) > 0 || worker.__TTVABTerminationRecoveryTimer != null)
    return !1;
  const recoveryContext = _getWorkerPlaybackContext(worker, pagePlaybackContext), terminatedWorkerObservedPlayback = _getWorkerPlaybackObservationAt(worker, recoveryContext) > 0, terminatedWorkerObservedBootstrap = _getWorkerPlaybackObservationAt(worker, recoveryContext, !0) > 0;
  if (!recoveryContext.MediaKey)
    return !1;
  const currentContext = _getPlaybackContextFromUrl(window.location.href), contextIsCurrent = !_isPlaybackContextMismatch(recoveryContext, currentContext), contextIsPip = !!(typeof _isActivePictureInPicturePlaybackContext == "function" && _isActivePictureInPicturePlaybackContext(recoveryContext));
  for (const mediaKey of _WorkerTerminationRecoveryByContext.keys())
    mediaKey !== currentContext.MediaKey && !(typeof _isActivePictureInPicturePlaybackContext == "function" && _isActivePictureInPicturePlaybackContext({ MediaKey: mediaKey })) && _clearWorkerTerminationRecovery(mediaKey);
  if (!contextIsCurrent && !contextIsPip)
    return !1;
  const now = Date.now(), terminatedGeneration = Math.max(0, Number(worker.__TTVABGeneration) || 0), healthyPlaybackOwner = _getHealthyObservedPlaybackWorker(recoveryContext, worker, now, terminatedWorkerObservedPlayback ? Math.max(0, Number(worker.__TTVABCreatedAt) || 0) : 0, terminatedWorkerObservedPlayback);
  if (healthyPlaybackOwner) {
    const healthyOwnerGeneration = Math.max(0, Number(healthyPlaybackOwner.__TTVABGeneration) || 0);
    if ((!terminatedWorkerObservedPlayback || healthyOwnerGeneration > terminatedGeneration) && _promoteWorkerPlaybackOwner(healthyPlaybackOwner, now, recoveryContext))
      return !1;
  }
  const previousWorker = _WorkerTerminationRecoveryByContext.get(recoveryContext.MediaKey);
  if (previousWorker) {
    if (Number(previousWorker.__TTVABGeneration) >= terminatedGeneration || !terminatedWorkerObservedPlayback && !terminatedWorkerObservedBootstrap)
      return !1;
    _clearWorkerTerminationRecovery(recoveryContext.MediaKey);
  }
  const pageContextGeneration = Math.max(0, Number(__TTVAB_STATE__?.PagePlaybackContextGeneration) || 0), scheduleMonitor = (callback, delayMs) => {
    const timerID = setTimeout(() => {
      if (worker.__TTVABTerminationRecoveryTimer === timerID) {
        worker.__TTVABTerminationRecoveryTimer = null;
        try {
          if (!_isWorkerRecoveryPageCurrent(worker, recoveryContext.MediaKey, pageContextGeneration))
            return;
          callback();
        } finally {
          worker.__TTVABTerminationRecoveryTimer == null && _WorkerTerminationRecoveryByContext.get(recoveryContext.MediaKey) === worker && _WorkerTerminationRecoveryByContext.delete(recoveryContext.MediaKey);
        }
      }
    }, delayMs);
    worker.__TTVABTerminationRecoveryTimer = timerID, _WorkerTerminationRecoveryByContext.set(recoveryContext.MediaKey, worker);
  };
  if (!terminatedWorkerObservedPlayback && !terminatedWorkerObservedBootstrap) {
    let pageFallbackInstalled = !1;
    contextIsCurrent && (_installPageSideM3U8Override(), pageFallbackInstalled = !0);
    const terminatedAt2 = now;
    let startupDeadlineAt = terminatedAt2 + HW_HIDDEN_STALE_MIN_MS * 2, hasPlaybackSample = !1, lastMedia = null, lastMediaTime = -1, stalledSince = 0, mediaTimeByElement = /* @__PURE__ */ new WeakMap();
    worker.__TTVABTerminatedAt = terminatedAt2;
    const monitorUnobservedTermination = () => {
      const checkedAt = Date.now(), latestContext = _getPlaybackContextFromUrl(window.location.href), contextStillCurrent = !_isPlaybackContextMismatch(recoveryContext, latestContext), contextStillPip = !!(typeof _isActivePictureInPicturePlaybackContext == "function" && _isActivePictureInPicturePlaybackContext(recoveryContext));
      if (!contextStillCurrent && !contextStillPip)
        return;
      contextStillCurrent && !pageFallbackInstalled && (_installPageSideM3U8Override(), pageFallbackInstalled = !0);
      const replacement = _getHealthyObservedPlaybackWorker(recoveryContext, worker, checkedAt, terminatedAt2, !0);
      if (Math.max(0, Number(replacement?.__TTVABGeneration) || 0) > terminatedGeneration && _promoteWorkerPlaybackOwner(replacement, checkedAt, recoveryContext))
        return;
      if (!!(typeof _hasUserPauseIntent == "function" && _hasUserPauseIntent(recoveryContext.ChannelName, recoveryContext.MediaKey))) {
        startupDeadlineAt = Math.max(startupDeadlineAt, checkedAt + HW_HIDDEN_STALE_MIN_MS), hasPlaybackSample = !1, lastMedia = null, lastMediaTime = -1, stalledSince = 0, mediaTimeByElement = /* @__PURE__ */ new WeakMap(), scheduleMonitor(monitorUnobservedTermination, HW_WATCHDOG_INTERVAL_MS);
        return;
      }
      const activePipContext = contextStillPip && typeof _getActivePictureInPicturePlaybackContext == "function" ? _getActivePictureInPicturePlaybackContext() : null, media = activePipContext?.element instanceof HTMLMediaElement ? activePipContext.element : typeof _getPrimaryMediaElement == "function" ? _getPrimaryMediaElement() : null, mediaTime = media instanceof HTMLMediaElement ? Number(media.currentTime) || 0 : -1;
      if (media instanceof HTMLMediaElement && media.ended && recoveryContext.MediaType === "vod")
        return;
      if (!!!(contextStillCurrent && (__TTVAB_STATE__?.PlayerIsPlaying === !0 || __TTVAB_STATE__?.PlayerHasPlayedOnce === !0) || media instanceof HTMLMediaElement && (media.paused === !1 || mediaTime > 0 || media.ended && recoveryContext.MediaType !== "vod"))) {
        if (hasPlaybackSample = !1, lastMedia = null, lastMediaTime = -1, stalledSince = 0, mediaTimeByElement = /* @__PURE__ */ new WeakMap(), checkedAt >= startupDeadlineAt) {
          _recoverCrashedWorker(worker, recoveryContext, "Playback worker terminated before playback initialized", "warning", !0);
          return;
        }
        scheduleMonitor(monitorUnobservedTermination, HW_WATCHDOG_INTERVAL_MS);
        return;
      }
      const previousMediaTime = media instanceof HTMLMediaElement ? mediaTimeByElement.get(media) : media === lastMedia ? lastMediaTime : null;
      if (media instanceof HTMLMediaElement && mediaTimeByElement.set(media, mediaTime), !hasPlaybackSample) {
        hasPlaybackSample = !0, lastMedia = media, lastMediaTime = mediaTime, stalledSince = checkedAt, scheduleMonitor(monitorUnobservedTermination, HW_WATCHDOG_INTERVAL_MS);
        return;
      }
      if (lastMedia = media, lastMediaTime = mediaTime, typeof previousMediaTime == "number" && mediaTime > previousMediaTime + 0.2) {
        if (stalledSince = checkedAt, checkedAt >= startupDeadlineAt)
          return;
        scheduleMonitor(monitorUnobservedTermination, HW_WATCHDOG_INTERVAL_MS);
        return;
      }
      const requiredStallMs = _isWorkerLifecycleThrottled(recoveryContext) ? HW_HIDDEN_STALE_MIN_MS : HW_INITIAL_PONG_TIMEOUT_MS;
      if (stalledSince <= 0 || checkedAt - stalledSince < requiredStallMs) {
        scheduleMonitor(monitorUnobservedTermination, HW_WATCHDOG_INTERVAL_MS);
        return;
      }
      _recoverCrashedWorker(worker, recoveryContext, "Playback stopped after its worker terminated before initialization", "warning", !0);
    };
    return scheduleMonitor(monitorUnobservedTermination, HW_WATCHDOG_INTERVAL_MS), !0;
  }
  const terminatedAt = now;
  return worker.__TTVABTerminatedAt = terminatedAt, contextIsCurrent && _installPageSideM3U8Override(), scheduleMonitor(() => {
    const latestContext = _getPlaybackContextFromUrl(window.location.href), contextStillCurrent = !_isPlaybackContextMismatch(recoveryContext, latestContext), contextStillPip = !!(typeof _isActivePictureInPicturePlaybackContext == "function" && _isActivePictureInPicturePlaybackContext(recoveryContext));
    if (!contextStillCurrent && !contextStillPip)
      return;
    const replacement = _getQualifiedReplacementWorker(worker, recoveryContext, terminatedAt, terminatedGeneration, Date.now(), !1);
    replacement && _promoteWorkerPlaybackOwner(replacement, Date.now(), recoveryContext) || _recoverCrashedWorker(worker, recoveryContext, "Playback worker terminated without a healthy replacement", "warning", !0);
  }, HW_INITIAL_PONG_TIMEOUT_MS), !0;
}
function _recoverCrashedWorker(worker, pagePlaybackContext, message, level = "warning", allowIntentionalTermination = !1) {
  if (!worker || worker.__TTVABIntentionallyTerminated && !allowIntentionalTermination || worker.__TTVABCrashed)
    return !1;
  const recoveryContext = _getWorkerPlaybackContext(worker, pagePlaybackContext), currentContext = _getPlaybackContextFromUrl(window.location.href), recoveryContextIsCurrent = !_isPlaybackContextMismatch(recoveryContext, currentContext), crashedWorkerObservedPlayback = _getWorkerPlaybackObservationAt(worker, recoveryContext) > 0, crashedWorkerObservedBootstrap = _getWorkerPlaybackObservationAt(worker, recoveryContext, !0) > 0, crashedWorkerMayOwnPlayback = !!(crashedWorkerObservedPlayback || crashedWorkerObservedBootstrap), healthyPlaybackOwner = _getHealthyObservedPlaybackWorker(recoveryContext, worker, Date.now(), crashedWorkerMayOwnPlayback ? Math.max(0, Number(worker.__TTVABCreatedAt) || 0) : 0, crashedWorkerMayOwnPlayback), crashedWorkerGeneration = Math.max(0, Number(worker.__TTVABGeneration) || 0), healthyOwnerGeneration = Math.max(0, Number(healthyPlaybackOwner?.__TTVABGeneration) || 0), crashedAt = Date.now();
  if (_clearWorkerInitialHeartbeat(worker), worker.__TTVABCrashed = !0, worker.__TTVABCrashedAt = crashedAt, _reassignPageAdCycleControlAfterWorkerRetirement(recoveryContext.MediaKey, crashedWorkerGeneration, worker, crashedAt), pruneTrackedWorkers([worker]), !recoveryContext.MediaKey)
    return _installPageSideM3U8Override(), !0;
  if (healthyPlaybackOwner && (!crashedWorkerMayOwnPlayback || healthyOwnerGeneration > crashedWorkerGeneration) && _promoteWorkerPlaybackOwner(healthyPlaybackOwner, crashedAt, recoveryContext))
    return !0;
  const recoveryState = _getWorkerRecoveryState(recoveryContext);
  return recoveryState.timerID !== null && (clearTimeout(recoveryState.timerID), recoveryState.timerID = null), recoveryState.context = recoveryContext, recoveryState.activeEpoch = ++_workerRecoveryEpoch, recoveryState.pageContextGeneration = Math.max(0, Number(__TTVAB_STATE__?.PagePlaybackContextGeneration) || 0), recoveryState.failedGeneration = Math.max(0, Number(recoveryState.failedGeneration) || 0, Number(worker.__TTVABGeneration) || 0), recoveryState.crashedAt = crashedAt, recoveryState.bootstrapDeadlineAt = crashedAt + HW_INITIAL_PONG_TIMEOUT_MS, recoveryState.pipWaitDeadlineAt = crashedAt + HW_HIDDEN_STALE_MIN_MS, recoveryState.expectedAfterGeneration = recoveryState.failedGeneration, recoveryState.reloadDispatchedAt = 0, recoveryState.successorDeadlineAt = 0, recoveryState.hiddenLastMediaTime = -1, recoveryState.hiddenLastMediaRef = null, recoveryState.phase = "scheduled", worker.__TTVABRecoveryEpoch = recoveryState.activeEpoch, recoveryContextIsCurrent && _installPageSideM3U8Override(), _attemptWorkerRestart(worker, recoveryContext), !0;
}
function _attemptWorkerRestart(worker, pagePlaybackContext) {
  if (!worker || worker.__TTVABIntentionallyTerminated && !worker.__TTVABCrashed)
    return;
  const recoveryContext = _getWorkerPlaybackContext(worker, pagePlaybackContext), recoveryState = _getWorkerRecoveryState(recoveryContext);
  worker.__TTVABRecoveryEpoch || (recoveryState.activeEpoch = ++_workerRecoveryEpoch, recoveryState.pageContextGeneration = Math.max(0, Number(__TTVAB_STATE__?.PagePlaybackContextGeneration) || 0), recoveryState.failedGeneration = Math.max(0, Number(recoveryState.failedGeneration) || 0, Number(worker.__TTVABGeneration) || 0), recoveryState.crashedAt = Math.max(0, Number(worker.__TTVABCrashedAt) || 0) || Date.now(), recoveryState.bootstrapDeadlineAt = recoveryState.crashedAt + HW_INITIAL_PONG_TIMEOUT_MS, recoveryState.pipWaitDeadlineAt = recoveryState.crashedAt + HW_HIDDEN_STALE_MIN_MS, recoveryState.expectedAfterGeneration = recoveryState.failedGeneration, recoveryState.hiddenLastMediaTime = -1, recoveryState.hiddenLastMediaRef = null, recoveryState.phase = "scheduled", worker.__TTVABRecoveryEpoch = recoveryState.activeEpoch);
  const recoveryEpoch = Math.max(0, Number(worker.__TTVABRecoveryEpoch) || 0);
  if (recoveryEpoch <= 0 || recoveryState.activeEpoch !== recoveryEpoch || recoveryState.timerID !== null)
    return;
  const exhaustRecovery = (message) => {
    recoveryState.activeEpoch = 0, recoveryState.phase = "exhausted", worker.__TTVABRecoveryEpoch = 0, recoveryState.limitLogged || (recoveryState.limitLogged = !0), _installPageSideM3U8Override();
  }, attemptNumber = recoveryState.attempts + 1, delay = 2 ** Math.min(attemptNumber, HW_MAX_RESTART) * 500;
  recoveryState.attempts < HW_MAX_RESTART;
  const recoveryIsCurrent = () => recoveryState.activeEpoch !== recoveryEpoch || worker.__TTVABRecoveryEpoch !== recoveryEpoch ? !1 : _isWorkerRecoveryPageCurrent(worker, recoveryContext.MediaKey, recoveryState.pageContextGeneration) ? !0 : (recoveryState.activeEpoch = 0, recoveryState.phase = "cancelled", !1), scheduleRecovery = (callback, waitMs) => {
    if (!recoveryIsCurrent() || recoveryState.timerID !== null)
      return !1;
    const timerID = setTimeout(() => {
      recoveryState.timerID === timerID && (recoveryState.timerID = null), recoveryIsCurrent() && callback();
    }, Math.max(0, Number(waitMs) || 0));
    return recoveryState.timerID = timerID, !0;
  }, retryRecovery = () => {
    recoveryIsCurrent() && (recoveryState.phase = "scheduled", _attemptWorkerRestart(worker, recoveryContext));
  }, suspendPlayerWait = () => {
    recoveryState.playerWaitDeadlineAt > 0 && recoveryState.playerWaitSuspendedAt <= 0 && (recoveryState.playerWaitSuspendedAt = Date.now());
  }, confirmReplacement = () => {
    const currentContext = _getPlaybackContextFromUrl(window.location.href), contextIsCurrent = !_isPlaybackContextMismatch(recoveryContext, currentContext), contextIsPip = !!(typeof _isActivePictureInPicturePlaybackContext == "function" && _isActivePictureInPicturePlaybackContext(recoveryContext));
    if (!contextIsCurrent && !contextIsPip) {
      recoveryState.activeEpoch = 0, recoveryState.phase = "cancelled";
      return;
    }
    const replacement = _getQualifiedReplacementWorker(worker, recoveryContext, recoveryState.reloadDispatchedAt, recoveryState.expectedAfterGeneration);
    if (replacement && _promoteWorkerPlaybackOwner(replacement, Date.now(), recoveryContext)) {
      const replacementGeneration = Math.max(0, Number(replacement.__TTVABGeneration) || 0);
      recoveryState.retiredThroughGeneration = Math.max(0, Number(recoveryState.retiredThroughGeneration) || 0, recoveryState.expectedAfterGeneration), recoveryState.stableGeneration = replacementGeneration, recoveryState.stableSince = Date.now(), recoveryState.activeEpoch = 0, recoveryState.phase = "stabilizing";
      return;
    }
    if (Date.now() >= recoveryState.successorDeadlineAt) {
      retryRecovery();
      return;
    }
    scheduleRecovery(confirmReplacement, 1e3);
  }, runRecovery = () => {
    if (!recoveryIsCurrent())
      return;
    const now = Date.now();
    if (recoveryState.playerWaitSuspendedAt > 0 && (recoveryState.playerWaitDeadlineAt += Math.max(0, now - recoveryState.playerWaitSuspendedAt), recoveryState.playerWaitSuspendedAt = 0), worker.__TTVABIntentionallyTerminated && !worker.__TTVABCrashed) {
      recoveryState.activeEpoch = 0, recoveryState.phase = "cancelled";
      return;
    }
    const currentContext = _getPlaybackContextFromUrl(window.location.href), contextIsCurrent = !_isPlaybackContextMismatch(recoveryContext, currentContext), contextIsPip = !!(typeof _isActivePictureInPicturePlaybackContext == "function" && _isActivePictureInPicturePlaybackContext(recoveryContext));
    if (!contextIsCurrent && !contextIsPip) {
      recoveryState.activeEpoch = 0, recoveryState.phase = "cancelled";
      return;
    }
    contextIsCurrent && (recoveryState.phase === "waiting-pip" || recoveryState.phase === "degraded-pip") && typeof _installPageSideM3U8Override == "function" && _installPageSideM3U8Override();
    const automaticReplacement = _getQualifiedReplacementWorker(worker, recoveryContext, recoveryState.crashedAt, recoveryState.failedGeneration, Date.now(), !1);
    if (automaticReplacement && _promoteWorkerPlaybackOwner(automaticReplacement, Date.now(), recoveryContext)) {
      const replacementGeneration = Math.max(0, Number(automaticReplacement.__TTVABGeneration) || 0);
      recoveryState.retiredThroughGeneration = Math.max(0, Number(recoveryState.retiredThroughGeneration) || 0, recoveryState.failedGeneration), recoveryState.stableGeneration = replacementGeneration, recoveryState.stableSince = Date.now(), recoveryState.activeEpoch = 0, recoveryState.phase = "stabilizing";
      return;
    }
    if (typeof _hasUserPauseIntent == "function" && _hasUserPauseIntent(recoveryContext.ChannelName, recoveryContext.MediaKey)) {
      suspendPlayerWait(), recoveryState.pipWaitDeadlineAt = Math.max(Number(recoveryState.pipWaitDeadlineAt) || 0, Date.now() + HW_HIDDEN_STALE_MIN_MS), recoveryState.phase = "waiting-user-pause", scheduleRecovery(runRecovery, HW_WATCHDOG_INTERVAL_MS);
      return;
    }
    if (!contextIsCurrent && contextIsPip) {
      if (suspendPlayerWait(), Date.now() >= recoveryState.pipWaitDeadlineAt) {
        const wasDegradedPip = recoveryState.phase === "degraded-pip";
        recoveryState.phase = "degraded-pip", scheduleRecovery(runRecovery, HW_INITIAL_PONG_TIMEOUT_MS);
        return;
      }
      recoveryState.phase, recoveryState.phase = "waiting-pip", scheduleRecovery(runRecovery, HW_WATCHDOG_INTERVAL_MS);
      return;
    }
    let playbackDead = !1;
    if (typeof _isNativeDocumentHidden == "function" && _isNativeDocumentHidden(recoveryContext)) {
      const hiddenMedia = typeof _getPrimaryMediaElement == "function" ? _getPrimaryMediaElement() : null, hasHiddenMedia = hiddenMedia instanceof HTMLMediaElement, hiddenMediaTime = hasHiddenMedia ? Number(hiddenMedia.currentTime) || 0 : -1;
      if (playbackDead = hasHiddenMedia ? recoveryState.hiddenLastMediaRef?.deref?.() === hiddenMedia && recoveryState.hiddenLastMediaTime >= 0 && hiddenMediaTime >= recoveryState.hiddenLastMediaTime && hiddenMediaTime <= recoveryState.hiddenLastMediaTime + 0.2 : recoveryState.hiddenLastMediaTime === -2, recoveryState.hiddenLastMediaTime = hasHiddenMedia ? hiddenMediaTime : -2, recoveryState.hiddenLastMediaRef = hasHiddenMedia ? new WeakRef(hiddenMedia) : null, !playbackDead) {
        suspendPlayerWait(), scheduleRecovery(runRecovery, HW_WATCHDOG_INTERVAL_MS);
        return;
      }
    }
    if (recoveryState.attempts >= HW_MAX_RESTART) {
      exhaustRecovery("Worker restart limit reached after three source reloads; using degraded page-side M3U8 fallback");
      return;
    }
    if (recoveryState.playerWaitDeadlineAt > 0 && now >= recoveryState.playerWaitDeadlineAt) {
      exhaustRecovery("Worker recovery timed out waiting for a usable player; using degraded page-side M3U8 fallback");
      return;
    }
    if (!playbackDead && _hasStartingReplacementWorker(worker, recoveryContext, recoveryState.failedGeneration, recoveryState.bootstrapDeadlineAt)) {
      recoveryState.phase = "waiting-worker", scheduleRecovery(runRecovery, HW_WATCHDOG_INTERVAL_MS);
      return;
    }
    const lastRecoveryReloadAt = Math.max(0, Number(recoveryState.lastReloadAt) || 0);
    if (now - lastRecoveryReloadAt < HW_RECOVERY_COOLDOWN_MS) {
      const remainingCooldown = Math.max(0, HW_RECOVERY_COOLDOWN_MS - (now - lastRecoveryReloadAt));
      scheduleRecovery(runRecovery, remainingCooldown);
      return;
    }
    const generationBeforeReload = Math.max(recoveryState.failedGeneration, _getHighestWorkerGenerationForPlaybackContext(recoveryContext)), reloadMarkerBefore = _getPlayerReloadAtForMediaKey(recoveryContext.MediaKey), dispatchStartedAt = Date.now();
    let accepted = !1;
    try {
      accepted = typeof _doPlayerTask == "function" && _doPlayerTask(!1, !0, {
        reason: "worker-recovery",
        refreshAccessToken: !0,
        newMediaPlayerInstance: !0,
        channel: recoveryContext.ChannelName,
        mediaKey: recoveryContext.MediaKey
      }) === !0;
    } catch {
    }
    const reloadDispatchedAt = _getPlayerReloadAtForMediaKey(recoveryContext.MediaKey), didDispatchReload = reloadDispatchedAt > reloadMarkerBefore && reloadDispatchedAt >= dispatchStartedAt;
    if (didDispatchReload && (_recordWorkerRecoveryAttempt(recoveryContext, reloadDispatchedAt), recoveryState.lastReloadAt = reloadDispatchedAt, worker.__TTVABRestartAttempts = recoveryState.attempts), !!recoveryIsCurrent()) {
      if (!didDispatchReload) {
        recoveryState.playerWaitDeadlineAt <= 0 && (recoveryState.playerWaitDeadlineAt = now + HW_RECOVERY_PLAYER_WAIT_MS), recoveryState.phase = "waiting-player", scheduleRecovery(runRecovery, Math.min(HW_WATCHDOG_INTERVAL_MS, recoveryState.playerWaitDeadlineAt - now));
        return;
      }
      if (recoveryState.playerWaitDeadlineAt = 0, recoveryState.playerWaitSuspendedAt = 0, !accepted) {
        retryRecovery();
        return;
      }
      recoveryState.retiredThroughGeneration = Math.max(0, Number(recoveryState.retiredThroughGeneration) || 0, generationBeforeReload), recoveryState.expectedAfterGeneration = generationBeforeReload, recoveryState.reloadDispatchedAt = reloadDispatchedAt, recoveryState.successorDeadlineAt = reloadDispatchedAt + HW_RECOVERY_SUCCESSOR_TIMEOUT_MS, recoveryState.phase = "awaiting-successor", scheduleRecovery(confirmReplacement, 1e3);
    }
  };
  recoveryState.attempts >= HW_MAX_RESTART ? runRecovery() : scheduleRecovery(runRecovery, delay);
}
let _workerWatchdogID = null;
function _startWorkerWatchdog() {
  if (_workerWatchdogID !== null)
    return;
  let lastCheckedAt = Date.now();
  _workerWatchdogID = setInterval(() => {
    const now = Date.now(), elapsed = now - lastCheckedAt;
    lastCheckedAt = now, typeof _checkUnhookedPlayer == "function" && _checkUnhookedPlayer(), typeof _checkPostAdRecoveryNotice == "function" && _checkPostAdRecoveryNotice();
    for (const worker of _S.workers) {
      if (!worker || worker.__TTVABIntentionallyTerminated || worker.__TTVABCrashed)
        continue;
      const workerContext = _getWorkerPlaybackContext(worker, {
        MediaType: __TTVAB_STATE__?.PageMediaType || "channel",
        ChannelName: __TTVAB_STATE__?.PageChannel || "",
        VodID: __TTVAB_STATE__?.PageVodID || "",
        MediaKey: __TTVAB_STATE__?.PageMediaKey || ""
      }), isHidden = _isWorkerLifecycleThrottled(workerContext), schedulingGraceMs = isHidden ? HW_HIDDEN_STALE_MIN_MS : HW_PONG_TIMEOUT_MS;
      if (elapsed < 0 || elapsed > schedulingGraceMs) {
        worker.__TTVABMissedPongs = 0, worker.__TTVABLastPingSentAt = now, worker.__TTVABHiddenHeartbeatMediaTime = -1, worker.__TTVABHiddenHeartbeatMediaRef = null, worker.__TTVABHiddenHeartbeatMissingSamples = 0;
        try {
          _postWorkerBridgeMessage(worker, { key: "Ping", value: null });
        } catch {
        }
        continue;
      }
      const lastSeen = worker.__TTVABLastPongAt || worker.__TTVABCreatedAt || now, lastPingSentAt = Math.max(0, Number(worker.__TTVABLastPingSentAt) || 0), hasUnansweredPing = lastPingSentAt > lastSeen;
      hasUnansweredPing || (worker.__TTVABLastPingSentAt = now);
      let hiddenPlaybackStopped = !1;
      const workerContextIsCurrent = !_isPlaybackContextMismatch(workerContext, _getPlaybackContextFromUrl(window.location.href)), workerContextIsActivePip = !!(typeof _isActivePictureInPicturePlaybackContext == "function" && _isActivePictureInPicturePlaybackContext(workerContext)), hiddenHeartbeatIsStale = !!(isHidden && hasUnansweredPing && now - lastSeen >= HW_PONG_TIMEOUT_MS && now - lastPingSentAt >= HW_PONG_TIMEOUT_MS && (workerContextIsCurrent || workerContextIsActivePip)), hasUserPauseIntent = hiddenHeartbeatIsStale && typeof _hasUserPauseIntent == "function" && _hasUserPauseIntent(workerContext.ChannelName, workerContext.MediaKey);
      if (hiddenHeartbeatIsStale && hasUserPauseIntent) {
        worker.__TTVABMissedPongs = 0, worker.__TTVABHiddenHeartbeatMediaTime = -1, worker.__TTVABHiddenHeartbeatMediaRef = null, worker.__TTVABHiddenHeartbeatMissingSamples = 0;
        try {
          _postWorkerBridgeMessage(worker, { key: "Ping", value: null });
        } catch {
        }
        continue;
      }
      if (hiddenHeartbeatIsStale && !hasUserPauseIntent) {
        const hiddenMedia = typeof _getPrimaryMediaElement == "function" ? _getPrimaryMediaElement() : null;
        if (hiddenMedia instanceof HTMLMediaElement) {
          const mediaTime = Number(hiddenMedia.currentTime) || 0;
          hiddenPlaybackStopped = worker.__TTVABHiddenHeartbeatMediaRef?.deref?.() === hiddenMedia && worker.__TTVABHiddenHeartbeatMediaTime >= 0 && mediaTime >= worker.__TTVABHiddenHeartbeatMediaTime && mediaTime <= worker.__TTVABHiddenHeartbeatMediaTime + 0.2, worker.__TTVABHiddenHeartbeatMediaTime = mediaTime, worker.__TTVABHiddenHeartbeatMediaRef = new WeakRef(hiddenMedia), worker.__TTVABHiddenHeartbeatMissingSamples = 0;
        } else
          worker.__TTVABHiddenHeartbeatMediaTime = -1, worker.__TTVABHiddenHeartbeatMediaRef = null, worker.__TTVABHiddenHeartbeatMissingSamples = Math.max(0, Number(worker.__TTVABHiddenHeartbeatMissingSamples) || 0) + 1, hiddenPlaybackStopped = worker.__TTVABHiddenHeartbeatMissingSamples >= 2;
      } else
        worker.__TTVABHiddenHeartbeatMediaTime = -1, worker.__TTVABHiddenHeartbeatMediaRef = null, worker.__TTVABHiddenHeartbeatMissingSamples = 0;
      if (hiddenPlaybackStopped) {
        _recoverCrashedWorker(worker, workerContext, "Worker unresponsive while hidden playback stopped advancing", "warning");
        continue;
      }
      if (now - lastSeen > HW_PONG_TIMEOUT_MS && hasUnansweredPing && now - lastPingSentAt > HW_PONG_TIMEOUT_MS) {
        const missedPongs = Math.max(0, Number(worker.__TTVABMissedPongs) || 0) + 1;
        worker.__TTVABMissedPongs = missedPongs;
        const missedPongLimit = isHidden ? HW_MAX_MISSED_PONGS_HIDDEN : HW_MAX_MISSED_PONGS, hiddenStaleSatisfied = !isHidden || now - lastSeen > HW_HIDDEN_STALE_MIN_MS;
        if (missedPongs < missedPongLimit || !hiddenStaleSatisfied) {
          try {
            _postWorkerBridgeMessage(worker, { key: "Ping", value: null });
          } catch {
          }
          continue;
        }
        _recoverCrashedWorker(worker, workerContext, "Worker unresponsive (no pong)", "warning");
        continue;
      }
      try {
        _postWorkerBridgeMessage(worker, { key: "Ping", value: null });
      } catch {
      }
    }
  }, HW_WATCHDOG_INTERVAL_MS);
}
function _attemptPageSideFallbackTerminalRearm(url, mediaKey, cycleStartedAt, priorAdOwner) {
  const normalizedMediaKey = _normalizeMediaKey(mediaKey), normalizedCycleStartedAt = Math.max(0, Number(cycleStartedAt) || 0), recoveryContext = {
    MediaType: __TTVAB_STATE__?.PageMediaType,
    ChannelName: __TTVAB_STATE__?.PageChannel,
    VodID: __TTVAB_STATE__?.PageVodID,
    MediaKey: normalizedMediaKey
  }, recoveryState = _getWorkerRecoveryState(recoveryContext, !1), ownerGeneration = Math.max(0, Number(priorAdOwner?.workerGeneration) || 0), ownerConfirmedAt = Math.max(0, Number(priorAdOwner?.confirmedPlaybackAt) || 0), retiredThroughGeneration = Math.max(0, Number(recoveryState?.retiredThroughGeneration) || 0, Number(recoveryState?.failedGeneration) || 0), currentContext = _getPlaybackContextFromUrl(window.location.href), reloadAt = _getPlayerReloadAtForMediaKey(normalizedMediaKey), ownerHandoffId = typeof priorAdOwner?.handoffId == "string" && priorAdOwner.handoffId ? priorAdOwner.handoffId : null, activeHandoffId = _normalizeMediaKey(__TTVAB_STATE__?.ActiveCodecHandoffMediaKey) === normalizedMediaKey && __TTVAB_STATE__?.ActiveCodecHandoffId || null;
  if (!normalizedMediaKey || normalizedCycleStartedAt <= 0 || recoveryState?.phase !== "exhausted" || _normalizeMediaKey(__TTVAB_STATE__?.PageMediaKey) !== normalizedMediaKey || _normalizeMediaKey(__TTVAB_STATE__?.CurrentAdMediaKey) !== normalizedMediaKey || _isPlaybackContextMismatch(recoveryContext, currentContext) || !_isPageLifecycleCycleCurrent(normalizedMediaKey, normalizedCycleStartedAt) || _pageSidePlaybackOwnerByUrl.get(_getExactPlaylistUrlKey(url)) !== priorAdOwner || _normalizeMediaKey(priorAdOwner?.mediaKey) !== normalizedMediaKey || Math.max(0, Number(priorAdOwner?.adCycleStartedAt) || 0) !== normalizedCycleStartedAt || ownerGeneration <= 0 || ownerConfirmedAt <= 0 || ownerGeneration > retiredThroughGeneration || reloadAt <= ownerConfirmedAt || Math.max(0, Number(recoveryState.terminalRearmCycleStartedAt) || 0) === normalizedCycleStartedAt || typeof _hasUserPauseIntent == "function" && _hasUserPauseIntent(recoveryContext.ChannelName, normalizedMediaKey))
    return !1;
  const attemptedAt = Date.now(), previousAttemptedAt = Math.max(0, Number(recoveryState.terminalRearmAttemptedAt) || 0);
  if (previousAttemptedAt > 0 && attemptedAt - previousAttemptedAt < HW_RECOVERY_COOLDOWN_MS)
    return !1;
  for (const handoffId of /* @__PURE__ */ new Set([ownerHandoffId, activeHandoffId])) {
    if (!handoffId)
      continue;
    const handoffParts = handoffId.split(":"), handoffCreatedAt = Math.max(0, Number(handoffParts[handoffParts.length - 3]) || 0);
    if (_getCodecHandoffCycleStartedAt(handoffId) !== normalizedCycleStartedAt || handoffCreatedAt > 0 && reloadAt < handoffCreatedAt)
      return !1;
  }
  ownerHandoffId && (priorAdOwner.handoffId = null), activeHandoffId && (__TTVAB_STATE__.ActiveCodecHandoffId = null, __TTVAB_STATE__.ActiveCodecHandoffChannel = null, __TTVAB_STATE__.ActiveCodecHandoffMediaKey = null, _broadcastWorkers({
    key: "UpdateCodecHandoffContext",
    targetMediaKey: normalizedMediaKey,
    value: {
      clearHandoffId: activeHandoffId,
      channelName: recoveryContext.ChannelName,
      mediaKey: normalizedMediaKey
    }
  })), recoveryState.terminalRearmAttemptedAt = attemptedAt;
  const reloadBefore = _getPlayerReloadAtForMediaKey(normalizedMediaKey), accepted = typeof _doPlayerTask == "function" && _doPlayerTask(!1, !0, {
    reason: "worker-recovery",
    refreshAccessToken: !0,
    newMediaPlayerInstance: !0,
    channel: recoveryContext.ChannelName,
    mediaKey: normalizedMediaKey,
    cycleStartedAt: normalizedCycleStartedAt
  }) === !0, reloadAfter = _getPlayerReloadAtForMediaKey(normalizedMediaKey);
  return !accepted || reloadAfter <= reloadBefore || reloadAfter < attemptedAt ? !1 : (recoveryState.terminalRearmCycleStartedAt = normalizedCycleStartedAt, !0);
}
function _isPageSideFallbackRecoveryReady(url, text, info, mediaKey) {
  const normalizedMediaKey = _normalizeMediaKey(mediaKey), podProgress = __TTVAB_STATE__?.AdPodProgressByMediaKey?.[normalizedMediaKey] || null, cycleStartedAt = Math.max(0, Number(podProgress?.cycleStartedAt) || 0);
  if (!normalizedMediaKey || cycleStartedAt <= 0 || !info)
    return !1;
  const expectedPodLength = Math.max(0, Math.trunc(Number(podProgress?.expectedPodLength) || 0)), observedPodLength = Array.isArray(podProgress?.adIds) ? new Set(podProgress.adIds.filter(Boolean)).size : 0, maxAdPodPosition = Math.max(0, Math.trunc(Number(podProgress?.maxAdPodPosition) || 0)), observedTerminalPodPosition = expectedPodLength > 0 && (podProgress?.observedZeroAdPodPosition === !0 ? maxAdPodPosition + 1 >= expectedPodLength : maxAdPodPosition >= expectedPodLength), declaredPodIncomplete = expectedPodLength > 0 && observedPodLength < expectedPodLength && !observedTerminalPodPosition, recoveryState = _getWorkerRecoveryState({
    MediaType: __TTVAB_STATE__?.PageMediaType,
    ChannelName: __TTVAB_STATE__?.PageChannel,
    VodID: __TTVAB_STATE__?.PageVodID,
    MediaKey: normalizedMediaKey
  }, !1);
  if (recoveryState?.phase !== "exhausted" && recoveryState?.phase !== "stabilizing")
    return !1;
  const priorAdOwner = _pageSidePlaybackOwnerByUrl.get(_getExactPlaylistUrlKey(url));
  if (_normalizeMediaKey(priorAdOwner?.mediaKey) !== normalizedMediaKey || Math.max(0, Number(priorAdOwner?.adCycleStartedAt) || 0) !== cycleStartedAt)
    return !1;
  const lastMarkedProgressAt = Math.max(0, Number(priorAdOwner?.lastAdMarkedAt) || 0, Number(podProgress?.updatedAt) || 0);
  Math.max(0, Number(info._PageFallbackCycleStartedAt) || 0) !== cycleStartedAt && (info._PageFallbackCycleStartedAt = cycleStartedAt, info._PageFallbackCleanStartedAt = 0, info._PageFallbackCleanPlaylistCount = 0, info._PageFallbackLastMediaSequence = null);
  const now = Date.now();
  Math.max(0, Number(info._PageFallbackCleanStartedAt) || 0) > 0 && Math.max(0, Number(info._PageFallbackCleanStartedAt) || 0) <= lastMarkedProgressAt && (info._PageFallbackCleanStartedAt = 0, info._PageFallbackCleanPlaylistCount = 0, info._PageFallbackLastMediaSequence = null);
  const mediaSequence = _parsePlaylistFirstMediaSequence(text), previousMediaSequence = typeof info._PageFallbackLastMediaSequence == "number" && Number.isFinite(info._PageFallbackLastMediaSequence) ? info._PageFallbackLastMediaSequence : null, isVod = normalizedMediaKey.startsWith("vod:");
  if (isVod && !text.includes("#EXT-X-ENDLIST"))
    return !1;
  if (!isVod && previousMediaSequence !== null && mediaSequence !== null && mediaSequence <= previousMediaSequence)
    return mediaSequence < previousMediaSequence && (info._PageFallbackCleanStartedAt = now, info._PageFallbackCleanPlaylistCount = 1, info._PageFallbackLastMediaSequence = mediaSequence), !1;
  if (!isVod && mediaSequence === null)
    return !1;
  info._PageFallbackCleanStartedAt || (info._PageFallbackCleanStartedAt = now), info._PageFallbackCleanPlaylistCount = Math.max(0, Number(info._PageFallbackCleanPlaylistCount) || 0) + 1, info._PageFallbackLastMediaSequence = mediaSequence;
  const escalation = 4, minCleanPlaylists = Math.max(1, Number(__TTVAB_STATE__?.AdEndMinCleanPlaylists) || 1) + escalation, graceMs = Math.max(0, Number(__TTVAB_STATE__?.AdEndGraceMs) || 0) + escalation * 2500;
  if (!(info._PageFallbackCleanPlaylistCount >= minCleanPlaylists && now - info._PageFallbackCleanStartedAt >= graceMs))
    return !1;
  if (declaredPodIncomplete) {
    const terminalEscapeMs = Math.max(9e4, Number(__TTVAB_STATE__?.AdEndBackupHoldMaxMs) || 0);
    if (lastMarkedProgressAt <= 0 || now - lastMarkedProgressAt < terminalEscapeMs || isVod && !text.includes("#EXT-X-ENDLIST"))
      return !1;
  }
  return _getTrustedPageSidePlaybackOwner(url, normalizedMediaKey, cycleStartedAt) ? !0 : (_attemptPageSideFallbackTerminalRearm(url, normalizedMediaKey, cycleStartedAt, priorAdOwner), !1);
}
function _completePageSideFallbackAdRecovery(mediaKey) {
  const normalizedMediaKey = _normalizeMediaKey(mediaKey), activeMediaKey = _normalizeMediaKey(__TTVAB_STATE__?.CurrentAdMediaKey), cycleStartedAt = Math.max(0, Number(__TTVAB_STATE__?.AdPodProgressByMediaKey?.[normalizedMediaKey]?.cycleStartedAt) || 0);
  if (!normalizedMediaKey || activeMediaKey !== normalizedMediaKey || cycleStartedAt <= 0)
    return !1;
  const recoveryState = _getWorkerRecoveryState({
    MediaType: __TTVAB_STATE__?.PageMediaType,
    ChannelName: __TTVAB_STATE__?.PageChannel,
    VodID: __TTVAB_STATE__?.PageVodID,
    MediaKey: normalizedMediaKey
  }, !1);
  recoveryState?.phase === "exhausted" && (recoveryState.retiredThroughGeneration = Math.max(0, Number(recoveryState.retiredThroughGeneration) || 0, Number(recoveryState.failedGeneration) || 0));
  const endedAt = Date.now(), channel = __TTVAB_STATE__?.CurrentAdChannel || __TTVAB_STATE__?.PageChannel || null, handoffId = _normalizeMediaKey(__TTVAB_STATE__?.ActiveCodecHandoffMediaKey) === normalizedMediaKey && __TTVAB_STATE__?.ActiveCodecHandoffId || null;
  for (const streamInfo of Object.values(__TTVAB_STATE__?.StreamInfos || {}))
    _normalizeMediaKey(streamInfo?.MediaKey) === normalizedMediaKey && _resetStreamAdState(streamInfo, !0);
  __TTVAB_STATE__.LastAdEndedAt = endedAt, __TTVAB_STATE__.LastAdEndedChannel = channel, __TTVAB_STATE__.LastAdEndedMediaKey = normalizedMediaKey, __TTVAB_STATE__.LastAdEndedCycleStartedAt = cycleStartedAt, __TTVAB_STATE__.CurrentAdChannel = null, __TTVAB_STATE__.CurrentAdMediaKey = null, _normalizeMediaKey(__TTVAB_STATE__?.PinnedBackupPlayerMediaKey) === normalizedMediaKey && (__TTVAB_STATE__.PinnedBackupPlayerType = null, __TTVAB_STATE__.PinnedBackupPlayerChannel = null, __TTVAB_STATE__.PinnedBackupPlayerMediaKey = null), handoffId && (__TTVAB_STATE__.ActiveCodecHandoffId = null, __TTVAB_STATE__.ActiveCodecHandoffChannel = null, __TTVAB_STATE__.ActiveCodecHandoffMediaKey = null), __TTVAB_STATE__._AdRecoveryConsecutiveFailures = 0;
  const messages = [
    {
      key: "ResetAdCycleState",
      targetMediaKey: normalizedMediaKey,
      value: {
        mediaType: __TTVAB_STATE__?.PageMediaType,
        channelName: channel,
        vodID: __TTVAB_STATE__?.PageVodID,
        mediaKey: normalizedMediaKey,
        cycleStartedAt
      }
    },
    {
      key: "UpdateLastAdEndContext",
      targetMediaKey: normalizedMediaKey,
      value: {
        mediaType: __TTVAB_STATE__?.PageMediaType,
        channelName: channel,
        vodID: __TTVAB_STATE__?.PageVodID,
        mediaKey: normalizedMediaKey,
        endedAt,
        cycleStartedAt
      }
    }
  ];
  return handoffId && messages.push({
    key: "UpdateCodecHandoffContext",
    targetMediaKey: normalizedMediaKey,
    value: {
      clearHandoffId: handoffId,
      channelName: channel,
      mediaKey: normalizedMediaKey
    }
  }), _broadcastWorkers(messages), _clearAdPodProgress(normalizedMediaKey), typeof _clearPlaybackRecoveryTimeoutsForContext == "function" && _clearPlaybackRecoveryTimeoutsForContext(normalizedMediaKey), typeof _resetPlayerBufferMonitorState == "function" && _resetPlayerBufferMonitorState(), typeof _clearAdResumeIntent == "function" && _clearAdResumeIntent(), typeof _restoreSuppressedMediaAfterAd == "function" && _restoreSuppressedMediaAfterAd(channel, normalizedMediaKey), _schedulePostAdArtifactCleanup(channel, normalizedMediaKey, cycleStartedAt), !0;
}
function _ensurePageSideFallbackAdCycle(url, _codec = null, playlistText = "") {
  if (__TTVAB_STATE__?.IsAdStrippingEnabled !== !0)
    return 0;
  const context = _normalizePlaybackContext({
    MediaType: __TTVAB_STATE__?.PageMediaType,
    ChannelName: __TTVAB_STATE__?.PageChannel,
    VodID: __TTVAB_STATE__?.PageVodID,
    MediaKey: __TTVAB_STATE__?.PageMediaKey
  });
  if (!context.MediaKey)
    return 0;
  const observedAdIds = [];
  let expectedPodLength = 0, maxAdPodPosition = 0, observedZeroAdPodPosition = !1;
  for (const line of String(playlistText || "").split(`
`)) {
    if (!line.startsWith("#EXT-X-DATERANGE:"))
      continue;
    const attrs = _parseAttrs(line.slice(17)), adId = typeof attrs.ID == "string" ? attrs.ID : null;
    adId?.startsWith("stitched-ad-") && observedAdIds.push(adId), expectedPodLength = Math.max(expectedPodLength, Math.max(0, Number(attrs["X-TV-TWITCH-AD-POD-LENGTH"]) || 0)), maxAdPodPosition = Math.max(maxAdPodPosition, Math.max(0, Number(attrs["X-TV-TWITCH-AD-POD-POSITION"]) || 0)), Object.hasOwn(attrs, "X-TV-TWITCH-AD-POD-POSITION") && Number(attrs["X-TV-TWITCH-AD-POD-POSITION"]) === 0 && (observedZeroAdPodPosition = !0);
  }
  const now = Date.now(), activeMediaKey = _normalizeMediaKey(__TTVAB_STATE__?.CurrentAdMediaKey), activeCycleStartedAt = Math.max(0, Number(__TTVAB_STATE__?.AdPodProgressByMediaKey?.[context.MediaKey]?.cycleStartedAt) || 0), exactOwner = _pageSidePlaybackOwnerByUrl.get(_getExactPlaylistUrlKey(url));
  if (activeMediaKey === context.MediaKey && activeCycleStartedAt > 0) {
    if (_normalizeMediaKey(exactOwner?.mediaKey) !== context.MediaKey || Math.max(0, Number(exactOwner?.adCycleStartedAt) || 0) !== activeCycleStartedAt)
      return 0;
    const progress2 = _mergeAdPodProgress({
      mediaType: context.MediaType,
      channelName: context.ChannelName,
      vodID: context.VodID,
      mediaKey: context.MediaKey,
      adIds: observedAdIds,
      expectedPodLength,
      maxAdPodPosition,
      observedZeroAdPodPosition,
      cycleStartedAt: activeCycleStartedAt
    });
    return _rememberPageSidePlaybackOwner(context.MediaKey, url, null, activeCycleStartedAt, { confirmedPlayback: !1, adMarked: !0 }), progress2 && _broadcastWorkers({
      key: "UpdateAdPodProgress",
      targetMediaKey: context.MediaKey,
      value: {
        mediaType: context.MediaType,
        channelName: context.ChannelName,
        vodID: context.VodID,
        mediaKey: context.MediaKey,
        ...progress2
      }
    }), activeCycleStartedAt;
  }
  if (!_getTrustedPageSidePlaybackOwner(url, context.MediaKey))
    return 0;
  const lastEndedCycleStartedAt = _normalizeMediaKey(__TTVAB_STATE__?.LastAdEndedMediaKey) === context.MediaKey ? Math.max(0, Number(__TTVAB_STATE__?.LastAdEndedCycleStartedAt) || 0) : 0, isRecentContinuation = lastEndedCycleStartedAt > 0 && now - Math.max(0, Number(__TTVAB_STATE__?.LastAdEndedAt) || 0) <= _getPostAdReentryContinuationMs(), cycleStartedAt = isRecentContinuation ? lastEndedCycleStartedAt : now;
  isRecentContinuation || (_clearAdPodProgress(context.MediaKey), typeof _clearPlaybackRecoveryTimeoutsForContext == "function" && _clearPlaybackRecoveryTimeoutsForContext(context.MediaKey));
  const progress = _mergeAdPodProgress({
    mediaType: context.MediaType,
    channelName: context.ChannelName,
    vodID: context.VodID,
    mediaKey: context.MediaKey,
    adIds: observedAdIds,
    expectedPodLength,
    maxAdPodPosition,
    observedZeroAdPodPosition,
    cycleStartedAt
  });
  return __TTVAB_STATE__.CurrentAdChannel = context.ChannelName, __TTVAB_STATE__.CurrentAdMediaKey = context.MediaKey, __TTVAB_STATE__.LastAdDetectedAt = now, __TTVAB_STATE__.LastAdRecoveryReloadAt = 0, __TTVAB_STATE__.LastAdRecoveryResumeAt = 0, _rememberPageSidePlaybackOwner(context.MediaKey, url, null, cycleStartedAt, {
    confirmedPlayback: !1,
    adMarked: !0
  }), _broadcastWorkers([
    {
      key: "UpdateCurrentAdContext",
      targetMediaKey: context.MediaKey,
      value: {
        channelName: context.ChannelName,
        mediaKey: context.MediaKey
      }
    },
    {
      key: "UpdateAdPodProgress",
      targetMediaKey: context.MediaKey,
      value: {
        mediaType: context.MediaType,
        channelName: context.ChannelName,
        vodID: context.VodID,
        mediaKey: context.MediaKey,
        ...progress
      }
    }
  ]), typeof _rememberPlayerPlaybackForAd == "function" && _rememberPlayerPlaybackForAd(context.ChannelName, context.MediaKey), typeof _ensurePlaybackMonitorsRunning == "function" && _ensurePlaybackMonitorsRunning(!0), cycleStartedAt;
}
function _installPageSideM3U8Override() {
  if (window.__TTVAB_M3U8_FALLBACK_ACTIVE)
    return;
  window.__TTVAB_M3U8_FALLBACK_ACTIVE = !0;
  const realFetch = window.fetch;
  window.__TTVAB_REAL_FETCH__ || (window.__TTVAB_REAL_FETCH__ = realFetch);
  let fallbackWasEnabled = __TTVAB_STATE__?.IsAdStrippingEnabled === !0;
  const shouldPassThrough = () => {
    const enabled = __TTVAB_STATE__?.IsAdStrippingEnabled === !0;
    return !enabled && fallbackWasEnabled && _pageSideEmptyHoldInfoByUrl.clear(), fallbackWasEnabled = enabled, !enabled;
  };
  window.fetch = async function(...args) {
    if (shouldPassThrough())
      return realFetch.apply(this, args);
    const [urlOrRequest] = args, urlStr = urlOrRequest instanceof Request ? urlOrRequest.url : String(urlOrRequest || ""), isM3U8 = /\.m3u8(?:$|\?)/.test(urlStr) && (urlStr.includes("twitch") || urlStr.includes("ttvnw.net") || urlStr.includes("twitchcdn.net")), fallbackRequestSignal = args[1]?.signal || (urlOrRequest instanceof Request ? urlOrRequest.signal : null), requestMediaKey = _normalizeMediaKey(__TTVAB_STATE__?.PageMediaKey), requestGeneration = Number(__TTVAB_STATE__?.PagePlaybackContextGeneration) || 0, assertCurrent = () => {
      if (fallbackRequestSignal?.aborted || requestMediaKey !== _normalizeMediaKey(__TTVAB_STATE__?.PageMediaKey) || requestGeneration !== (Number(__TTVAB_STATE__?.PagePlaybackContextGeneration) || 0))
        throw _createCodecHandoffAbortError(fallbackRequestSignal);
    }, shouldBlockCachedAdSegments = !!(__TTVAB_STATE__?.CurrentAdMediaKey || __TTVAB_STATE__?.CurrentAdChannel || __TTVAB_STATE__?.SimulatedAdsDepth > 0);
    if (__TTVAB_STATE__.AdSegmentCache instanceof Map || (__TTVAB_STATE__.AdSegmentCache = /* @__PURE__ */ new Map()), !isM3U8) {
      if (_isEmptyAdHoldSegmentUrl(urlStr))
        return _getEmptyAdHoldResponse(urlStr, realFetch, fallbackRequestSignal);
      if (_isKnownAdSegmentUrl(urlStr, {
        includeCached: shouldBlockCachedAdSegments
      }))
        throw _createCodecHandoffAbortError(fallbackRequestSignal);
      return realFetch.apply(this, args);
    }
    try {
      const timelineKey = _getMediaPlaylistSessionKey(urlStr), previousTimeline = _pageSideEmptyHoldInfoByUrl.get(timelineKey), upstreamUrl = _getEmptyHoldUpstreamUrl(previousTimeline?.MediaKey === (requestMediaKey || urlStr) && previousTimeline?.PageContextGeneration === requestGeneration ? previousTimeline : null, urlStr), fetchArgs = upstreamUrl === urlStr ? args : [
        urlOrRequest instanceof Request ? new Request(upstreamUrl, urlOrRequest) : upstreamUrl,
        ...args.slice(1)
      ], response = await realFetch.apply(this, fetchArgs);
      if (shouldPassThrough() || response.status !== 200)
        return response;
      const text = await response.clone().text();
      if (shouldPassThrough())
        return response;
      assertCurrent(), _rememberPageSideVariantCodecs(text, urlStr);
      const getContinuousResponse = (playlist) => {
        if (assertCurrent(), playlist.includes("#EXT-X-STREAM-INF"))
          return response;
        const mapped = _applyPlaylistContinuity(getEmptyHoldInfo(), urlStr, playlist);
        return mapped === text && playlist === text ? response : new Response(mapped ?? playlist, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      }, getEmptyHoldInfo = () => {
        let emptyHoldInfo = _pageSideEmptyHoldInfoByUrl.get(timelineKey) || null;
        if (emptyHoldInfo && (emptyHoldInfo.MediaKey !== (requestMediaKey || urlStr) || emptyHoldInfo.PageContextGeneration !== requestGeneration) && (emptyHoldInfo = null), !emptyHoldInfo)
          for (emptyHoldInfo = {
            MediaKey: requestMediaKey || urlStr,
            MediaType: requestMediaKey?.startsWith("live:") ? "live" : "vod",
            PageContextGeneration: requestGeneration,
            UsherBaseUrl: timelineKey,
            _EmptyAdHoldMediaSequence: 0,
            _EmptyAdHoldDiscontinuitySequence: 0,
            _EmptyAdHoldProgramDateTime: 0,
            _EmptyAdHoldWindow: null,
            _EmptyHoldTimelineByUrl: /* @__PURE__ */ new Map(),
            _LivePlaylistTimeline: null,
            NumStrippedAdSegments: 0,
            IsStrippingAdSegments: !1
          }, _pageSideEmptyHoldInfoByUrl.set(timelineKey, emptyHoldInfo); _pageSideEmptyHoldInfoByUrl.size > 20; ) {
            const oldest = _pageSideEmptyHoldInfoByUrl.keys().next().value;
            if (oldest === void 0)
              break;
            _pageSideEmptyHoldInfoByUrl.delete(oldest);
          }
        return emptyHoldInfo;
      }, fallbackCodecFamily = _getPlaylistUrlAliases(urlStr).map((alias) => _pageSideVariantCodecByUrl.get(alias)).find(Boolean);
      let activeAdMediaKey = _normalizeMediaKey(__TTVAB_STATE__?.CurrentAdMediaKey);
      const pageMediaKey = _normalizeMediaKey(__TTVAB_STATE__?.PageMediaKey);
      let ownsActiveAdCycle = !!(activeAdMediaKey && activeAdMediaKey === pageMediaKey);
      const hasKnownAdMedia = typeof _playlistHasKnownAdSegments == "function" && _playlistHasKnownAdSegments(text, {
        includeCached: shouldBlockCachedAdSegments
      });
      if (!_hasTwitchAdMetadata(text) && !hasKnownAdMedia) {
        if (!ownsActiveAdCycle || text.includes("#EXT-X-STREAM-INF"))
          return getContinuousResponse(text);
        const emptyHoldInfo = getEmptyHoldInfo();
        if (_isPageSideFallbackRecoveryReady(urlStr, text, emptyHoldInfo, pageMediaKey) && _completePageSideFallbackAdRecovery(pageMediaKey))
          return getContinuousResponse(text);
        if (!_canServePageSideAvcHold(urlStr, pageMediaKey, __TTVAB_STATE__?.AdPodProgressByMediaKey?.[pageMediaKey]?.cycleStartedAt))
          throw _createCodecHandoffAbortError(fallbackRequestSignal);
        const hold = _createEmptyAdHoldPlaylist(text, emptyHoldInfo);
        return getContinuousResponse(hold);
      }
      if (pageMediaKey && !text.includes("#EXT-X-STREAM-INF")) {
        const cycleStartedAt = _ensurePageSideFallbackAdCycle(urlStr, fallbackCodecFamily, text);
        activeAdMediaKey = _normalizeMediaKey(__TTVAB_STATE__?.CurrentAdMediaKey), ownsActiveAdCycle = cycleStartedAt > 0 && activeAdMediaKey === pageMediaKey;
        const emptyHoldInfo = getEmptyHoldInfo();
        emptyHoldInfo._PageFallbackCycleStartedAt = cycleStartedAt, emptyHoldInfo._PageFallbackCleanStartedAt = 0, emptyHoldInfo._PageFallbackCleanPlaylistCount = 0, emptyHoldInfo._PageFallbackLastMediaSequence = null;
      }
      const stripped = _stripM3U8Ads(text, getEmptyHoldInfo());
      if (stripped.includes("https://www.twitch.tv/__ttvab_empty_hold_segment.ts") && !_canServePageSideAvcHold(urlStr, pageMediaKey, __TTVAB_STATE__?.AdPodProgressByMediaKey?.[pageMediaKey]?.cycleStartedAt))
        throw _createCodecHandoffAbortError(fallbackRequestSignal);
      return getContinuousResponse(stripped === text ? text : stripped);
    } catch (error) {
      throw error;
    }
  };
}
function _rememberPageSideVariantCodecs(text, baseUrl) {
  if (typeof text != "string" || !text.includes("#EXT-X-STREAM-INF"))
    return !1;
  const lines = text.split(`
`);
  let remembered = !1;
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i]?.startsWith("#EXT-X-STREAM-INF"))
      continue;
    const rawUrl = lines[i + 1]?.trim();
    if (!rawUrl || rawUrl.startsWith("#"))
      continue;
    const codecFamily = _getVideoCodecFamily(_parseAttrs(lines[i]).CODECS);
    if (!codecFamily)
      continue;
    let variantUrl = rawUrl;
    try {
      variantUrl = new URL(rawUrl, baseUrl).href;
    } catch {
    }
    for (const alias of _getPlaylistUrlAliases(variantUrl, baseUrl))
      _pageSideVariantCodecByUrl.set(alias, codecFamily), remembered = !0;
  }
  for (; _pageSideVariantCodecByUrl.size > 200; ) {
    const oldest = _pageSideVariantCodecByUrl.keys().next().value;
    if (oldest === void 0)
      break;
    _pageSideVariantCodecByUrl.delete(oldest);
  }
  return remembered;
}
function _hasTwitchAdMetadata(text) {
  return typeof _hasExplicitAdMetadata == "function" ? _hasExplicitAdMetadata(text) : typeof text == "string" && text.includes("stitched-ad");
}
function _stripM3U8Ads(text, emptyHoldInfo = null) {
  __TTVAB_STATE__.AdSegmentCache instanceof Map || (__TTVAB_STATE__.AdSegmentCache = /* @__PURE__ */ new Map());
  const info = emptyHoldInfo || {
    MediaKey: __TTVAB_STATE__?.PageMediaKey || "degraded-page-fallback",
    _EmptyAdHoldMediaSequence: 0,
    _EmptyAdHoldDiscontinuitySequence: 0,
    NumStrippedAdSegments: 0,
    IsStrippingAdSegments: !1
  };
  return _stripAds(text, !1, info);
}
function _hookWorker() {
  if (_syncStoredDeviceId(), typeof window?.Worker != "function")
    return;
  const isAllowedWorkerHost = (hostname) => {
    const host = String(hostname || "").toLowerCase();
    return host === "twitch.tv" || host.endsWith(".twitch.tv") || host === "ttvnw.net" || host.endsWith(".ttvnw.net") || host === "twitchcdn.net" || host.endsWith(".twitchcdn.net");
  }, normalizeWorkerUrl = (url) => url instanceof URL ? url.href : new URL(String(url), window.location.href).href, isTwitchWorkerUrl = (workerUrl) => {
    const parsed = new URL(workerUrl);
    if (isAllowedWorkerHost(parsed.hostname))
      return !0;
    if (parsed.protocol === "blob:") {
      const pageHost = window.location.hostname;
      return isAllowedWorkerHost(pageHost) && parsed.origin === window.location.origin;
    }
    return !1;
  }, workerHookSourceMarker = `__TTVAB_WORKER_HOOK_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}__`, createHookedWorkerConstructor = (BaseWorker) => {
    const reinsertNames = _getReinsert(BaseWorker), HookedWorker = class extends _cleanWorker(BaseWorker) {
      constructor(url, opts) {
        let isTwitch = !1, workerSourceUrl = null;
        try {
          workerSourceUrl = normalizeWorkerUrl(url), isTwitch = isTwitchWorkerUrl(workerSourceUrl);
        } catch {
          isTwitch = !1;
        }
        if (workerSourceUrl && _trackedExtensionBlobUrls.has(workerSourceUrl)) {
          super(url, opts);
          return;
        }
        if (!isTwitch) {
          super(url, opts);
          return;
        }
        const pagePlaybackContext = _syncPagePlaybackContext({
          broadcast: !1
        }), seedCurrentAdContext = pagePlaybackContext.MediaKey && _normalizeMediaKey(__TTVAB_STATE__.CurrentAdMediaKey) === pagePlaybackContext.MediaKey, seedLastAdEndContext = pagePlaybackContext.MediaKey && _normalizeMediaKey(__TTVAB_STATE__.LastAdEndedMediaKey) === pagePlaybackContext.MediaKey, seedPostAdNativeReloadContext = typeof _getPendingPostAdNativeReloadContext == "function" ? _getPendingPostAdNativeReloadContext(pagePlaybackContext.MediaKey) : null, seedPinnedBackupContext = pagePlaybackContext.MediaKey && _normalizeMediaKey(__TTVAB_STATE__.PinnedBackupPlayerMediaKey) === pagePlaybackContext.MediaKey, seedAdPodProgress = seedCurrentAdContext && pagePlaybackContext.MediaKey && __TTVAB_STATE__.AdPodProgressByMediaKey?.[pagePlaybackContext.MediaKey] ? __TTVAB_STATE__.AdPodProgressByMediaKey[pagePlaybackContext.MediaKey] : null, seedCycleStartedAt = Math.max(0, Number(seedAdPodProgress?.cycleStartedAt) || 0), seedCodecHandoffId = typeof __TTVAB_STATE__.ActiveCodecHandoffId == "string" ? __TTVAB_STATE__.ActiveCodecHandoffId : null, seedCodecHandoffContext = !!(seedCurrentAdContext && pagePlaybackContext.MediaKey && _normalizeMediaKey(__TTVAB_STATE__.ActiveCodecHandoffMediaKey) === pagePlaybackContext.MediaKey && seedCycleStartedAt > 0 && _getCodecHandoffCycleStartedAt(seedCodecHandoffId) === seedCycleStartedAt), seedPlaybackCodecEntries = Array.from(_pageSideVariantCodecByUrl.entries()).filter(([playlistUrl, codec]) => typeof playlistUrl == "string" && playlistUrl && _getVideoCodecFamily(codec)).slice(-40), inlinedWorkerSource = opts?.type !== "module" && workerSourceUrl.startsWith("blob:") ? _readBlobUrlSync(workerSourceUrl) : null;
        if (inlinedWorkerSource?.includes(workerHookSourceMarker)) {
          super(url, opts);
          return;
        }
        const originalWorkerLoadCode = inlinedWorkerSource || (opts?.type === "module" ? `await import(${JSON.stringify(workerSourceUrl)});` : `importScripts(${JSON.stringify(workerSourceUrl)});`), workerSeed = {
          constants: _C,
          sharedState: { ..._S, workers: [], workerRefs: [] },
          playbackCodecEntries: seedPlaybackCodecEntries,
          state: {
            GQLDeviceID: __TTVAB_STATE__.GQLDeviceID,
            AuthorizationHeader: __TTVAB_STATE__.AuthorizationHeader,
            ClientIntegrityHeader: __TTVAB_STATE__.ClientIntegrityHeader,
            ClientVersion: __TTVAB_STATE__.ClientVersion,
            ClientSession: __TTVAB_STATE__.ClientSession,
            PlaybackAccessTokenHash: __TTVAB_STATE__.PlaybackAccessTokenHash,
            LastNativePlaybackAccessTokenPlayerType: __TTVAB_STATE__.LastNativePlaybackAccessTokenPlayerType,
            CurrentAdChannel: seedCurrentAdContext ? __TTVAB_STATE__.CurrentAdChannel : null,
            CurrentAdMediaKey: seedCurrentAdContext ? __TTVAB_STATE__.CurrentAdMediaKey : null,
            AdPodProgressByMediaKey: seedAdPodProgress && pagePlaybackContext.MediaKey ? { [pagePlaybackContext.MediaKey]: seedAdPodProgress } : {},
            LastAdEndedAt: seedLastAdEndContext ? __TTVAB_STATE__.LastAdEndedAt : 0,
            LastAdEndedChannel: seedLastAdEndContext ? __TTVAB_STATE__.LastAdEndedChannel : null,
            LastAdEndedMediaKey: seedLastAdEndContext ? __TTVAB_STATE__.LastAdEndedMediaKey : null,
            LastAdEndedCycleStartedAt: seedLastAdEndContext ? __TTVAB_STATE__.LastAdEndedCycleStartedAt : 0,
            PinnedBackupPlayerType: seedPinnedBackupContext ? __TTVAB_STATE__.PinnedBackupPlayerType : null,
            PinnedBackupPlayerChannel: seedPinnedBackupContext ? __TTVAB_STATE__.PinnedBackupPlayerChannel : null,
            PinnedBackupPlayerMediaKey: seedPinnedBackupContext ? __TTVAB_STATE__.PinnedBackupPlayerMediaKey : null,
            ActiveCodecHandoffId: seedCodecHandoffContext ? __TTVAB_STATE__.ActiveCodecHandoffId : null,
            ActiveCodecHandoffChannel: seedCodecHandoffContext ? __TTVAB_STATE__.ActiveCodecHandoffChannel : null,
            ActiveCodecHandoffMediaKey: seedCodecHandoffContext ? __TTVAB_STATE__.ActiveCodecHandoffMediaKey : null,
            IsAdStrippingEnabled: __TTVAB_STATE__.IsAdStrippingEnabled,
            DisableAdSpoofing: __TTVAB_STATE__.DisableAdSpoofing,
            DisableAutoplayBackup: __TTVAB_STATE__.DisableAutoplayBackup,
            PageMediaType: pagePlaybackContext.MediaType,
            PageChannel: pagePlaybackContext.ChannelName,
            PageVodID: pagePlaybackContext.VodID,
            PageMediaKey: pagePlaybackContext.MediaKey,
            PagePlaybackContextGeneration: Math.max(0, Number(__TTVAB_STATE__.PagePlaybackContextGeneration) || 0),
            AllowPreviewEmergencyAutoplayBackup: __TTVAB_STATE__.AllowPreviewEmergencyAutoplayBackup === !0,
            PagePlaybackVisibleSinceAt: __TTVAB_STATE__.PagePlaybackVisibleSinceAt,
            PreferredQualityGroup: __TTVAB_STATE__.PreferredQualityGroup,
            PlayerHasPlayedOnce: __TTVAB_STATE__.PlayerHasPlayedOnce,
            PlayerIsPlaying: __TTVAB_STATE__.PlayerIsPlaying,
            HasTriggeredPlayerReload: !!seedPostAdNativeReloadContext,
            PendingTriggeredPlayerReloadChannel: seedPostAdNativeReloadContext?.channelName || null,
            PendingTriggeredPlayerReloadMediaKey: seedPostAdNativeReloadContext?.mediaKey || null,
            PendingTriggeredPlayerReloadAt: Math.max(0, Number(seedPostAdNativeReloadContext?.reloadAt) || 0),
            PendingTriggeredPlayerReloadCycleStartedAt: Math.max(0, Number(seedPostAdNativeReloadContext?.cycleStartedAt) || 0)
          }
        }, injectedCode = `
					${JSON.stringify(workerHookSourceMarker)};
					(function(_TTVAB_WORKER_SEED) {
						${_PLAYBACK_WORKER_SOURCE}
					})(${JSON.stringify(workerSeed)});
					${originalWorkerLoadCode}
				`, blobUrl = URL.createObjectURL(new Blob([injectedCode], { type: "text/javascript" }));
        _trackedExtensionBlobUrls.add(blobUrl);
        try {
          super(blobUrl, opts);
        } catch (error) {
          try {
            URL.revokeObjectURL(blobUrl);
          } catch {
          }
          throw _trackedExtensionBlobUrls.delete(blobUrl), error;
        }
        setTimeout(() => URL.revokeObjectURL(blobUrl), 3e4), this.__TTVABFetchControllers = /* @__PURE__ */ new Map(), _scheduleWorkerInitialHeartbeat(this, pagePlaybackContext), this.addEventListener("message", (e) => {
          _getWorkerEvent(e.data)?.key === "Pong" && _markWorkerPong(this);
        });
        try {
          _postWorkerBridgeMessage(this, { key: "Ping", value: null });
        } catch {
        }
        const getCurrentPageContext = () => _getPlaybackContextFromUrl(window.location.href), normalizeMessagePlaybackContext = (message) => _normalizePlaybackContext({
          MediaKey: message?.mediaKey || message?.pageMediaKey || null,
          ChannelName: message?.channel || message?.pageChannel || null,
          VodID: message?.vodID || null
        }), isPlaybackContextMismatch = (expectedContext, currentContext) => {
          const normalizedExpectedContext = _normalizePlaybackContext(expectedContext), normalizedCurrentContext = _normalizePlaybackContext(currentContext);
          return normalizedExpectedContext.MediaKey ? normalizedCurrentContext.MediaKey !== normalizedExpectedContext.MediaKey : normalizedExpectedContext.ChannelName ? normalizedCurrentContext.ChannelName !== normalizedExpectedContext.ChannelName : !1;
        }, isStalePageContextEvent = (message) => {
          if (message.pageContextGeneration === void 0)
            return !1;
          const pipContext = _getActivePictureInPictureWorkerContext(this, normalizeMessagePlaybackContext(message).MediaKey), pageMediaKey = _normalizeMediaKey(message.pageMediaKey);
          return pipContext?.pageContextGeneration === message.pageContextGeneration && pipContext?.pageMediaKey === pageMediaKey ? !1 : message.pageContextGeneration !== Math.max(0, Number(__TTVAB_STATE__.PagePlaybackContextGeneration) || 0) || pageMediaKey !== getCurrentPageContext().MediaKey || pageMediaKey !== _normalizeMediaKey(__TTVAB_STATE__.PageMediaKey);
        }, isStalePlaybackEvent = (message) => {
          if (isStalePageContextEvent(message))
            return !0;
          const messageContext = normalizeMessagePlaybackContext(message);
          return messageContext.MediaKey && _getActivePictureInPictureWorkerContext(this, messageContext.MediaKey) ? !1 : isPlaybackContextMismatch(messageContext, getCurrentPageContext());
        }, handleWorkerFetchRequest = async (fetchRequest) => {
          const rawFetch = window.__TTVAB_REAL_FETCH__ || window.fetch, requestId = fetchRequest?.id || null, controller = new AbortController();
          requestId && (this.__TTVABFetchControllers.get(requestId)?.abort?.(), this.__TTVABFetchControllers.set(requestId, controller));
          const timeoutId = setTimeout(() => controller.abort(), 1e4);
          let responseData = null;
          try {
            const response = await rawFetch(fetchRequest?.url, {
              ...fetchRequest?.options || {},
              signal: controller.signal
            }), body = await response.text();
            if (controller.signal.aborted)
              throw new Error("fetch relay timeout");
            responseData = {
              id: requestId,
              status: response.status,
              statusText: response.statusText,
              ok: response.ok,
              redirected: response.redirected,
              type: response.type,
              url: response.url,
              headers: Object.fromEntries(response.headers.entries()),
              body
            };
          } catch (error) {
            responseData = {
              id: requestId,
              error: error?.name === "AbortError" ? "fetch relay timeout" : error?.message || String(error)
            };
          } finally {
            clearTimeout(timeoutId);
          }
          return requestId && this.__TTVABFetchControllers.get(requestId) !== controller ? null : (requestId && this.__TTVABFetchControllers.delete(requestId), this.__TTVABIntentionallyTerminated ? null : responseData);
        };
        this.addEventListener("message", (e) => {
          const data = _getWorkerEvent(e.data);
          if (data) {
            if (e.stopImmediatePropagation?.(), data.key === "CancelFetchRequest") {
              const requestValue = data.value, requestId = typeof requestValue?.id == "string" ? requestValue.id : null, controller = requestId ? this.__TTVABFetchControllers.get(requestId) : null;
              requestId && this.__TTVABFetchControllers.delete(requestId), controller?.abort?.();
              return;
            }
            if (!(this.__TTVABIntentionallyTerminated && !this.__TTVABCrashed) && !_isWorkerGenerationRetired(this, pagePlaybackContext) && !(this.__TTVABCrashed && !_canHandleCrashedWorkerMessage(data, this, pagePlaybackContext, getCurrentPageContext())) && !isStalePageContextEvent(data)) {
              if (__TTVAB_STATE__.IsAdStrippingEnabled !== !0) {
                if (data.key === "AdEnded" || data.key === "NativePlaybackRestored") {
                  _clearAdPodProgress(data.mediaKey), typeof _clearPlaybackRecoveryTimeoutsForContext == "function" && _clearPlaybackRecoveryTimeoutsForContext(data.mediaKey), typeof _clearAdResumeIntent == "function" && _clearAdResumeIntent(), typeof _clearSuppressedMediaTracking == "function" && _clearSuppressedMediaTracking({ restoreConnected: !0 });
                  return;
                }
                if (data.key === "MediaBootstrapRecoveryNeeded" || data.key === "AdDetected" || data.key === "AdPodProgress" || data.key === "BackupPlayerTypeSelected" || data.key === "FatalMediaRecoveryReady" || data.key === "PostAdNativeReloadReady" || data.key === "PauseResumePlayer" || data.key === "ReloadPlayer")
                  return;
              }
              switch (data.key) {
                case "MediaBootstrapRecoveryNeeded":
                  _handleMediaBootstrapRecoveryRequest(this, data, pagePlaybackContext, getCurrentPageContext());
                  break;
                case "PlaybackWorkerObserved": {
                  const observedContext = _normalizePlaybackContext({
                    MediaType: data.mediaType,
                    ChannelName: data.channel,
                    VodID: data.vodID,
                    MediaKey: data.mediaKey
                  }), workerContext = _getWorkerPlaybackContext(this, pagePlaybackContext), observationMatchesWorkerContext = !!(observedContext.MediaKey && !_isPlaybackContextMismatch(workerContext, observedContext)), observationMatchesActivePip = !!(observedContext.MediaKey && typeof _isActivePictureInPicturePlaybackContext == "function" && _isActivePictureInPicturePlaybackContext(observedContext)), observedPageContext = !observationMatchesWorkerContext && !observationMatchesActivePip ? _getWorkerObservedPageContext(this, data, observedContext, workerContext) : null;
                  if (!observationMatchesWorkerContext && !observationMatchesActivePip && !observedPageContext)
                    break;
                  (observedPageContext || observationMatchesWorkerContext) && (this.__TTVABPlaybackPageContext = observedPageContext), _promoteTrackedWorker(this), _rememberPageSidePlaybackOwner(observedContext.MediaKey, data.playlistUrl, data.codec, 0, {
                    confirmedPlayback: !0,
                    workerGeneration: this.__TTVABGeneration,
                    handoffId: data.handoffId,
                    decoderCodec: data.decoderCodec
                  });
                  const currentPageContext = getCurrentPageContext();
                  for (_isPlaybackContextMismatch(observedContext, currentPageContext), this.__TTVABPlaybackObservedAtByMediaKey instanceof Map || (this.__TTVABPlaybackObservedAtByMediaKey = /* @__PURE__ */ new Map()), this.__TTVABPlaybackObservedAtByMediaKey.delete(observedContext.MediaKey), this.__TTVABPlaybackObservedAtByMediaKey.set(observedContext.MediaKey, Date.now()); this.__TTVABPlaybackObservedAtByMediaKey.size > 8; ) {
                    const oldestMediaKey = this.__TTVABPlaybackObservedAtByMediaKey.keys().next().value;
                    if (oldestMediaKey === void 0)
                      break;
                    this.__TTVABPlaybackObservedAtByMediaKey.delete(oldestMediaKey);
                  }
                  (observationMatchesWorkerContext || !workerContext.MediaKey) && _rememberWorkerPageContext(this, observedContext), _promoteWorkerPlaybackOwner(this, Date.now(), observedContext), _beginExhaustedWorkerRecoveryStabilization(this, observedContext), observedPageContext && (_promoteWorkerPlaybackOwner(this, Date.now(), workerContext), _beginExhaustedWorkerRecoveryStabilization(this, workerContext));
                  break;
                }
                case "PostAdNativeReloadReady": {
                  if (isStalePlaybackEvent(data))
                    break;
                  const reloadContext = _normalizePlaybackContext({
                    MediaType: data.mediaType,
                    ChannelName: data.channel,
                    VodID: data.vodID,
                    MediaKey: data.mediaKey
                  }), workerContext = _getWorkerPlaybackContext(this, pagePlaybackContext);
                  if (!reloadContext.MediaKey || _isPlaybackContextMismatch(workerContext, reloadContext) || typeof _confirmPostAdNativeReload != "function")
                    break;
                  _confirmPostAdNativeReload({
                    channel: reloadContext.ChannelName,
                    mediaKey: reloadContext.MediaKey,
                    cycleStartedAt: data.cycleStartedAt,
                    reloadAt: data.reloadAt,
                    confirmedAt: data.confirmedAt
                  });
                  break;
                }
                case "PlaybackWorkerBootstrapObserved": {
                  const observedContext = _normalizePlaybackContext({
                    MediaType: data.mediaType,
                    ChannelName: data.channel,
                    VodID: data.vodID,
                    MediaKey: data.mediaKey
                  }), workerContext = _getWorkerPlaybackContext(this, pagePlaybackContext), observationMatchesWorkerContext = !!(observedContext.MediaKey && !_isPlaybackContextMismatch(workerContext, observedContext)), observedPageContext = observationMatchesWorkerContext ? null : _getWorkerObservedPageContext(this, data, observedContext, workerContext);
                  if (!observationMatchesWorkerContext && !observedPageContext)
                    break;
                  for (this.__TTVABPlaybackBootstrapObservedAtByMediaKey instanceof Map || (this.__TTVABPlaybackBootstrapObservedAtByMediaKey = /* @__PURE__ */ new Map()), this.__TTVABPlaybackBootstrapObservedAtByMediaKey.delete(observedContext.MediaKey), this.__TTVABPlaybackBootstrapObservedAtByMediaKey.set(observedContext.MediaKey, Date.now()); this.__TTVABPlaybackBootstrapObservedAtByMediaKey.size > 8; ) {
                    const oldestMediaKey = this.__TTVABPlaybackBootstrapObservedAtByMediaKey.keys().next().value;
                    if (oldestMediaKey === void 0)
                      break;
                    this.__TTVABPlaybackBootstrapObservedAtByMediaKey.delete(oldestMediaKey);
                  }
                  this.__TTVABPlaybackPageContext = observedPageContext, observationMatchesWorkerContext && _rememberWorkerPageContext(this, observedContext);
                  break;
                }
                case "FetchRequest":
                  handleWorkerFetchRequest(data.value).then((responseData) => {
                    if (!(!responseData || this.__TTVABIntentionallyTerminated))
                      try {
                        _postWorkerBridgeMessage(this, {
                          key: "FetchResponse",
                          value: responseData
                        });
                      } catch {
                      }
                  });
                  break;
                case "AdDetected":
                  if (isStalePlaybackEvent(data))
                    break;
                  {
                    const now = Date.now(), sourceWorkerGeneration = Math.max(0, Number(this.__TTVABGeneration) || 0), isContinuation = data.continued === !0, detectedContext = _normalizePlaybackContext({
                      MediaType: __TTVAB_STATE__.PageMediaType,
                      ChannelName: data.channel || __TTVAB_STATE__.CurrentAdChannel || null,
                      VodID: __TTVAB_STATE__.PageVodID,
                      MediaKey: data.mediaKey || __TTVAB_STATE__.CurrentAdMediaKey || __TTVAB_STATE__.PageMediaKey
                    }), channel = detectedContext.ChannelName, mediaKey = detectedContext.MediaKey, detectedCycleStartedAt = Math.max(0, Number(data.cycleStartedAt) || 0), activeCycleStartedAt = Math.max(0, Number(__TTVAB_STATE__.AdPodProgressByMediaKey?.[mediaKey]?.cycleStartedAt) || 0), lastEndedCycleStartedAt = _normalizeMediaKey(__TTVAB_STATE__.LastAdEndedMediaKey) === mediaKey ? Math.max(0, Number(__TTVAB_STATE__.LastAdEndedCycleStartedAt) || 0) : 0, lastEndedAt = Math.max(0, Number(__TTVAB_STATE__.LastAdEndedAt) || 0), continuationDetectedAt = Math.max(0, Number(data.detectedAt) || 0), confirmedPlaybackOwnerGeneration = _getConfirmedWorkerPlaybackOwnerGeneration(mediaKey), healthyPlaybackOwner = this.__TTVABCrashed ? _getHealthyObservedPlaybackWorker(detectedContext, this, now, 0, !0) : null, healthyOwnerGeneration = Math.max(0, Number(healthyPlaybackOwner?.__TTVABGeneration) || 0), controlWorkerGeneration = this.__TTVABCrashed && confirmedPlaybackOwnerGeneration > 0 && confirmedPlaybackOwnerGeneration < sourceWorkerGeneration && healthyOwnerGeneration === confirmedPlaybackOwnerGeneration ? confirmedPlaybackOwnerGeneration : sourceWorkerGeneration, endedCycleAge = continuationDetectedAt - lastEndedAt, isRapidSameEndedCycleContinuation = !!(isContinuation && !_normalizeMediaKey(__TTVAB_STATE__.CurrentAdMediaKey) && mediaKey && detectedCycleStartedAt > 0 && lastEndedCycleStartedAt === detectedCycleStartedAt && (activeCycleStartedAt === 0 || activeCycleStartedAt === detectedCycleStartedAt) && lastEndedAt > 0 && continuationDetectedAt <= now && endedCycleAge >= 0 && endedCycleAge <= _getPostAdReentryContinuationMs());
                    if (!mediaKey || detectedCycleStartedAt <= 0 || detectedCycleStartedAt < Math.max(activeCycleStartedAt, lastEndedCycleStartedAt) || !__TTVAB_STATE__.CurrentAdMediaKey && lastEndedCycleStartedAt >= detectedCycleStartedAt && !isRapidSameEndedCycleContinuation || !_claimPageAdCycleControl(mediaKey, detectedCycleStartedAt, controlWorkerGeneration, continuationDetectedAt))
                      break;
                    _rememberPageSidePlaybackOwner(mediaKey, data.playlistUrl, null, detectedCycleStartedAt, {
                      confirmedPlayback: !1,
                      adMarked: !0
                    });
                    const shouldStartNewCycle = !__TTVAB_STATE__.CurrentAdMediaKey || __TTVAB_STATE__.CurrentAdMediaKey !== mediaKey || detectedCycleStartedAt > activeCycleStartedAt || !isContinuation && now - (__TTVAB_STATE__.LastAdDetectedAt || 0) > __TTVAB_STATE__.AdCycleStaleMs, shouldReuseCanonicalCycle = !!(detectedCycleStartedAt > 0 && (activeCycleStartedAt === detectedCycleStartedAt || isRapidSameEndedCycleContinuation));
                    if (shouldStartNewCycle)
                      shouldReuseCanonicalCycle || (_clearAdPodProgress(mediaKey, detectedCycleStartedAt), _mergeAdPodProgress({
                        mediaType: detectedContext.MediaType,
                        channelName: channel,
                        vodID: detectedContext.VodID,
                        mediaKey,
                        adIds: [],
                        expectedPodLength: 0,
                        cycleStartedAt: detectedCycleStartedAt || now
                      }), _broadcastWorkers({
                        key: "ClearAdPodProgress",
                        targetMediaKey: mediaKey,
                        value: {
                          mediaKey,
                          beforeCycleStartedAt: detectedCycleStartedAt
                        }
                      })), typeof _clearPlaybackRecoveryTimeoutsForContext == "function" && _clearPlaybackRecoveryTimeoutsForContext(mediaKey), __TTVAB_STATE__.LastAdRecoveryReloadAt = 0, __TTVAB_STATE__.LastAdRecoveryResumeAt = 0, typeof _rememberPlayerPlaybackForAd == "function" && _rememberPlayerPlaybackForAd(channel, mediaKey);
                    else if (isContinuation && typeof _rememberPlayerPlaybackForAd == "function") {
                      const cooldownMs = __TTVAB_STATE__?.AdRecoveryReloadCooldownMs || 1e4, lastReload = Math.max(0, Number(__TTVAB_STATE__?.LastAdRecoveryReloadAt) || 0);
                      (lastReload <= 0 || now - lastReload >= cooldownMs) && _rememberPlayerPlaybackForAd(channel, mediaKey);
                    }
                    mediaKey && !__TTVAB_STATE__.AdPodProgressByMediaKey?.[mediaKey] && _mergeAdPodProgress({
                      mediaType: detectedContext.MediaType,
                      channelName: channel,
                      vodID: detectedContext.VodID,
                      mediaKey,
                      adIds: [],
                      expectedPodLength: 0,
                      cycleStartedAt: detectedCycleStartedAt || now
                    }), __TTVAB_STATE__.CurrentAdChannel = channel, __TTVAB_STATE__.CurrentAdMediaKey = mediaKey, __TTVAB_STATE__.LastAdDetectedAt = now, _broadcastWorkers({
                      key: "UpdateCurrentAdContext",
                      targetMediaKey: __TTVAB_STATE__.CurrentAdMediaKey,
                      value: {
                        channelName: __TTVAB_STATE__.CurrentAdChannel,
                        mediaKey: __TTVAB_STATE__.CurrentAdMediaKey
                      }
                    });
                    const canonicalPodProgress = mediaKey && __TTVAB_STATE__.AdPodProgressByMediaKey?.[mediaKey];
                    canonicalPodProgress && _broadcastWorkers({
                      key: "UpdateAdPodProgress",
                      targetMediaKey: mediaKey,
                      value: {
                        mediaType: detectedContext.MediaType,
                        channelName: channel,
                        vodID: detectedContext.VodID,
                        mediaKey,
                        ...canonicalPodProgress
                      }
                    });
                  }
                  typeof _ensurePlaybackMonitorsRunning == "function" && _ensurePlaybackMonitorsRunning(!0);
                  break;
                case "AdPodProgress": {
                  if (isStalePlaybackEvent(data))
                    break;
                  const progress = _mergeAdPodProgress({
                    mediaType: __TTVAB_STATE__.PageMediaType,
                    channelName: data.channel || null,
                    vodID: __TTVAB_STATE__.PageVodID,
                    mediaKey: data.mediaKey || null,
                    adIds: data.adIds,
                    expectedPodLength: data.expectedPodLength,
                    maxAdPodPosition: data.maxAdPodPosition,
                    observedZeroAdPodPosition: data.observedZeroAdPodPosition,
                    cycleStartedAt: data.cycleStartedAt
                  });
                  if (!progress || !data.mediaKey)
                    break;
                  _broadcastWorkers({
                    key: "UpdateAdPodProgress",
                    targetMediaKey: data.mediaKey,
                    value: {
                      mediaType: __TTVAB_STATE__.PageMediaType,
                      channelName: data.channel || null,
                      vodID: __TTVAB_STATE__.PageVodID,
                      mediaKey: data.mediaKey,
                      ...progress
                    }
                  });
                  break;
                }
                case "BackupPlayerTypeSelected": {
                  if (data.value != null && typeof data.value != "string")
                    break;
                  const selectedMediaKey = _normalizeMediaKey(data.mediaKey), selectedCycleStartedAt = Math.max(0, Number(data.cycleStartedAt) || 0);
                  if (isStalePlaybackEvent(data) || !selectedMediaKey || !_isCodecHandoffCycleCurrent(selectedMediaKey, selectedCycleStartedAt))
                    break;
                  const nextPinnedType = typeof data.value == "string" && data.value || null, nextPinnedContext = _normalizePlaybackContext({
                    MediaType: __TTVAB_STATE__.PageMediaType,
                    ChannelName: data.channel || __TTVAB_STATE__.CurrentAdChannel || null,
                    VodID: __TTVAB_STATE__.PageVodID,
                    MediaKey: selectedMediaKey
                  });
                  if (__TTVAB_STATE__.PinnedBackupPlayerType === nextPinnedType && __TTVAB_STATE__.PinnedBackupPlayerChannel === nextPinnedContext.ChannelName && __TTVAB_STATE__.PinnedBackupPlayerMediaKey === nextPinnedContext.MediaKey)
                    break;
                  nextPinnedType && (__TTVAB_STATE__.PinnedBackupPlayerType = nextPinnedType), __TTVAB_STATE__.PinnedBackupPlayerChannel = nextPinnedContext.ChannelName, __TTVAB_STATE__.PinnedBackupPlayerMediaKey = nextPinnedContext.MediaKey, typeof _suppressPauseIntent == "function" && _suppressPauseIntent(nextPinnedContext.ChannelName, nextPinnedContext.MediaKey, 3e3), typeof _suppressCompetingMediaDuringAd == "function" && typeof _schedulePlaybackRecoveryTimeout == "function" && (_suppressCompetingMediaDuringAd(nextPinnedContext.ChannelName, nextPinnedContext.MediaKey), _schedulePlaybackRecoveryTimeout(() => _suppressCompetingMediaDuringAd(nextPinnedContext.ChannelName, nextPinnedContext.MediaKey), 120, nextPinnedContext.ChannelName, nextPinnedContext.MediaKey, selectedCycleStartedAt)), typeof _resumeActivePlayerIfPaused == "function" && typeof _schedulePlaybackRecoveryTimeout == "function" && (_schedulePlaybackRecoveryTimeout(() => _resumeActivePlayerIfPaused(nextPinnedContext.ChannelName, nextPinnedContext.MediaKey), 180, nextPinnedContext.ChannelName, nextPinnedContext.MediaKey, selectedCycleStartedAt), _schedulePlaybackRecoveryTimeout(() => _resumeActivePlayerIfPaused(nextPinnedContext.ChannelName, nextPinnedContext.MediaKey), 650, nextPinnedContext.ChannelName, nextPinnedContext.MediaKey, selectedCycleStartedAt)), _broadcastWorkers({
                    key: "UpdatePinnedBackupPlayerContext",
                    targetMediaKey: nextPinnedContext.MediaKey,
                    value: {
                      type: __TTVAB_STATE__.PinnedBackupPlayerType,
                      channelName: __TTVAB_STATE__.PinnedBackupPlayerChannel,
                      mediaKey: __TTVAB_STATE__.PinnedBackupPlayerMediaKey,
                      cycleStartedAt: selectedCycleStartedAt
                    }
                  });
                  break;
                }
                case "FatalMediaRecoveryReady":
                  if (isStalePlaybackEvent(data))
                    break;
                  typeof _acceptFatalAdMediaRecoveryReady == "function" && _acceptFatalAdMediaRecoveryReady(data);
                  break;
                case "AdEnded":
                  if (isStalePlaybackEvent(data))
                    break;
                  {
                    const channel = data.channel || __TTVAB_STATE__.CurrentAdChannel || null, mediaKey = data.mediaKey || __TTVAB_STATE__.CurrentAdMediaKey || null, sourceWorkerGeneration = Math.max(0, Number(this.__TTVABGeneration) || 0), reportedEndedAt = Math.max(0, Number(data.endedAt) || 0), endedAt = reportedEndedAt || Date.now(), endedContext = _normalizePlaybackContext({
                      MediaType: __TTVAB_STATE__.PageMediaType,
                      ChannelName: channel,
                      VodID: __TTVAB_STATE__.PageVodID,
                      MediaKey: mediaKey
                    }), endedCodecHandoffId = typeof data.handoffId == "string" && data.handoffId ? data.handoffId : null, endedCycleStartedAt = Math.max(0, Number(data.cycleStartedAt) || 0), isHoldingBackup = data.holdingBackup === !0;
                    if (!mediaKey || !_isCodecHandoffCycleCurrent(mediaKey, endedCycleStartedAt) || !_isPageAdCycleControlEventCurrent(mediaKey, endedCycleStartedAt, sourceWorkerGeneration, reportedEndedAt, this))
                      break;
                    if (endedCodecHandoffId && __TTVAB_STATE__.ActiveCodecHandoffId && __TTVAB_STATE__.ActiveCodecHandoffId !== endedCodecHandoffId) {
                      _broadcastWorkers({
                        key: "UpdateCodecHandoffContext",
                        targetMediaKey: mediaKey,
                        value: {
                          clearHandoffId: endedCodecHandoffId,
                          channelName: endedContext.ChannelName,
                          mediaKey: endedContext.MediaKey
                        }
                      });
                      break;
                    }
                    _claimPageAdCycleControl(mediaKey, endedCycleStartedAt, sourceWorkerGeneration, endedAt, !0, this), __TTVAB_STATE__.LastAdEndedAt = endedAt, __TTVAB_STATE__.LastAdEndedChannel = endedContext.ChannelName, __TTVAB_STATE__.LastAdEndedMediaKey = endedContext.MediaKey, __TTVAB_STATE__.LastAdEndedCycleStartedAt = endedCycleStartedAt, !isHoldingBackup && typeof _hasPendingAdResumeIntent == "function" && !(typeof _hasUserPauseIntent == "function" && _hasUserPauseIntent(channel, mediaKey)) && !(typeof _shouldSuppressAutomaticPlaybackResume == "function" && _shouldSuppressAutomaticPlaybackResume(channel, mediaKey)) && _hasPendingAdResumeIntent(channel, mediaKey), !isHoldingBackup && _normalizeMediaKey(__TTVAB_STATE__.CurrentAdMediaKey) === mediaKey && (__TTVAB_STATE__.CurrentAdChannel = null, __TTVAB_STATE__.CurrentAdMediaKey = null), !isHoldingBackup && _normalizeMediaKey(__TTVAB_STATE__.PinnedBackupPlayerMediaKey) === mediaKey && (__TTVAB_STATE__.PinnedBackupPlayerType = null, __TTVAB_STATE__.PinnedBackupPlayerChannel = null, __TTVAB_STATE__.PinnedBackupPlayerMediaKey = null), !isHoldingBackup && endedCodecHandoffId && __TTVAB_STATE__.ActiveCodecHandoffId === endedCodecHandoffId && (__TTVAB_STATE__.ActiveCodecHandoffId = null, __TTVAB_STATE__.ActiveCodecHandoffChannel = null, __TTVAB_STATE__.ActiveCodecHandoffMediaKey = null), !isHoldingBackup && typeof _clearPlaybackRecoveryTimeoutsForContext == "function" && _clearPlaybackRecoveryTimeoutsForContext(mediaKey), isHoldingBackup || (_broadcastWorkers({
                      key: "UpdateCurrentAdContext",
                      targetMediaKey: mediaKey,
                      value: null
                    }), _broadcastWorkers({
                      key: "UpdatePinnedBackupPlayerContext",
                      targetMediaKey: mediaKey,
                      value: null
                    }), endedCodecHandoffId && _broadcastWorkers({
                      key: "UpdateCodecHandoffContext",
                      targetMediaKey: mediaKey,
                      value: {
                        clearHandoffId: endedCodecHandoffId,
                        channelName: endedContext.ChannelName,
                        mediaKey: endedContext.MediaKey
                      }
                    })), _broadcastWorkers({
                      key: "UpdateLastAdEndContext",
                      targetMediaKey: mediaKey,
                      value: {
                        mediaType: endedContext.MediaType,
                        channelName: endedContext.ChannelName,
                        vodID: endedContext.VodID,
                        mediaKey: endedContext.MediaKey,
                        endedAt,
                        cycleStartedAt: endedCycleStartedAt
                      }
                    }), !isHoldingBackup && typeof _resetPlayerBufferMonitorState == "function" && _resetPlayerBufferMonitorState(), __TTVAB_STATE__._AdRecoveryConsecutiveFailures = 0, isHoldingBackup || (_clearAdPodProgress(mediaKey), _broadcastWorkers({
                      key: "ClearAdPodProgress",
                      targetMediaKey: mediaKey,
                      value: { mediaKey }
                    })), !isHoldingBackup && typeof _restoreSuppressedMediaAfterAd == "function" && _restoreSuppressedMediaAfterAd(channel, mediaKey), _schedulePostAdArtifactCleanup(channel, mediaKey, endedCycleStartedAt);
                  }
                  break;
                case "NativePlaybackRestored":
                  if (isStalePlaybackEvent(data))
                    break;
                  {
                    const channel = data.channel || __TTVAB_STATE__.LastAdEndedChannel || null, mediaKey = data.mediaKey || __TTVAB_STATE__.LastAdEndedMediaKey || null, sourceWorkerGeneration = Math.max(0, Number(this.__TTVABGeneration) || 0), restoredCycleStartedAt = Math.max(0, Number(data.cycleStartedAt) || 0), reportedRestoredAt = Math.max(0, Number(data.restoredAt) || 0);
                    if (!mediaKey || !_isCodecHandoffCycleCurrent(mediaKey, restoredCycleStartedAt) || !_isPageAdCycleControlEventCurrent(mediaKey, restoredCycleStartedAt, sourceWorkerGeneration, reportedRestoredAt, this))
                      break;
                    reportedRestoredAt > 0 && _claimPageAdCycleControl(mediaKey, restoredCycleStartedAt, sourceWorkerGeneration, reportedRestoredAt, !0, this), typeof _hasPendingAdResumeIntent == "function" && !(typeof _hasUserPauseIntent == "function" && _hasUserPauseIntent(channel, mediaKey)) && !(typeof _shouldSuppressAutomaticPlaybackResume == "function" && _shouldSuppressAutomaticPlaybackResume(channel, mediaKey)) && _hasPendingAdResumeIntent(channel, mediaKey);
                    const requiresTimelineRestoreReload = !!(typeof _consumePinnedBackupTimelineRestore == "function" && _consumePinnedBackupTimelineRestore(mediaKey, restoredCycleStartedAt)), requiresReload = !!(data.requiresReload === !0 || requiresTimelineRestoreReload), restoredHandoffId = _normalizeMediaKey(__TTVAB_STATE__.ActiveCodecHandoffMediaKey) === mediaKey ? __TTVAB_STATE__.ActiveCodecHandoffId : null;
                    _normalizeMediaKey(__TTVAB_STATE__.CurrentAdMediaKey) === mediaKey && (__TTVAB_STATE__.CurrentAdChannel = null, __TTVAB_STATE__.CurrentAdMediaKey = null), _normalizeMediaKey(__TTVAB_STATE__.PinnedBackupPlayerMediaKey) === mediaKey && (__TTVAB_STATE__.PinnedBackupPlayerType = null, __TTVAB_STATE__.PinnedBackupPlayerChannel = null, __TTVAB_STATE__.PinnedBackupPlayerMediaKey = null), restoredHandoffId && (__TTVAB_STATE__.ActiveCodecHandoffId = null, __TTVAB_STATE__.ActiveCodecHandoffChannel = null, __TTVAB_STATE__.ActiveCodecHandoffMediaKey = null), __TTVAB_STATE__.LastAdEndedAt = Math.max(0, reportedRestoredAt || Date.now()), __TTVAB_STATE__.LastAdEndedChannel = channel, __TTVAB_STATE__.LastAdEndedMediaKey = mediaKey, __TTVAB_STATE__.LastAdEndedCycleStartedAt = restoredCycleStartedAt, _broadcastWorkers([
                      {
                        key: "UpdateCurrentAdContext",
                        targetMediaKey: mediaKey,
                        value: null
                      },
                      {
                        key: "UpdatePinnedBackupPlayerContext",
                        targetMediaKey: mediaKey,
                        value: null
                      },
                      ...restoredHandoffId ? [
                        {
                          key: "UpdateCodecHandoffContext",
                          targetMediaKey: mediaKey,
                          value: {
                            clearHandoffId: restoredHandoffId,
                            channelName: channel,
                            mediaKey
                          }
                        }
                      ] : [],
                      {
                        key: "UpdateLastAdEndContext",
                        targetMediaKey: mediaKey,
                        value: {
                          mediaType: __TTVAB_STATE__.PageMediaType,
                          channelName: channel,
                          vodID: __TTVAB_STATE__.PageVodID,
                          mediaKey,
                          endedAt: __TTVAB_STATE__.LastAdEndedAt,
                          cycleStartedAt: restoredCycleStartedAt
                        }
                      },
                      {
                        key: "ClearAdPodProgress",
                        targetMediaKey: mediaKey,
                        value: { mediaKey }
                      }
                    ]), _clearAdPodProgress(mediaKey), typeof _resetFatalAdMediaRecoveryState == "function" && _resetFatalAdMediaRecoveryState(), typeof _restoreSuppressedMediaAfterAd == "function" && _restoreSuppressedMediaAfterAd(channel, mediaKey), _runPostAdPlayerTask(!requiresReload && data.continuePlayback !== !0, requiresReload, {
                      reason: "post-ad-native-restore",
                      ...requiresReload ? {
                        refreshAccessToken: data.refreshAccessToken !== !1,
                        newMediaPlayerInstance: !0
                      } : {},
                      channel,
                      mediaKey,
                      cycleStartedAt: restoredCycleStartedAt
                    }), _schedulePostAdArtifactCleanup(channel, mediaKey, restoredCycleStartedAt);
                  }
                  break;
                case "PauseResumePlayer":
                  if (isStalePlaybackEvent(data) || !_isPageLifecycleCycleCurrent(data.mediaKey, data.cycleStartedAt))
                    break;
                  typeof _doPlayerTask == "function" && _runPostAdPlayerTask(!0, !1, {
                    reason: "ad-recovery",
                    channel: typeof data.channel == "string" ? data.channel : null,
                    mediaKey: typeof data.mediaKey == "string" ? data.mediaKey : null,
                    cycleStartedAt: Math.max(0, Number(data.cycleStartedAt) || 0)
                  });
                  break;
                case "ReloadPlayer": {
                  if (isStalePlaybackEvent(data)) {
                    data.reason === "codec-handoff" && typeof data.handoffId == "string" && data.handoffId && _broadcastWorkers({
                      key: "CodecHandoffReloadFailed",
                      targetMediaKey: typeof data.mediaKey == "string" ? data.mediaKey : null,
                      value: {
                        handoffId: data.handoffId,
                        cycleStartedAt: Math.max(0, Number(data.cycleStartedAt) || 0),
                        channelName: typeof data.channel == "string" ? data.channel : null,
                        mediaKey: typeof data.mediaKey == "string" ? data.mediaKey : null
                      }
                    });
                    break;
                  }
                  const eventIsCodecHandoff = data.reason === "codec-handoff" && typeof data.handoffId == "string" && data.handoffId, eventCycleStartedAt = Math.max(0, Number(data.cycleStartedAt) || 0), eventMediaKey = typeof data.mediaKey == "string" ? data.mediaKey : null;
                  if (eventIsCodecHandoff && (_getCodecHandoffCycleStartedAt(data.handoffId) !== eventCycleStartedAt || !_isCodecHandoffCycleCurrent(eventMediaKey, eventCycleStartedAt))) {
                    _broadcastWorkers({
                      key: "CodecHandoffReloadFailed",
                      targetMediaKey: eventMediaKey,
                      value: {
                        handoffId: data.handoffId,
                        cycleStartedAt: eventCycleStartedAt,
                        channelName: typeof data.channel == "string" ? data.channel : null,
                        mediaKey: eventMediaKey
                      }
                    });
                    break;
                  }
                  if (!eventIsCodecHandoff && !_isPageLifecycleCycleCurrent(eventMediaKey, eventCycleStartedAt))
                    break;
                  if (typeof _clearPlaybackRecoveryTimeoutsForContext == "function" && _clearPlaybackRecoveryTimeoutsForContext(data.mediaKey || null), typeof _doPlayerTask == "function") {
                    const reloadReason = typeof data.reason == "string" && data.reason ? data.reason : "ad-recovery", handoffId = reloadReason === "codec-handoff" && typeof data.handoffId == "string" ? data.handoffId : null, reloadOptions = {
                      reason: reloadReason,
                      handoffId,
                      cycleStartedAt: eventCycleStartedAt,
                      refreshAccessToken: data.refreshAccessToken !== !1,
                      newMediaPlayerInstance: data.newMediaPlayerInstance !== !1,
                      channel: typeof data.channel == "string" ? data.channel : null,
                      mediaKey: typeof data.mediaKey == "string" ? data.mediaKey : null
                    }, rejectCodecHandoff = () => {
                      _broadcastWorkers({
                        key: "CodecHandoffReloadFailed",
                        targetMediaKey: reloadOptions.mediaKey,
                        value: {
                          handoffId,
                          cycleStartedAt: reloadOptions.cycleStartedAt,
                          channelName: reloadOptions.channel,
                          mediaKey: reloadOptions.mediaKey
                        }
                      });
                    };
                    if (reloadReason !== "codec-handoff") {
                      _runPostAdPlayerTask(!1, !0, reloadOptions);
                      break;
                    }
                    const runReload = (attempt = 0) => {
                      if (attempt > 0 && (isStalePlaybackEvent(data) || (reloadReason === "codec-handoff" ? !_isCodecHandoffCycleCurrent(reloadOptions.mediaKey, reloadOptions.cycleStartedAt) : !_isPageLifecycleCycleCurrent(reloadOptions.mediaKey, reloadOptions.cycleStartedAt)))) {
                        rejectCodecHandoff();
                        return;
                      }
                      let didReload = !1;
                      try {
                        didReload = _doPlayerTask(!1, !0, reloadOptions) === !0;
                      } catch {
                      }
                      if (didReload)
                        return;
                      const retryDelays = [50, 180, 500, 1100];
                      if (attempt < retryDelays.length) {
                        setTimeout(() => runReload(attempt + 1), retryDelays[attempt]);
                        return;
                      }
                      rejectCodecHandoff();
                    };
                    runReload();
                  }
                  break;
                }
                default:
                  break;
              }
            }
          }
        });
        const _workerUrl = url, workerOpts = opts;
        this.__TTVABWorkerUrl = _workerUrl, this.__TTVABWorkerOpts = workerOpts, this.addEventListener("error", (e) => {
          _recoverCrashedWorker(this, pagePlaybackContext, `Worker #g${this.__TTVABGeneration} error: ${e.message || "Unknown error"}`, "error");
        }), this.__TTVABCreatedAt = Date.now(), this.__TTVABLastPongAt = Date.now(), this.__TTVABFirstPongAt = 0, this.__TTVABGeneration = ++_workerGeneration, this.__TTVABRestartAttempts = 0, this.__TTVABMissedPongs = 0, this.__TTVABLastPingSentAt = 0, _rememberWorkerPageContext(this, pagePlaybackContext), _S.workers.push(this), pruneTrackedWorkers();
        try {
          _postWorkerBridgeMessage(this, {
            key: "UpdateToggleState",
            value: __TTVAB_STATE__.IsAdStrippingEnabled
          }), _postWorkerBridgeMessage(this, {
            key: "UpdatePlayerHasPlayedOnce",
            value: __TTVAB_STATE__.PlayerHasPlayedOnce
          }), _postWorkerBridgeMessage(this, {
            key: "UpdatePlayerIsPlaying",
            value: __TTVAB_STATE__.PlayerIsPlaying
          }), _postWorkerBridgeMessage(this, {
            key: "UpdatePageContext",
            value: {
              mediaType: __TTVAB_STATE__.PageMediaType,
              channelName: __TTVAB_STATE__.PageChannel,
              vodID: __TTVAB_STATE__.PageVodID,
              mediaKey: __TTVAB_STATE__.PageMediaKey,
              playbackContextGeneration: Math.max(0, Number(__TTVAB_STATE__.PagePlaybackContextGeneration) || 0),
              allowPreviewEmergencyAutoplayBackup: __TTVAB_STATE__.AllowPreviewEmergencyAutoplayBackup === !0
            }
          }), _postWorkerBridgeMessage(this, {
            key: "UpdateCurrentAdContext",
            value: {
              channelName: seedCurrentAdContext ? __TTVAB_STATE__.CurrentAdChannel : null,
              mediaKey: seedCurrentAdContext ? __TTVAB_STATE__.CurrentAdMediaKey : null
            }
          }), _postWorkerBridgeMessage(this, {
            key: "UpdatePinnedBackupPlayerContext",
            value: {
              type: seedPinnedBackupContext ? __TTVAB_STATE__.PinnedBackupPlayerType : null,
              channelName: seedPinnedBackupContext ? __TTVAB_STATE__.PinnedBackupPlayerChannel : null,
              mediaKey: seedPinnedBackupContext ? __TTVAB_STATE__.PinnedBackupPlayerMediaKey : null
            }
          }), seedCodecHandoffContext && _postWorkerBridgeMessage(this, {
            key: "UpdateCodecHandoffContext",
            value: {
              handoffId: __TTVAB_STATE__.ActiveCodecHandoffId,
              channelName: __TTVAB_STATE__.ActiveCodecHandoffChannel,
              mediaKey: __TTVAB_STATE__.ActiveCodecHandoffMediaKey,
              cycleStartedAt: seedCycleStartedAt
            }
          }), seedAdPodProgress && _postWorkerBridgeMessage(this, {
            key: "UpdateAdPodProgress",
            value: {
              mediaType: pagePlaybackContext.MediaType,
              channelName: pagePlaybackContext.ChannelName,
              vodID: pagePlaybackContext.VodID,
              mediaKey: pagePlaybackContext.MediaKey,
              ...seedAdPodProgress
            }
          });
        } catch {
        }
      }
      terminate() {
        this.__TTVABIntentionallyTerminated = !0, _clearWorkerInitialHeartbeat(this);
        try {
          for (const controller of this.__TTVABFetchControllers?.values?.() || [])
            controller?.abort?.();
          this.__TTVABFetchControllers?.clear?.();
          const terminationContext = _getWorkerPlaybackContext(this);
          _reassignPageAdCycleControlAfterWorkerRetirement(terminationContext.MediaKey, this.__TTVABGeneration, this), pruneTrackedWorkers([this]), _scheduleTerminatedPlaybackWorkerRecovery(this, terminationContext);
        } catch {
        }
        return super.terminate();
      }
    };
    return _reinsert(HookedWorker, reinsertNames);
  }, originalWorkerDescriptor = Object.getOwnPropertyDescriptor(window, "Worker");
  let rawWorkerInstance = window.Worker, workerInstance = createHookedWorkerConstructor(rawWorkerInstance);
  Object.defineProperty(window, "Worker", {
    configurable: !0,
    enumerable: originalWorkerDescriptor?.enumerable ?? !1,
    get: () => workerInstance,
    set: (v) => {
      !_isValid(v) || v === workerInstance || v === rawWorkerInstance || (rawWorkerInstance = v, workerInstance = createHookedWorkerConstructor(rawWorkerInstance));
    }
  }), _startWorkerWatchdog();
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
function _getPageVodAdMediaKey() {
  const pageMediaKey = _normalizeMediaKey(__TTVAB_STATE__.PageMediaKey);
  if (_getPlaybackContextFromUrl(window.location.href).MediaKey !== pageMediaKey)
    return null;
  if (typeof _getPlayerAndState == "function")
    try {
      const { player, state } = _getPlayerAndState(), video = player?.getHTMLVideoElement?.(), content = state?.props?.content;
      if (content) {
        const context = _normalizePlaybackContext({
          MediaType: content.type,
          ChannelName: content.channelLogin,
          VodID: content.vodID
        });
        if (context.MediaKey)
          return context.MediaType === "vod" && (video?.isConnected || context.MediaKey === pageMediaKey) ? context.MediaKey : null;
      }
      if ((player || state) && __TTVAB_STATE__.PageMediaType !== "vod")
        return null;
    } catch {
      return null;
    }
  return __TTVAB_STATE__.PageMediaType === "vod" ? pageMediaKey : null;
}
function _hookMainFetch() {
  const realFetch = window.fetch;
  window.__TTVAB_REAL_FETCH__ = realFetch;
  const isGqlEndpointUrl = (urlStr) => {
    if (typeof urlStr == "string" && urlStr.startsWith("https://gql.twitch.tv/"))
      return !0;
    try {
      return new URL(urlStr).hostname === "gql.twitch.tv";
    } catch {
      return !1;
    }
  };
  if (typeof window.XMLHttpRequest == "function") {
    const realXhrOpen = window.XMLHttpRequest.prototype.open, emptyVastResponseUrl = "data:application/xml,%3CVAST%20version%3D%223.0%22%3E%3C%2FVAST%3E";
    window.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      return (String(method || "").trim().toUpperCase() === "GET" ? _getVodAdRequest(url, _getPageVodAdMediaKey) : null) ? realXhrOpen.call(this, method, emptyVastResponseUrl, ...rest) : realXhrOpen.call(this, method, url, ...rest);
    };
  }
  const updateWorkers = (updates) => {
    if (Array.isArray(updates))
      for (const msg of updates)
        _broadcastWorkers(msg);
    else
      _broadcastWorkers(updates);
  }, rewritePlaybackAccessTokenBody = (bodyText) => {
    if (typeof bodyText != "string" || !bodyText)
      return { bodyText, changed: !1 };
    try {
      const forceType = __TTVAB_STATE__.ForceAccessTokenPlayerType || "autoplay";
      if (!forceType || __TTVAB_STATE__.RewriteNativePlaybackAccessToken !== !0)
        return { bodyText, changed: !1 };
      const parsed = JSON.parse(bodyText), operations = Array.isArray(parsed) ? parsed : [parsed];
      let changed = !1, previousPlayerType = null;
      for (const op of operations)
        if (op?.operationName === "PlaybackAccessToken" && !(!op.variables || typeof op.variables != "object") && typeof op.variables.playerType == "string") {
          op.variables.playerType !== forceType && (previousPlayerType = previousPlayerType || op.variables.playerType, op.variables.playerType = forceType, changed = !0);
          const expectedPlatform = forceType === "autoplay" ? "android" : "web";
          op.variables.platform !== expectedPlatform && (op.variables.platform = expectedPlatform, changed = !0);
        }
      if (changed)
        return {
          bodyText: JSON.stringify(parsed),
          changed: !0
        };
    } catch {
    }
    return { bodyText, changed: !1 };
  }, isPictureInPicturePlaybackAccessTokenBody = (bodyText) => {
    if (typeof bodyText != "string" || !bodyText || !bodyText.includes("PlaybackAccessToken"))
      return !1;
    try {
      const parsed = JSON.parse(bodyText);
      return (Array.isArray(parsed) ? parsed : [parsed]).some((op) => {
        if (op?.operationName !== "PlaybackAccessToken")
          return !1;
        const playerType = op?.variables?.playerType;
        return typeof playerType == "string" && playerType.toLowerCase().includes("picture-by-picture");
      });
    } catch {
      return bodyText.toLowerCase().includes("picture-by-picture");
    }
  }, updatePlaybackAccessTokenHash = (hash) => {
    !hash || __TTVAB_STATE__.PlaybackAccessTokenHash === hash || (__TTVAB_STATE__.PlaybackAccessTokenHash = hash, updateWorkers([{ key: "UpdateGQLHash", value: hash }]));
  }, updateNativePlaybackAccessTokenPlayerType = (playerType) => {
    !playerType || __TTVAB_STATE__.LastNativePlaybackAccessTokenPlayerType === playerType || (__TTVAB_STATE__.LastNativePlaybackAccessTokenPlayerType = playerType, updateWorkers([
      {
        key: "UpdateLastNativePlaybackAccessTokenPlayerType",
        value: playerType
      }
    ]));
  }, processGqlBody = (bodyText) => {
    if (typeof bodyText != "string" || !bodyText)
      return "unknown";
    try {
      const data = JSON.parse(bodyText), operations = Array.isArray(data) ? data : [data];
      let hasPlaybackAccessToken = !1, hasOnlyKnownOperations = operations.length > 0;
      for (const op of operations) {
        const operationName = op?.operationName;
        if (typeof operationName != "string" || !operationName) {
          hasOnlyKnownOperations = !1;
          continue;
        }
        operationName === "PlaybackAccessToken" && (hasPlaybackAccessToken = !0, op.extensions?.persistedQuery?.sha256Hash && updatePlaybackAccessTokenHash(op.extensions.persistedQuery.sha256Hash));
      }
      if (hasPlaybackAccessToken)
        return "playback";
      if (hasOnlyKnownOperations)
        return "unrelated";
    } catch {
    }
    return "unknown";
  }, processGqlResponse = async (response) => {
    if (response?.status === 200)
      try {
        const payload = await response.clone().json(), operations = Array.isArray(payload) ? payload : [payload];
        for (const op of operations) {
          const tokenValue = _extractPlaybackAccessToken(op)?.value || null;
          if (!(typeof tokenValue != "string" || !tokenValue))
            try {
              const tokenPayload = JSON.parse(tokenValue), effectivePlayerType = tokenPayload?.playerType || tokenPayload?.player_type || null;
              typeof effectivePlayerType == "string" && updateNativePlaybackAccessTokenPlayerType(effectivePlayerType);
            } catch {
            }
        }
      } catch {
      }
  };
  window.fetch = async function(...args) {
    const [url, opts] = args;
    if (url) {
      const urlStr = url instanceof Request ? url.url : url.toString();
      let blockedVodAdRequest = null;
      if (__TTVAB_STATE__.IsAdStrippingEnabled === !0 && (typeof opts?.method == "string" && opts.method ? opts.method : url instanceof Request ? url.method : "GET").trim().toUpperCase() === "GET" && (blockedVodAdRequest = _getVodAdRequest(urlStr, _getPageVodAdMediaKey)), blockedVodAdRequest) {
        const signal = opts?.signal !== void 0 ? opts.signal : url instanceof Request ? url.signal : null;
        if (signal?.aborted)
          throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
        return new Response(null, {
          status: 204,
          statusText: "No Content"
        });
      }
      if (isGqlEndpointUrl(urlStr)) {
        _syncStoredDeviceId();
        let nextArgs = args, headers = opts?.headers, shouldSkipPlaybackAccessTokenState = !1, shouldInspectPlaybackAccessTokenResponse = !0;
        if (url instanceof Request) {
          let effectiveRequest = url;
          try {
            opts && Object.keys(opts).length > 0 && (effectiveRequest = new Request(url, opts)), headers = effectiveRequest.headers;
            const text = await effectiveRequest.clone().text();
            if (shouldSkipPlaybackAccessTokenState = isPictureInPicturePlaybackAccessTokenBody(text), shouldSkipPlaybackAccessTokenState)
              shouldInspectPlaybackAccessTokenResponse = !1, (effectiveRequest !== url || args.length !== 1) && (nextArgs = [effectiveRequest]);
            else {
              const rewritten = rewritePlaybackAccessTokenBody(text);
              shouldInspectPlaybackAccessTokenResponse = processGqlBody(rewritten.bodyText) !== "unrelated", rewritten.changed ? nextArgs = [
                new Request(effectiveRequest, {
                  body: rewritten.bodyText
                })
              ] : (effectiveRequest !== url || args.length !== 1) && (nextArgs = [effectiveRequest]);
            }
          } catch {
          }
        } else if (typeof opts?.body == "string")
          if (shouldSkipPlaybackAccessTokenState = isPictureInPicturePlaybackAccessTokenBody(opts.body), shouldSkipPlaybackAccessTokenState)
            shouldInspectPlaybackAccessTokenResponse = !1;
          else {
            const rewritten = rewritePlaybackAccessTokenBody(opts.body);
            shouldInspectPlaybackAccessTokenResponse = processGqlBody(rewritten.bodyText) !== "unrelated", rewritten.changed && (nextArgs = [url, { ...opts || {}, body: rewritten.bodyText }]);
          }
        if (headers) {
          const getHeader = (key) => {
            if (headers instanceof Headers)
              return headers.get(key) || headers.get(key.toLowerCase());
            if (Array.isArray(headers)) {
              const target = key.toLowerCase();
              return headers.find((header) => Array.isArray(header) && String(header[0] || "").toLowerCase() === target)?.[1];
            }
            return headers[key] || headers[key.toLowerCase()];
          }, updates = [], integrity = getHeader("Client-Integrity"), auth = getHeader("Authorization"), version = getHeader("Client-Version"), session = getHeader("Client-Session-Id"), device = getHeader("X-Device-Id");
          integrity && __TTVAB_STATE__.ClientIntegrityHeader !== integrity && (__TTVAB_STATE__.ClientIntegrityHeader = integrity, updates.push({
            key: "UpdateClientIntegrityHeader",
            value: __TTVAB_STATE__.ClientIntegrityHeader
          })), auth && __TTVAB_STATE__.AuthorizationHeader !== auth && (__TTVAB_STATE__.AuthorizationHeader = auth, updates.push({
            key: "UpdateAuthorizationHeader",
            value: __TTVAB_STATE__.AuthorizationHeader
          })), version && __TTVAB_STATE__.ClientVersion !== version && (__TTVAB_STATE__.ClientVersion = version, updates.push({
            key: "UpdateClientVersion",
            value: __TTVAB_STATE__.ClientVersion
          })), session && __TTVAB_STATE__.ClientSession !== session && (__TTVAB_STATE__.ClientSession = session, updates.push({
            key: "UpdateClientSession",
            value: __TTVAB_STATE__.ClientSession
          })), device && __TTVAB_STATE__.GQLDeviceID !== device && (__TTVAB_STATE__.GQLDeviceID = device, updates.push({
            key: "UpdateDeviceId",
            value: __TTVAB_STATE__.GQLDeviceID
          })), updateWorkers(updates);
        }
        const response = await realFetch.apply(this, nextArgs);
        return shouldInspectPlaybackAccessTokenResponse && processGqlResponse(response), response;
      }
    }
    return realFetch.apply(this, args);
  };
}
const _PlayerBufferState = {
    cleanPlayback: null,
    videoRef: null,
    currentTime: -1,
    totalVideoFrames: -1,
    bufferedPosition: 0,
    bufferDuration: 0,
    numSame: 0,
    lastFixTime: 0,
    fixAttempts: 0,
    liveEdgeStarveCount: 0,
    gapJumpLastPosition: -1,
    gapJumpStuckTicks: 0,
    postAdUnhealthyCount: 0,
    postAdRecoveryStartedAt: 0,
    postAdLastCurrentTime: 0,
    postAdStallTicks: 0,
    postAdSoftReloadAttempted: !1,
    postAdGraceUntil: 0,
    postAdGraceLastCurrentTime: 0,
    postAdGraceStallTicks: 0,
    postAdGracePauseResumeAt: 0,
    postAdGraceReloadAttempted: !1
};
let _cachedPlayerRef = null;
let _cachedPlayerRefMediaKey = null;
let _cachedReactRootNode = null;
let _cachedReactContainerKey = null;
const _AdAudioSuppressionState = {
    suppressedMedia: /* @__PURE__ */ new Map(),
    detachedMediaStates: /* @__PURE__ */ new WeakMap(),
    activeMediaKey: null,
    lastSuppressedCount: 0
};
const _PlaybackIntentState = {
    observedMedia: null,
    observedMediaKey: null,
    observedPageGeneration: 0,
    pauseListener: null,
    playListener: null,
    userPausedMediaKey: null,
    userPausedAt: 0,
    userPausedHadExplicitInteraction: !1,
    userPausedDuringAd: !1,
    lastProgrammaticPauseAt: 0,
    lastProgrammaticPlayAt: 0,
    suppressedPauseMediaKey: null,
    suppressedPauseUntil: 0,
    lastPlaybackControlInteractionAt: 0,
    lastPlaybackControlInteractionMediaKey: null,
    interactionMonitorInitialized: !1,
    secondaryPlayerLaunchMonitorInitialized: !1,
    secondaryPlayerHandoffKind: null,
    secondaryPlayerHandoffChannel: null,
    secondaryPlayerHandoffMediaKey: null,
    secondaryPlayerHandoffUntil: 0,
    secondaryPlayerHandoffSourceWasPlaying: !1,
    secondaryPlayerWindows: /* @__PURE__ */ new Map(),
    secondaryPlayerCloseMonitorId: null,
    pictureInPictureElement: null,
    pictureInPictureMediaType: null,
    pictureInPictureChannel: null,
    pictureInPictureVodID: null,
    pictureInPictureMediaKey: null,
    pictureInPictureWorkerRef: null,
    pictureInPicturePageMediaKey: null,
    pictureInPicturePageContextGeneration: 0,
    pictureInPictureVisibleSinceAt: 0,
    pictureInPictureVisibilityMediaKey: null,
    pagePlaybackVisibilityMediaKey: null,
    pictureInPicturePauseListener: null,
    pictureInPicturePlayListener: null
};
let _playbackIntentMonitorStarted = !1;
let _playerBufferMonitorStarted = !1;
let _playbackIntentMonitorTimer = null;
let _playerBufferMonitorTimer = null;
const _PlaybackRecoveryTimeoutState = {
    timeouts: /* @__PURE__ */ new Set()
};
const _PlayerPreferenceRestoreState = {
    timeoutId: null,
    channel: null,
    mediaKey: null,
    cycleStartedAt: 0
};
const _PlayerPreferenceStorageState = {
    initialized: !1,
    versions: /* @__PURE__ */ new Map()
};
const _PLAYBACK_INTENT_MONITOR_DELAY_MS = 500;
const _PLAYBACK_INTENT_IDLE_SYNC_DELAY_MS = 1500;
const _PLAYBACK_INTENT_NO_MEDIA_ROUTE_DELAY_MS = 3e3;
const _USER_PAUSE_INTERACTION_WINDOW_MS = 1200;
const _AD_RESUME_INTENT_WINDOW_MS = 15e3;
const _AD_TRANSIENT_PAUSE_CLEAR_WINDOW_MS = 1750;
const _PLAYER_BUFFER_LIVE_EDGE_EPSILON = 0.35;
const _PLAYER_BUFFER_LIVE_EDGE_RELOAD_COUNT = 12;
const _PLAYER_BUFFER_STEADY_DELAY_MS = 900;
const _POST_AD_UNHEALTHY_RELOAD_COUNT = 3;
const _POST_AD_RECOVERY_RELOAD_COOLDOWN_MS = 1800;
const _POST_AD_SOFT_RELOAD_DELAY_MS = 1e4;
const _POST_AD_PAUSE_RESUME_RETRY_MS = 2500;
const _POST_AD_GRACE_WINDOW_MS = 9e4;
const _POST_AD_GRACE_STALL_TICKS_REQUIRED = 2;
const _POST_AD_GRACE_PAUSE_RESUME_COOLDOWN_MS = 1500;
const _POST_AD_RECOVERY_MAX_RELOAD_REQUESTS = 4;
const _POST_AD_RECOVERY_MAX_ACCEPTED_RELOADS = 2;
const _POST_AD_RECOVERY_TRANSACTION_TIMEOUT_MS = 3e4;
const _POST_AD_RECOVERY_TERMINAL_SETTLE_MS = 1e4;
const _IN_AD_FREEZE_DETECT_MS = 5e3;
const _IN_AD_FREEZE_ACTION_REPEAT_MS = 5e3;
const _IN_AD_FREEZE_RELOAD_AFTER_ATTEMPTS = 2;
const _VISIBILITY_RESUME_RETRY_DELAYS_MS = [80, 250, 700, 1500];
const _HIDDEN_VISIBILITY_RESUME_RETRY_DELAYS_MS = [120, 500, 1500, 3e3];
const _SECONDARY_PLAYER_HANDOFF_WINDOW_MS = 27e5;
const _SECONDARY_PLAYER_CLOSE_POLL_MS = 500;
const _HIDDEN_CLEAN_LIVE_STALL_DETECT_MS = 15e3;
const _HIDDEN_CLEAN_LIVE_STALL_REPEAT_MS = 3e4;
const _UNREADY_AD_MEDIA_RECOVERY_MS = 12e3;
const _PostAdRecoveryTransactionState = {
    channel: null,
    mediaKey: null,
    cycleStartedAt: 0,
    video: null,
    observedAt: 0,
    lastCurrentTime: 0,
    lastTotalFrames: -1,
    stallTicks: 0,
    reloadRequestCount: 0,
    acceptedReloadCount: 0,
    lastReloadRequestAt: 0,
    expiresAt: 0,
    lastCheckedAt: 0,
    suspendedAt: 0,
    requiresReplacement: !1,
    requiredReplacementVideo: null,
    requiredNativeReloadAt: 0,
    nativeReloadConfirmedAt: 0,
    pendingOperation: null,
    pendingOperationReadyAt: 0,
    initialOperationCompleted: !1
};
const _PostAdRecoveryNoticeState = {
    mediaKey: null,
    cycleStartedAt: 0,
    pageGeneration: 0,
    playerRef: null,
    videoRef: null,
    currentTime: 0,
    totalVideoFrames: -1,
    noticeShownAt: 0
};
const _PinnedBackupTimelineRestoreState = {
    mediaKey: null,
    cycleStartedAt: 0
};
const _PinnedBackupStallState = {
    mediaKey: null,
    videoRef: null,
    firstObservedAt: 0,
    lastCurrentTime: 0,
    lastBufferedEnd: 0,
    lastForceRefreshAt: 0,
    lastPinnedType: null,
    forceRefreshCount: 0,
    exhaustedLogged: !1
};
const _InAdFreezeState = {
    mediaKey: null,
    video: null,
    firstFrozenAt: 0,
    lastCurrentTime: -1,
    lastActionAt: 0,
    actionCount: 0
};
const _HiddenCleanLiveStallState = {
    mediaKey: null,
    videoRef: null,
    firstFrozenAt: 0,
    lastCurrentTime: -1,
    lastActionAt: 0
};
const _FatalAdMediaRecoveryState = {
    video: null,
    mediaKey: null,
    recoveryId: null,
    recoveryKind: null,
    pinnedType: null,
    cycleStartedAt: 0,
    unreadyStartedAt: 0,
    requestedAt: 0,
    committed: !1
};
function _resetInAdFreezeState(mediaKey = null) {
  _InAdFreezeState.mediaKey = _normalizeMediaKey(mediaKey), _InAdFreezeState.video = null, _InAdFreezeState.firstFrozenAt = 0, _InAdFreezeState.lastCurrentTime = -1, _InAdFreezeState.lastActionAt = 0, _InAdFreezeState.actionCount = 0;
}
function _resetHiddenCleanLiveStallState(mediaKey = null) {
  _HiddenCleanLiveStallState.mediaKey = _normalizeMediaKey(mediaKey), _HiddenCleanLiveStallState.videoRef = null, _HiddenCleanLiveStallState.firstFrozenAt = 0, _HiddenCleanLiveStallState.lastCurrentTime = -1, _HiddenCleanLiveStallState.lastActionAt = 0;
}
function _resetFatalAdMediaRecoveryState(recoveryId = null) {
  return recoveryId && _FatalAdMediaRecoveryState.recoveryId !== recoveryId ? !1 : (_FatalAdMediaRecoveryState.video = null, _FatalAdMediaRecoveryState.mediaKey = null, _FatalAdMediaRecoveryState.recoveryId = null, _FatalAdMediaRecoveryState.recoveryKind = null, _FatalAdMediaRecoveryState.pinnedType = null, _FatalAdMediaRecoveryState.cycleStartedAt = 0, _FatalAdMediaRecoveryState.unreadyStartedAt = 0, _FatalAdMediaRecoveryState.requestedAt = 0, _FatalAdMediaRecoveryState.committed = !1, !0);
}
function _getFatalAdMediaErrorCode(video) {
  const code = Number(video?.error?.code) || 0;
  return code >= 2 && code <= 4 ? code : 0;
}
function _createFatalAdMediaRecoveryId(mediaKey) {
  const cycleStartedAt = _getCurrentAdBreakStartedAt(mediaKey);
  let nonce = "";
  try {
    nonce = globalThis.crypto?.randomUUID?.() || "";
  } catch {
  }
  return nonce || (nonce = `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`), `${mediaKey}:${cycleStartedAt}:${Date.now()}:fatal-media:${nonce}`;
}
function _isOwnedUnreadyAdMedia(video, pageMediaKey, cycleStartedAt) {
  const pinnedType = typeof __TTVAB_STATE__?.PinnedBackupPlayerType == "string" && __TTVAB_STATE__.PinnedBackupPlayerType ? __TTVAB_STATE__.PinnedBackupPlayerType : null, pinnedMediaKey = _normalizeMediaKey(__TTVAB_STATE__?.PinnedBackupPlayerMediaKey), pageChannel = _normalizePlayerChannel(__TTVAB_STATE__?.PageChannel);
  let bufferedLength = 0;
  try {
    bufferedLength = Math.max(0, Number(video?.buffered?.length) || 0);
  } catch {
    return !1;
  }
  return !!(video instanceof HTMLMediaElement && video.isConnected && !video.ended && !video.error && pageMediaKey && _normalizeMediaKey(__TTVAB_STATE__?.CurrentAdMediaKey) === pageMediaKey && _getCurrentAdBreakStartedAt(pageMediaKey) === cycleStartedAt && pinnedType && pinnedMediaKey === pageMediaKey && __TTVAB_STATE__?.PlayerHasPlayedOnce === !0 && !_isNativeDocumentHidden() && Number(video.readyState) === 0 && Number(video.networkState) === 0 && (Number(video.currentTime) || 0) === 0 && bufferedLength === 0 && _hasPendingAdResumeIntent(pageChannel, pageMediaKey) && !_hasUserPauseIntent(pageChannel, pageMediaKey) && !_shouldSuppressAutomaticPlaybackResume(pageChannel, pageMediaKey));
}
function _checkFatalAdMediaRecovery(player) {
  const video = player?.getHTMLVideoElement?.() || null, pageMediaKey = _normalizeMediaKey(__TTVAB_STATE__?.PageMediaKey), adMediaKey = _normalizeMediaKey(__TTVAB_STATE__?.CurrentAdMediaKey), errorCode = _getFatalAdMediaErrorCode(video), cycleStartedAt = _getCurrentAdBreakStartedAt(pageMediaKey), isOwnedUnready = !errorCode && _isOwnedUnreadyAdMedia(video, pageMediaKey, cycleStartedAt);
  if (!(video instanceof HTMLMediaElement) || video.ended || !pageMediaKey || adMediaKey !== pageMediaKey || cycleStartedAt <= 0 || !errorCode && !isOwnedUnready)
    return _resetFatalAdMediaRecoveryState(), !1;
  const now = Date.now(), recoveryKind = errorCode ? "media-error" : "unready", pinnedType = isOwnedUnready ? __TTVAB_STATE__.PinnedBackupPlayerType : null;
  if (_FatalAdMediaRecoveryState.video === video && _FatalAdMediaRecoveryState.mediaKey === pageMediaKey && _FatalAdMediaRecoveryState.cycleStartedAt === cycleStartedAt && _FatalAdMediaRecoveryState.recoveryKind === recoveryKind && (recoveryKind !== "unready" || _FatalAdMediaRecoveryState.pinnedType === pinnedType) || (_resetFatalAdMediaRecoveryState(), _FatalAdMediaRecoveryState.video = video, _FatalAdMediaRecoveryState.mediaKey = pageMediaKey, _FatalAdMediaRecoveryState.recoveryKind = recoveryKind, _FatalAdMediaRecoveryState.pinnedType = pinnedType, _FatalAdMediaRecoveryState.cycleStartedAt = cycleStartedAt, _FatalAdMediaRecoveryState.unreadyStartedAt = recoveryKind === "unready" ? now : 0), recoveryKind === "unready" && now - _FatalAdMediaRecoveryState.unreadyStartedAt < _UNREADY_AD_MEDIA_RECOVERY_MS || _FatalAdMediaRecoveryState.recoveryId && (now - _FatalAdMediaRecoveryState.requestedAt < 3e4 || _FatalAdMediaRecoveryState.committed))
    return !1;
  const recoveryId = _createFatalAdMediaRecoveryId(pageMediaKey);
  return _getCodecHandoffCycleStartedAt(recoveryId) !== cycleStartedAt ? !1 : (_FatalAdMediaRecoveryState.video = video, _FatalAdMediaRecoveryState.mediaKey = pageMediaKey, _FatalAdMediaRecoveryState.recoveryId = recoveryId, _FatalAdMediaRecoveryState.recoveryKind = recoveryKind, _FatalAdMediaRecoveryState.pinnedType = pinnedType, _FatalAdMediaRecoveryState.cycleStartedAt = cycleStartedAt, _FatalAdMediaRecoveryState.requestedAt = now, _FatalAdMediaRecoveryState.committed = !1, _broadcastWorkers({
    key: "PrepareFatalMediaRecovery",
    targetMediaKey: pageMediaKey,
    value: {
      recoveryId,
      recoveryKind,
      requestedAt: now,
      cycleStartedAt,
      channelName: __TTVAB_STATE__?.PageChannel || null,
      mediaKey: pageMediaKey
    }
  }), !0);
}
function _acceptFatalAdMediaRecoveryReady(data) {
  const recoveryId = typeof data?.recoveryId == "string" && data.recoveryId ? data.recoveryId : null, mediaKey = _normalizeMediaKey(data?.mediaKey), pageMediaKey = _normalizeMediaKey(__TTVAB_STATE__?.PageMediaKey), adMediaKey = _normalizeMediaKey(__TTVAB_STATE__?.CurrentAdMediaKey), eventCycleStartedAt = Math.max(0, Number(data?.cycleStartedAt) || 0), requiresCodecHandoff = data?.requiresCodecHandoff !== !1, clearCodecHandoff = () => {
    !requiresCodecHandoff || !mediaKey || _broadcastWorkers({
      key: "UpdateCodecHandoffContext",
      targetMediaKey: mediaKey,
      value: {
        clearHandoffId: recoveryId,
        channelName: __TTVAB_STATE__?.PageChannel || null,
        mediaKey
      }
    });
  };
  if (!recoveryId)
    return !1;
  if (_FatalAdMediaRecoveryState.recoveryId !== recoveryId)
    return mediaKey && mediaKey === pageMediaKey && mediaKey === adMediaKey && clearCodecHandoff(), !1;
  if (_FatalAdMediaRecoveryState.committed)
    return !1;
  const verifiedAt = Math.max(0, Number(data?.verifiedAt) || 0), { player } = _getPlayerAndState(), video = player?.getHTMLVideoElement?.() || null, recoveryKind = _FatalAdMediaRecoveryState.recoveryKind, recoveryConditionStillActive = recoveryKind === "media-error" ? !!_getFatalAdMediaErrorCode(video) : recoveryKind === "unready" ? _isOwnedUnreadyAdMedia(video, pageMediaKey, eventCycleStartedAt) && _FatalAdMediaRecoveryState.pinnedType === __TTVAB_STATE__?.PinnedBackupPlayerType : !1;
  if (!mediaKey || mediaKey !== _FatalAdMediaRecoveryState.mediaKey || mediaKey !== pageMediaKey || mediaKey !== adMediaKey || eventCycleStartedAt <= 0 || eventCycleStartedAt !== _FatalAdMediaRecoveryState.cycleStartedAt || _getCodecHandoffCycleStartedAt(recoveryId) !== eventCycleStartedAt || !_isCodecHandoffCycleCurrent(mediaKey, eventCycleStartedAt) || video !== _FatalAdMediaRecoveryState.video || !recoveryConditionStillActive)
    return mediaKey === _FatalAdMediaRecoveryState.mediaKey && (clearCodecHandoff(), _resetFatalAdMediaRecoveryState(recoveryId)), !1;
  if (verifiedAt < _FatalAdMediaRecoveryState.requestedAt)
    return !1;
  _FatalAdMediaRecoveryState.committed = !0;
  try {
    if (_doPlayerTask(!1, !0, {
      reason: requiresCodecHandoff ? "codec-handoff" : "ad-recovery",
      ...requiresCodecHandoff ? { handoffId: recoveryId, replaceCodecHandoff: !0 } : {},
      cycleStartedAt: eventCycleStartedAt,
      refreshAccessToken: !0,
      newMediaPlayerInstance: !0,
      channel: typeof data?.channel == "string" ? data.channel : __TTVAB_STATE__?.PageChannel || null,
      mediaKey
    }) !== !0)
      throw new Error("player reload was not accepted");
    return !0;
  } catch {
    return clearCodecHandoff(), _resetFatalAdMediaRecoveryState(recoveryId), !1;
  }
}
const _POST_BREAK_WEDGE_EVAL_BUDGET = 40;
const _POST_BREAK_WEDGE_MIN_TICK_ADVANCE_S = 0.3;
const _POST_BREAK_WEDGE_FRAME_EPS = 1;
const _POST_BREAK_WEDGE_EVIDENCE_TO_ACT = 6;
const _POST_BREAK_WEDGE_HEALTHY_FRAMES = 5;
const _POST_BREAK_WEDGE_HEALTHY_TO_DISARM = 3;
const _POST_BREAK_WEDGE_MAX_ACTIONS = 2;
const _PostBreakWedgeState = {
    mediaKey: null,
    remainingEvals: 0,
    lastCurrentTime: -1,
    lastTotalFrames: -1,
    evidenceCount: 0,
    healthyCount: 0,
    actionCount: 0,
    prevAdContext: !1,
    prevAdMediaKey: null
};
function _armPostBreakWedgeWatch(mediaKey = null) {
  _PostBreakWedgeState.mediaKey = _normalizeMediaKey(mediaKey), _PostBreakWedgeState.remainingEvals = _POST_BREAK_WEDGE_EVAL_BUDGET, _PostBreakWedgeState.lastCurrentTime = -1, _PostBreakWedgeState.lastTotalFrames = -1, _PostBreakWedgeState.evidenceCount = 0, _PostBreakWedgeState.healthyCount = 0, _PostBreakWedgeState.actionCount = 0;
}
function _disarmPostBreakWedgeWatch() {
  _PostBreakWedgeState.mediaKey = null, _PostBreakWedgeState.remainingEvals = 0;
}
function _clearPinnedBackupTimelineRestore(mediaKey = null, cycleStartedAt = 0) {
  const safeMediaKey = _normalizeMediaKey(mediaKey), safeCycleStartedAt = Math.max(0, Number(cycleStartedAt) || 0);
  return safeMediaKey && _PinnedBackupTimelineRestoreState.mediaKey !== safeMediaKey || safeCycleStartedAt > 0 && _PinnedBackupTimelineRestoreState.cycleStartedAt !== safeCycleStartedAt ? !1 : (_PinnedBackupTimelineRestoreState.mediaKey = null, _PinnedBackupTimelineRestoreState.cycleStartedAt = 0, !0);
}
function _markPinnedBackupTimelineRestore(mediaKey, cycleStartedAt) {
  const safeMediaKey = _normalizeMediaKey(mediaKey), safeCycleStartedAt = Math.max(0, Number(cycleStartedAt) || 0);
  return !safeMediaKey || safeCycleStartedAt <= 0 ? !1 : (_PinnedBackupTimelineRestoreState.mediaKey = safeMediaKey, _PinnedBackupTimelineRestoreState.cycleStartedAt = safeCycleStartedAt, !0);
}
function _consumePinnedBackupTimelineRestore(mediaKey, cycleStartedAt) {
  const safeMediaKey = _normalizeMediaKey(mediaKey), safeCycleStartedAt = Math.max(0, Number(cycleStartedAt) || 0), matches = !!(safeMediaKey && safeCycleStartedAt > 0 && _PinnedBackupTimelineRestoreState.mediaKey === safeMediaKey && _PinnedBackupTimelineRestoreState.cycleStartedAt === safeCycleStartedAt);
  return matches && _clearPinnedBackupTimelineRestore(), matches;
}
function _resetPinnedBackupStallState() {
  _PinnedBackupStallState.mediaKey = null, _PinnedBackupStallState.videoRef = null, _PinnedBackupStallState.firstObservedAt = 0, _PinnedBackupStallState.lastCurrentTime = 0, _PinnedBackupStallState.lastBufferedEnd = 0, _PinnedBackupStallState.lastForceRefreshAt = 0, _PinnedBackupStallState.lastPinnedType = null, _PinnedBackupStallState.forceRefreshCount = 0, _PinnedBackupStallState.exhaustedLogged = !1;
}
const _SECONDARY_PLAYER_HANDOFF_PAUSE_DELAYS_MS = [0, 120, 450, 1e3];
const _PLAYER_CONTROL_INTERACTION_SELECTOR = [
    '[data-a-target="player-play-pause-button"]',
    '[data-a-target="player-overlay-play-button"]',
    '[data-a-target="player-overlay-click-handler"]',
    '[data-a-target="video-player"]',
    "video"
].join(", ");
const _PLAYER_PREFERENCE_KEYS = ["video-quality", "persistenceEnabled"];
function _readConfiguredQualityGroup() {
  try {
    const raw = localStorage.getItem("video-quality");
    if (!raw)
      return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.default == "string" && parsed.default.trim())
      return parsed.default.trim();
    if (typeof parsed == "string" && parsed.trim())
      return parsed.trim();
  } catch {
  }
  return null;
}
let _lastQualityGroupSyncAt = 0;
function _syncPreferredQualityGroupThrottled() {
  const now = Date.now();
  return now - _lastQualityGroupSyncAt < 5e3 ? !1 : (_lastQualityGroupSyncAt = now, _syncPreferredQualityGroup());
}
function _syncPreferredQualityGroup() {
  if (typeof __TTVAB_STATE__ > "u" || !__TTVAB_STATE__)
    return !1;
  const nextQualityGroup = _readConfiguredQualityGroup();
  return !nextQualityGroup || __TTVAB_STATE__.PreferredQualityGroup === nextQualityGroup ? !1 : (__TTVAB_STATE__.PreferredQualityGroup = nextQualityGroup, _broadcastWorkers({
    key: "UpdatePreferredQualityGroup",
    value: nextQualityGroup
  }), !0);
}
function _isLowLatencyEnabled(playerCore = null) {
  try {
    if (typeof __TTVAB_STATE__ > "u" || !__TTVAB_STATE__)
      return !1;
    const playerState = typeof playerCore?.state?.lowLatencyModeEnabled == "boolean" ? playerCore.state.lowLatencyModeEnabled : null;
    if (typeof playerState == "boolean")
      return playerState;
    const stored = localStorage.getItem("lowLatencyModeEnabled");
    if (stored === "true")
      return !0;
    if (stored === "false")
      return !1;
  } catch {
  }
  return !1;
}
function _getLowLatencySafeEpsilon(playerCore = null) {
  return _isLowLatencyEnabled(playerCore) ? 0.08 : _PLAYER_BUFFER_LIVE_EDGE_EPSILON;
}
function _getLowLatencyDangerZone(playerCore = null) {
  return _isLowLatencyEnabled(playerCore) ? 0.3 : Number(__TTVAB_STATE__?.PlayerBufferingDangerZone) || 1;
}
function _getLowLatencyMinRepeatDelay(playerCore = null) {
  return _isLowLatencyEnabled(playerCore) ? 2e3 : Number(__TTVAB_STATE__?.PlayerBufferingMinRepeatDelay) || 8e3;
}
function _getPlayerCore(player) {
  return player?.playerInstance?.core || player?.core || null;
}
function _isPlayerWorkerUnavailable(player) {
  const worker = _getPlayerCore(player)?.worker;
  return worker?.__TTVABCrashed === !0 || worker?.__TTVABIntentionallyTerminated === !0;
}
const _UnhookedPlayerState = {
    workerRef: null,
    mediaKey: null,
    pageGeneration: 0,
    firstSeenAt: 0,
    noticeShownAt: 0
};
function _getUnhookedPlayerWorker() {
  if (__TTVAB_STATE__.IsAdStrippingEnabled !== !0)
    return null;
  const { player } = _getPlayerAndState(), worker = _getPlayerCore(player)?.worker, media = player?.getHTMLVideoElement?.();
  return !worker || typeof worker.postMessage != "function" || Number(worker.__TTVABGeneration) > 0 || _isPlayerWorkerUnavailable(player) || !(media instanceof HTMLVideoElement) || !media.isConnected || media.readyState < 1 || media !== _getPrimaryMediaElement() || media === _getPictureInPictureVideo() || media === _getActivePictureInPicturePlaybackContext()?.element ? null : worker;
}
function _checkUnhookedPlayer() {
  try {
    const mediaKey = _getPlaybackContextFromUrl(window.location.href).MediaKey, pageGeneration = Number(__TTVAB_STATE__.PagePlaybackContextGeneration) || 0, worker = mediaKey ? _getUnhookedPlayerWorker() : null;
    if (!worker || mediaKey !== _UnhookedPlayerState.mediaKey || pageGeneration !== _UnhookedPlayerState.pageGeneration || worker !== _UnhookedPlayerState.workerRef?.deref()) {
      _UnhookedPlayerState.mediaKey, _UnhookedPlayerState.workerRef = worker ? new WeakRef(worker) : null, _UnhookedPlayerState.mediaKey = worker ? mediaKey : null, _UnhookedPlayerState.pageGeneration = pageGeneration, _UnhookedPlayerState.firstSeenAt = Date.now(), _UnhookedPlayerState.noticeShownAt = 0;
      return;
    }
    if (_UnhookedPlayerState.noticeShownAt > 0 || Date.now() - _UnhookedPlayerState.firstSeenAt < 5e3)
      return;
    _UnhookedPlayerState.noticeShownAt > 0;
  } catch {
  }
}
function _findReactRoot() {
  let rootNode = _cachedReactRootNode;
  if (!rootNode?.isConnected) {
    if (rootNode = document.querySelector("#root"), !rootNode)
      return _cachedReactRootNode = null, _cachedReactContainerKey = null, null;
    _cachedReactRootNode = rootNode, _cachedReactContainerKey = null;
  }
  if (rootNode._reactRootContainer?._internalRoot?.current)
    return rootNode._reactRootContainer._internalRoot.current;
  let containerName = _cachedReactContainerKey;
  return (!containerName || !(containerName in rootNode)) && (containerName = Object.keys(rootNode).find((x) => x.startsWith("__reactContainer")) || null, _cachedReactContainerKey = containerName), containerName ? rootNode[containerName] : null;
}
function _findReactNodesByConstraints(root, constraints, requiredCount = constraints.length) {
  const found = new Array(constraints.length).fill(null);
  if (!root)
    return found;
  let remaining = requiredCount;
  function visit(node) {
    const stateNode = node.stateNode;
    if (stateNode) {
      for (let i = 0; i < constraints.length; i++)
        if (found[i] === null && constraints[i](stateNode) && (found[i] = stateNode, i < requiredCount && remaining--, remaining === 0))
          return !0;
    }
    let child = node.child;
    for (; child; ) {
      if (visit(child))
        return !0;
      child = child.sibling;
    }
    return !1;
  }
  return visit(root), found;
}
function _getPlayerAndState() {
  const reactRoot = _findReactRoot();
  if (!reactRoot)
    return { player: null, state: null };
  const [playerWrapper, directState, fallbackStateWrapper] = _findReactNodesByConstraints(reactRoot, [
    (node) => node.setPlayerActive && node.props?.mediaPlayerInstance,
    (node) => node.setSrc && node.setInitialPlaybackSettings,
    (node) => node.state?.videoPlayerInstance && node.state.videoPlayerInstance.playerMode !== void 0
  ], 2), player = playerWrapper?.props?.mediaPlayerInstance || null;
  let playerState = directState;
  return playerState || (playerState = fallbackStateWrapper?.state?.videoPlayerInstance || null), { player, state: playerState };
}
function _resetPlayerBufferMonitorState(cooldownMs = 0) {
  _resetCleanPlaybackFailureSamples();
  const minRepeatDelay = typeof __TTVAB_STATE__ < "u" && __TTVAB_STATE__ && Number(_getLowLatencyMinRepeatDelay(_getPlayerCore(_getPlayerAndState().player))) || 0, requestedCooldownMs = Number.isFinite(cooldownMs) ? Math.max(0, cooldownMs) : 0, appliedCooldownMs = minRepeatDelay > 0 ? Math.min(requestedCooldownMs, minRepeatDelay) : requestedCooldownMs;
  _PlayerBufferState.videoRef = null, _PlayerBufferState.currentTime = -1, _PlayerBufferState.totalVideoFrames = -1, _PlayerBufferState.bufferedPosition = 0, _PlayerBufferState.bufferDuration = 0, _PlayerBufferState.numSame = 0, _PlayerBufferState.fixAttempts = 0, _PlayerBufferState.liveEdgeStarveCount = 0, _PlayerBufferState.gapJumpLastPosition = -1, _PlayerBufferState.gapJumpStuckTicks = 0, _PlayerBufferState.postAdUnhealthyCount = 0, _PlayerBufferState.postAdRecoveryStartedAt = 0, _PlayerBufferState.postAdLastCurrentTime = 0, _PlayerBufferState.postAdStallTicks = 0, _PlayerBufferState.postAdSoftReloadAttempted = !1, _resetPostAdGrace(), _resetHiddenCleanLiveStallState(), _PlayerBufferState.lastFixTime = minRepeatDelay > 0 ? Date.now() - Math.max(0, minRepeatDelay - appliedCooldownMs) : 0;
}
function _clearCachedPlayerRef(resetBufferState = !0, cooldownMs = 0) {
  _cachedPlayerRef = null, _cachedPlayerRefMediaKey = null, resetBufferState && _resetPlayerBufferMonitorState(cooldownMs);
}
function _readPlayerBufferTelemetry(player, playerCore = null) {
  playerCore = playerCore || _getPlayerCore(player);
  const video = player?.getHTMLVideoElement?.() || null, position = Number(playerCore?.state?.position) || 0, bufferedPosition = Number(playerCore?.state?.bufferedPosition) || 0, bufferDuration = Number(player?.getBufferDuration?.()) || 0, videoCurrentTime = Number(video?.currentTime);
  let liveEdge = bufferedPosition;
  if (video?.buffered?.length > 0)
    try {
      liveEdge = video.buffered.end(video.buffered.length - 1);
    } catch {
    }
  const currentTime = Number.isFinite(videoCurrentTime) ? videoCurrentTime : position, liveEdgeDistance = Math.max(0, liveEdge - currentTime), readyState = Number(video?.readyState) || 0, hasFutureData = bufferDuration > _getLowLatencySafeEpsilon(playerCore) || liveEdgeDistance > _getLowLatencySafeEpsilon(playerCore) || readyState >= 3;
  return {
    video,
    position,
    bufferedPosition,
    bufferDuration,
    currentTime,
    liveEdge,
    liveEdgeDistance,
    readyState,
    hasFutureData
  };
}
function _isPlayerPaused(player, playerCore = null, video = null) {
  const resolvedVideo = video || player?.getHTMLVideoElement?.() || null;
  return !!(player?.isPaused?.() || playerCore?.paused || resolvedVideo?.paused);
}
function _isPlaybackHealthyAfterAd(player, playerCore = null, video = null) {
  const resolvedVideo = video || player?.getHTMLVideoElement?.() || null;
  if (!(resolvedVideo instanceof HTMLMediaElement) || resolvedVideo.ended || _isPlayerPaused(player, playerCore, resolvedVideo) || Number(resolvedVideo.readyState) < 2 || resolvedVideo instanceof HTMLVideoElement && Number(resolvedVideo.videoWidth) <= 0)
    return !1;
  const telemetry = _readPlayerBufferTelemetry(player, playerCore), safeEpsilon = _getLowLatencySafeEpsilon(playerCore || _getPlayerCore(player));
  return telemetry.bufferDuration > safeEpsilon || telemetry.liveEdgeDistance > safeEpsilon;
}
function _getDocumentPropertyGetter(propertyName) {
  let owner = document;
  for (; owner; )
    try {
      const descriptor = Object.getOwnPropertyDescriptor(owner, propertyName);
      if (typeof descriptor?.get == "function")
        return descriptor.get;
      owner = Object.getPrototypeOf(owner);
    } catch {
      return null;
    }
  return null;
}
function _getDocumentPrototypeMethod(propertyName) {
  let owner = Object.getPrototypeOf(document);
  for (; owner; )
    try {
      const descriptor = Object.getOwnPropertyDescriptor(owner, propertyName);
      if (typeof descriptor?.value == "function")
        return descriptor.value;
      owner = Object.getPrototypeOf(owner);
    } catch {
      return null;
    }
  return null;
}
function _isNativeDocumentFocused() {
  const nativeVisibility = window.__TTVAB_NATIVE_VISIBILITY__, hasFocus = typeof nativeVisibility?.hasFocus == "function" ? nativeVisibility.hasFocus : _getDocumentPrototypeMethod("hasFocus");
  try {
    if (typeof hasFocus == "function")
      return hasFocus.call(document) === !0;
  } catch {
  }
  try {
    return typeof document.hasFocus != "function" || document.hasFocus() === !0;
  } catch {
  }
  return !0;
}
function _isNativeVisibilityHidden() {
  const nativeVisibility = window.__TTVAB_NATIVE_VISIBILITY__;
  for (const [propertyName, capturedGetter] of [
    ["hidden", nativeVisibility?.hidden],
    ["webkitHidden", nativeVisibility?.webkitHidden],
    ["mozHidden", nativeVisibility?.mozHidden]
  ]) {
    const getter = typeof capturedGetter == "function" ? capturedGetter : _getDocumentPropertyGetter(propertyName);
    try {
      if (typeof getter == "function")
        return getter.call(document) === !0;
    } catch {
    }
  }
  return document.hidden === !0;
}
function _isNativeDocumentHidden(context = null) {
  if (!_isNativeVisibilityHidden())
    return !1;
  const playbackContext = _normalizePlaybackContext(context || {
    MediaType: __TTVAB_STATE__?.PageMediaType,
    ChannelName: __TTVAB_STATE__?.PageChannel,
    VodID: __TTVAB_STATE__?.PageVodID,
    MediaKey: __TTVAB_STATE__?.PageMediaKey
  });
  if (_isActivePictureInPicturePlaybackContext(playbackContext))
    return !1;
  try {
    if (document.pictureInPictureElement && !_getActivePictureInPicturePlaybackContext() && playbackContext.MediaKey && playbackContext.MediaKey === _normalizeMediaKey(__TTVAB_STATE__?.PageMediaKey))
      return !1;
  } catch {
  }
  return !0;
}
function _syncPagePlaybackVisibilityState(forceHidden = !1) {
  if (typeof __TTVAB_STATE__ > "u" || !__TTVAB_STATE__ || !Object.hasOwn(__TTVAB_STATE__, "PagePlaybackVisibleSinceAt"))
    return !1;
  const pageContext = _normalizePlaybackContext({
    MediaType: __TTVAB_STATE__.PageMediaType,
    ChannelName: __TTVAB_STATE__.PageChannel,
    VodID: __TTVAB_STATE__.PageVodID,
    MediaKey: __TTVAB_STATE__.PageMediaKey
  }), pageMediaKey = _normalizeMediaKey(pageContext.MediaKey), activePipContext = _getActivePictureInPicturePlaybackContext(), pipMediaKey = _normalizeMediaKey(activePipContext?.MediaKey), previousPageMediaKey = _normalizeMediaKey(_PlaybackIntentState.pagePlaybackVisibilityMediaKey), previousPipMediaKey = _normalizeMediaKey(_PlaybackIntentState.pictureInPictureVisibilityMediaKey), isHidden = !!(forceHidden === !0 || _isNativeDocumentHidden(pageContext)), currentVisibleSinceAt = Math.max(0, Number(__TTVAB_STATE__.PagePlaybackVisibleSinceAt) || 0), nextVisibleSinceAt = isHidden ? 0 : currentVisibleSinceAt || Math.max(1, Date.now()), messages = [];
  if ((currentVisibleSinceAt !== nextVisibleSinceAt || previousPageMediaKey !== pageMediaKey) && messages.push({
    key: "UpdatePagePlaybackVisibleSinceAt",
    ...pageMediaKey ? { targetMediaKey: pageMediaKey } : {},
    value: nextVisibleSinceAt
  }), __TTVAB_STATE__.PagePlaybackVisibleSinceAt = nextVisibleSinceAt, _PlaybackIntentState.pagePlaybackVisibilityMediaKey = pageMediaKey, previousPipMediaKey && previousPipMediaKey !== pipMediaKey && previousPipMediaKey !== pageMediaKey && messages.push({
    key: "UpdatePagePlaybackVisibleSinceAt",
    targetMediaKey: previousPipMediaKey,
    value: 0
  }), pipMediaKey) {
    const currentPipVisibleSinceAt = previousPipMediaKey === pipMediaKey ? Math.max(0, Number(_PlaybackIntentState.pictureInPictureVisibleSinceAt) || 0) : 0, nextPipVisibleSinceAt = forceHidden === !0 ? 0 : currentPipVisibleSinceAt || (previousPageMediaKey === pipMediaKey ? currentVisibleSinceAt : 0) || Math.max(1, Date.now());
    pipMediaKey !== pageMediaKey && (previousPipMediaKey !== pipMediaKey || currentPipVisibleSinceAt !== nextPipVisibleSinceAt || previousPageMediaKey !== pageMediaKey) && messages.push({
      key: "UpdatePagePlaybackVisibleSinceAt",
      targetMediaKey: pipMediaKey,
      value: nextPipVisibleSinceAt
    }), _PlaybackIntentState.pictureInPictureVisibilityMediaKey = pipMediaKey, _PlaybackIntentState.pictureInPictureVisibleSinceAt = nextPipVisibleSinceAt;
  } else
    _PlaybackIntentState.pictureInPictureVisibilityMediaKey = null, _PlaybackIntentState.pictureInPictureVisibleSinceAt = 0;
  return messages.length === 0 ? !1 : (_broadcastWorkers(messages), !0);
}
function _isPlaybackPageUnfocused(context = null) {
  const playbackContext = _normalizePlaybackContext(context || {
    MediaType: __TTVAB_STATE__?.PageMediaType,
    ChannelName: __TTVAB_STATE__?.PageChannel,
    VodID: __TTVAB_STATE__?.PageVodID,
    MediaKey: __TTVAB_STATE__?.PageMediaKey
  });
  return _isActivePictureInPicturePlaybackContext(playbackContext) ? !1 : _isNativeDocumentHidden(playbackContext) ? !0 : !_isNativeDocumentFocused();
}
function _isUnfocusedPlaybackEnvironment() {
  return _isPlaybackPageUnfocused();
}
function _normalizePlayerChannel(channel = null) {
  return typeof channel != "string" ? null : channel.trim().toLowerCase() || null;
}
function _resolvePlayerMediaKey(channel = null, mediaKey = null) {
  return _normalizeMediaKey(mediaKey) || _normalizeMediaKey(__TTVAB_STATE__?.CurrentAdMediaKey) || _normalizeMediaKey(__TTVAB_STATE__?.PageMediaKey) || _buildMediaKey("live", channel, null) || _buildMediaKey("live", __TTVAB_STATE__?.CurrentAdChannel, null) || _buildMediaKey("live", __TTVAB_STATE__?.PageChannel, null) || null;
}
function _getCurrentPlaybackRecoveryContext() {
  const routeContext = _normalizePlaybackContext(_getPlaybackContextFromUrl(globalThis?.location?.href || ""));
  return {
    channel: _normalizePlayerChannel(routeContext.ChannelName) || null,
    mediaKey: _normalizeMediaKey(routeContext.MediaKey) || null
  };
}
function _getPictureInPicturePlaybackContext(element) {
  if (!(element instanceof HTMLVideoElement))
    return null;
  const activeContext = _getActivePictureInPicturePlaybackContext();
  if (activeContext?.element === element)
    return activeContext;
  try {
    const { player, state } = _getPlayerAndState();
    if (player?.getHTMLVideoElement?.() !== element)
      return null;
    const content = state?.props?.content, context = _normalizePlaybackContext({
      MediaType: content?.type,
      ChannelName: content?.channelLogin,
      VodID: content?.vodID
    });
    if (!context.MediaKey)
      return null;
    const worker = _getPlayerCore(player)?.worker;
    return {
      ...context,
      workerRef: worker && typeof worker == "object" ? new WeakRef(worker) : null,
      pageMediaKey: _normalizeMediaKey(__TTVAB_STATE__?.PageMediaKey),
      pageContextGeneration: Math.max(0, Number(__TTVAB_STATE__?.PagePlaybackContextGeneration) || 0)
    };
  } catch {
    return null;
  }
}
function _handlePictureInPictureExit(event) {
  const activeContext = _getActivePictureInPicturePlaybackContext();
  if (!(!activeContext || activeContext.element !== event.target))
    try {
      if (_PlaybackIntentState.secondaryPlayerHandoffKind === "pip" && _clearSecondaryPlayerHandoff(), activeContext.MediaKey !== _normalizeMediaKey(__TTVAB_STATE__?.PageMediaKey)) {
        try {
          const { player, state } = _getPlayerAndState(), content = state?.props?.content, currentContext = _normalizePlaybackContext({
            MediaType: content?.type,
            ChannelName: content?.channelLogin,
            VodID: content?.vodID
          });
          if (activeContext.element.isConnected && player?.getHTMLVideoElement?.() === activeContext.element && currentContext.MediaKey === activeContext.MediaKey)
            return;
        } catch {
        }
        _releasePlaybackContext(activeContext);
      }
    } finally {
      _clearActivePictureInPicturePlaybackContext(event.target);
    }
}
function _setActivePictureInPicturePlaybackContext(element = null, context = null) {
  if (!(element instanceof HTMLVideoElement))
    return null;
  const capturedContext = context || _getPictureInPicturePlaybackContext(element);
  if (!capturedContext)
    return null;
  const normalizedContext = _normalizePlaybackContext(capturedContext);
  if (!normalizedContext.MediaKey && !normalizedContext.ChannelName)
    return null;
  _PipDeferredReloadEntry && (_PipDeferredReloadEntry.element !== element || _PipDeferredReloadEntry.mediaKey !== normalizedContext.MediaKey) && (_PipDeferredReloadEntry.element.removeEventListener("leavepictureinpicture", _PipDeferredReloadEntry.listener), _PipDeferredReloadEntry = null), _clearActivePictureInPicturePlaybackListeners(), _PlaybackIntentState.pictureInPictureElement = element, _PlaybackIntentState.pictureInPictureMediaType = normalizedContext.MediaType, _PlaybackIntentState.pictureInPictureChannel = normalizedContext.ChannelName, _PlaybackIntentState.pictureInPictureVodID = normalizedContext.VodID, _PlaybackIntentState.pictureInPictureMediaKey = normalizedContext.MediaKey, _PlaybackIntentState.pictureInPictureWorkerRef = capturedContext.workerRef || null, _PlaybackIntentState.pictureInPicturePageMediaKey = capturedContext.pageMediaKey || null, _PlaybackIntentState.pictureInPicturePageContextGeneration = capturedContext.pageContextGeneration || 0;
  const handlePause = () => {
    if (_wasRecentProgrammaticPlaybackAction("pause") || element.ended || _PlaybackIntentState.pictureInPictureElement !== element)
      return;
    const mediaKey = normalizedContext.MediaKey;
    if (!mediaKey)
      return;
    const hadExplicitInteraction = _hasRecentPlaybackControlInteraction(normalizedContext.ChannelName, mediaKey), wasDuringAd = _isAdOwnedPauseContext(normalizedContext.ChannelName, mediaKey);
    wasDuringAd && !hadExplicitInteraction || (_PlaybackIntentState.userPausedMediaKey = mediaKey, _PlaybackIntentState.userPausedAt = Date.now(), _PlaybackIntentState.userPausedHadExplicitInteraction = hadExplicitInteraction, _PlaybackIntentState.userPausedDuringAd = wasDuringAd);
  }, handlePlay = () => {
    _wasRecentProgrammaticPlaybackAction("play") || _clearUserPauseIntent(normalizedContext.ChannelName, normalizedContext.MediaKey);
  };
  return element.addEventListener("leavepictureinpicture", _handlePictureInPictureExit, !0), element.addEventListener("pause", handlePause, !0), element.addEventListener("play", handlePlay, !0), _PlaybackIntentState.pictureInPicturePauseListener = handlePause, _PlaybackIntentState.pictureInPicturePlayListener = handlePlay, normalizedContext.MediaKey, _normalizeMediaKey(__TTVAB_STATE__?.CurrentAdMediaKey), _syncPagePlaybackVisibilityState(), { ...normalizedContext, element };
}
function _clearActivePictureInPicturePlaybackListeners() {
  const element = _PlaybackIntentState.pictureInPictureElement;
  element instanceof HTMLVideoElement && (element.removeEventListener("leavepictureinpicture", _handlePictureInPictureExit, !0), _PlaybackIntentState.pictureInPicturePauseListener && element.removeEventListener("pause", _PlaybackIntentState.pictureInPicturePauseListener, !0), _PlaybackIntentState.pictureInPicturePlayListener && element.removeEventListener("play", _PlaybackIntentState.pictureInPicturePlayListener, !0)), _PlaybackIntentState.pictureInPicturePauseListener = null, _PlaybackIntentState.pictureInPicturePlayListener = null;
}
function _getActivePictureInPicturePlaybackContext() {
  const element = _PlaybackIntentState.pictureInPictureElement;
  if (!(element instanceof HTMLVideoElement))
    return null;
  const normalizedContext = _normalizePlaybackContext({
    MediaType: _PlaybackIntentState.pictureInPictureMediaType,
    ChannelName: _PlaybackIntentState.pictureInPictureChannel,
    VodID: _PlaybackIntentState.pictureInPictureVodID,
    MediaKey: _PlaybackIntentState.pictureInPictureMediaKey
  });
  return !normalizedContext.MediaKey && !normalizedContext.ChannelName ? null : {
    ...normalizedContext,
    element,
    workerRef: _PlaybackIntentState.pictureInPictureWorkerRef,
    pageMediaKey: _PlaybackIntentState.pictureInPicturePageMediaKey,
    pageContextGeneration: _PlaybackIntentState.pictureInPicturePageContextGeneration
  };
}
function _isActivePictureInPicturePlaybackContext(context) {
  const activeContext = _getActivePictureInPicturePlaybackContext();
  if (!activeContext)
    return !1;
  const normalizedContext = _normalizePlaybackContext(context);
  return normalizedContext.MediaKey ? normalizedContext.MediaKey === activeContext.MediaKey : normalizedContext.ChannelName ? normalizedContext.ChannelName === activeContext.ChannelName : !1;
}
function _clearActivePictureInPicturePlaybackContext(element = null) {
  const activeContext = _getActivePictureInPicturePlaybackContext();
  return element instanceof HTMLVideoElement && activeContext?.element !== element ? null : (_clearActivePictureInPicturePlaybackListeners(), _PlaybackIntentState.pictureInPictureElement = null, _PlaybackIntentState.pictureInPictureMediaType = null, _PlaybackIntentState.pictureInPictureChannel = null, _PlaybackIntentState.pictureInPictureVodID = null, _PlaybackIntentState.pictureInPictureMediaKey = null, _PlaybackIntentState.pictureInPictureWorkerRef = null, _PlaybackIntentState.pictureInPicturePageMediaKey = null, _PlaybackIntentState.pictureInPicturePageContextGeneration = 0, _syncPagePlaybackVisibilityState(), activeContext);
}
function _isPlaybackRecoveryContextCurrent(channel = null, mediaKey = null) {
  const targetMediaKey = _normalizeMediaKey(mediaKey), targetChannel = _normalizePlayerChannel(channel);
  if (_isActivePictureInPicturePlaybackContext({
    MediaKey: targetMediaKey,
    ChannelName: targetChannel
  }))
    return !0;
  const currentContext = _getCurrentPlaybackRecoveryContext();
  return targetMediaKey ? currentContext.mediaKey ? currentContext.mediaKey === targetMediaKey : !1 : targetChannel ? currentContext.channel ? currentContext.channel === targetChannel : !1 : !0;
}
function _getPlayerLifecycleCycleStartedAt(mediaKey) {
  const normalizedMediaKey = _normalizeMediaKey(mediaKey);
  if (!normalizedMediaKey)
    return 0;
  const currentAdMediaKey = _normalizeMediaKey(__TTVAB_STATE__?.CurrentAdMediaKey);
  if (currentAdMediaKey) {
    if (currentAdMediaKey !== normalizedMediaKey)
      return 0;
    const info = __TTVAB_STATE__?.StreamInfos?.[normalizedMediaKey] || null, podCycleStartedAt = Math.max(0, Number(__TTVAB_STATE__?.AdPodProgressByMediaKey?.[normalizedMediaKey]?.cycleStartedAt) || 0), infoCycleStartedAt = Math.max(0, Number(info?.VisibleAdStartedAt) || 0);
    return Math.max(podCycleStartedAt, infoCycleStartedAt);
  }
  return _normalizeMediaKey(__TTVAB_STATE__?.LastAdEndedMediaKey) === normalizedMediaKey && Date.now() - Math.max(0, Number(__TTVAB_STATE__?.LastAdEndedAt) || 0) < 3e4 ? Math.max(0, Number(__TTVAB_STATE__?.LastAdEndedCycleStartedAt) || 0) : 0;
}
function _isPlayerLifecycleCycleCurrent(mediaKey, cycleStartedAt) {
  const expectedCycleStartedAt = Math.max(0, Number(cycleStartedAt) || 0);
  return expectedCycleStartedAt > 0 && _getPlayerLifecycleCycleStartedAt(mediaKey) === expectedCycleStartedAt;
}
function _isOwnedPlayerLifecycleCycleCurrent(mediaKey, cycleStartedAt) {
  if (_isPlayerLifecycleCycleCurrent(mediaKey, cycleStartedAt))
    return !0;
  const safeMediaKey = _normalizeMediaKey(mediaKey), safeCycleStartedAt = Math.max(0, Number(cycleStartedAt) || 0);
  return !!(safeMediaKey && _PostAdRecoveryTransactionState.mediaKey === safeMediaKey && _PostAdRecoveryTransactionState.cycleStartedAt === safeCycleStartedAt && _isPostAdRecoveryCycleCurrent(safeMediaKey, safeCycleStartedAt));
}
function _clearPlaybackRecoveryTimeouts(preservedMediaKey = null) {
  const safePreservedMediaKey = _normalizeMediaKey(preservedMediaKey);
  for (const entry of _PlaybackRecoveryTimeoutState.timeouts)
    safePreservedMediaKey && _normalizeMediaKey(entry.mediaKey) === safePreservedMediaKey || (clearTimeout(entry.id), _PlaybackRecoveryTimeoutState.timeouts.delete(entry));
}
function _clearPlaybackRecoveryTimeoutsForContext(mediaKey = null) {
  const safeMediaKey = _normalizeMediaKey(mediaKey);
  if (safeMediaKey)
    for (const entry of _PlaybackRecoveryTimeoutState.timeouts)
      _normalizeMediaKey(entry.mediaKey) === safeMediaKey && (clearTimeout(entry.id), _PlaybackRecoveryTimeoutState.timeouts.delete(entry));
}
function _clearPendingPlayerPreferenceRestore() {
  _PlayerPreferenceRestoreState.timeoutId && clearTimeout(_PlayerPreferenceRestoreState.timeoutId), _PlayerPreferenceRestoreState.timeoutId = null, _PlayerPreferenceRestoreState.channel = null, _PlayerPreferenceRestoreState.mediaKey = null, _PlayerPreferenceRestoreState.cycleStartedAt = 0;
}
function _schedulePlaybackRecoveryTimeout(callback, delay = 0, channel = null, mediaKey = null, cycleStartedAt = 0) {
  if (typeof callback != "function")
    return null;
  const entry = {
    id: 0,
    channel: _normalizePlayerChannel(channel),
    mediaKey: _resolvePlayerMediaKey(channel, mediaKey),
    cycleStartedAt: Math.max(0, Number(cycleStartedAt) || 0)
  };
  return entry.id = setTimeout(() => {
    if (_PlaybackRecoveryTimeoutState.timeouts.delete(entry), !!_isPlaybackRecoveryContextCurrent(entry.channel, entry.mediaKey) && !(entry.cycleStartedAt > 0 && !_isOwnedPlayerLifecycleCycleCurrent(entry.mediaKey, entry.cycleStartedAt)))
      try {
        callback();
      } catch {
      }
  }, Math.max(0, delay)), _PlaybackRecoveryTimeoutState.timeouts.add(entry), entry.id;
}
function _markProgrammaticPause() {
  _PlaybackIntentState.lastProgrammaticPauseAt = Date.now();
}
function _markProgrammaticPlay() {
  _PlaybackIntentState.lastProgrammaticPlayAt = Date.now();
}
function _clearRecordedUserPauseIntent() {
  _PlaybackIntentState.userPausedMediaKey = null, _PlaybackIntentState.userPausedAt = 0, _PlaybackIntentState.userPausedHadExplicitInteraction = !1, _PlaybackIntentState.userPausedDuringAd = !1;
}
function _clearSecondaryPlayerCloseMonitor() {
  _PlaybackIntentState.secondaryPlayerCloseMonitorId && clearInterval(_PlaybackIntentState.secondaryPlayerCloseMonitorId), _PlaybackIntentState.secondaryPlayerCloseMonitorId = null, _PlaybackIntentState.secondaryPlayerWindows.clear();
}
function _clearSecondaryPlayerHandoff() {
  _clearSecondaryPlayerCloseMonitor(), _PlaybackIntentState.secondaryPlayerHandoffKind = null, _PlaybackIntentState.secondaryPlayerHandoffChannel = null, _PlaybackIntentState.secondaryPlayerHandoffMediaKey = null, _PlaybackIntentState.secondaryPlayerHandoffUntil = 0, _PlaybackIntentState.secondaryPlayerHandoffSourceWasPlaying = !1;
}
function _clearRecentPlaybackControlInteraction() {
  _PlaybackIntentState.lastPlaybackControlInteractionAt = 0, _PlaybackIntentState.lastPlaybackControlInteractionMediaKey = null;
}
function _rememberRecentPlaybackControlInteraction(channel = null, mediaKey = null) {
  const safeMediaKey = _resolvePlayerMediaKey(channel, mediaKey);
  _PlaybackIntentState.lastPlaybackControlInteractionAt = Date.now(), _PlaybackIntentState.lastPlaybackControlInteractionMediaKey = safeMediaKey;
}
function _hasRecentPlaybackControlInteraction(channel = null, mediaKey = null) {
  const lastInteractionAt = Number(_PlaybackIntentState.lastPlaybackControlInteractionAt) || 0;
  if (lastInteractionAt <= 0 || Date.now() - lastInteractionAt > _USER_PAUSE_INTERACTION_WINDOW_MS)
    return !1;
  const safeMediaKey = _resolvePlayerMediaKey(channel, mediaKey), interactionMediaKey = _normalizeMediaKey(_PlaybackIntentState.lastPlaybackControlInteractionMediaKey);
  return !safeMediaKey || !interactionMediaKey || safeMediaKey === interactionMediaKey;
}
function _hookMediaSessionPlaybackIntent() {
  if (window.__TTVAB_MEDIA_SESSION_PLAYBACK_INTENT_PATCHED__)
    return !0;
  let mediaSession = null;
  try {
    mediaSession = navigator.mediaSession;
  } catch {
  }
  if (!mediaSession || typeof mediaSession.setActionHandler != "function")
    return !1;
  const nativeSetActionHandler = mediaSession.setActionHandler;
  try {
    mediaSession.setActionHandler = function(action, handler) {
      const wrappedHandler = (action === "play" || action === "pause" || action === "stop") && typeof handler == "function" ? function(details) {
        const pipContext = _getActivePictureInPicturePlaybackContext(), channel = pipContext?.ChannelName || __TTVAB_STATE__?.PageChannel, mediaKey = pipContext?.MediaKey || __TTVAB_STATE__?.PageMediaKey;
        _rememberRecentPlaybackControlInteraction(channel, mediaKey);
        const safeMediaKey = _resolvePlayerMediaKey(channel, mediaKey);
        return action === "play" ? _clearUserPauseIntent(channel, safeMediaKey) : safeMediaKey && (_PlaybackIntentState.userPausedMediaKey = safeMediaKey, _PlaybackIntentState.userPausedAt = Date.now(), _PlaybackIntentState.userPausedHadExplicitInteraction = !0, _PlaybackIntentState.userPausedDuringAd = _isAdOwnedPauseContext(channel, safeMediaKey)), handler.call(this, details);
      } : handler;
      return nativeSetActionHandler.call(this, action, wrappedHandler);
    };
  } catch {
    return !1;
  }
  return window.__TTVAB_MEDIA_SESSION_PLAYBACK_INTENT_PATCHED__ = !0, !0;
}
function _wasRecentProgrammaticPlaybackAction(kind) {
  const now = Date.now();
  return kind === "pause" ? now - (_PlaybackIntentState.lastProgrammaticPauseAt || 0) < 1500 : kind === "play" ? now - (_PlaybackIntentState.lastProgrammaticPlayAt || 0) < 1500 : !1;
}
function _clearUserPauseIntent(channel = null, mediaKey = null) {
  if (!_PlaybackIntentState.userPausedMediaKey)
    return !1;
  const safeMediaKey = _resolvePlayerMediaKey(channel, mediaKey);
  return safeMediaKey && _PlaybackIntentState.userPausedMediaKey !== safeMediaKey ? !1 : (_clearRecordedUserPauseIntent(), !0);
}
function _resetPlaybackIntentForNavigation(channel = null, mediaKey = null, durationMs = 2500, preservedMediaKey = null) {
  const safePreservedMediaKey = _normalizeMediaKey(preservedMediaKey);
  (!safePreservedMediaKey || _normalizeMediaKey(_PlayerPreferenceRestoreState.mediaKey) !== safePreservedMediaKey) && _clearPendingPlayerPreferenceRestore(), (!safePreservedMediaKey || _normalizeMediaKey(_PlaybackIntentState.userPausedMediaKey) !== safePreservedMediaKey) && _clearRecordedUserPauseIntent(), (!safePreservedMediaKey || _normalizeMediaKey(_PlaybackIntentState.lastPlaybackControlInteractionMediaKey) !== safePreservedMediaKey) && _clearRecentPlaybackControlInteraction(), (!safePreservedMediaKey || _normalizeMediaKey(_PlaybackIntentState.secondaryPlayerHandoffMediaKey) !== safePreservedMediaKey) && _clearSecondaryPlayerHandoff(), (!safePreservedMediaKey || _normalizeMediaKey(_PostAdRecoveryTransactionState.mediaKey) !== safePreservedMediaKey) && _resetPostAdRecoveryTransaction(), (!safePreservedMediaKey || _normalizeMediaKey(_PinnedBackupTimelineRestoreState.mediaKey) !== safePreservedMediaKey) && _clearPinnedBackupTimelineRestore(), _suppressPauseIntent(channel, mediaKey, durationMs);
}
function _hasUserPauseIntent(channel = null, mediaKey = null) {
  if (typeof document !== "undefined" && document.documentElement?.dataset.drophunterPlaybackSuspended === window.location.href)
    return !0;
  if (!_PlaybackIntentState.userPausedMediaKey)
    return !1;
  const safeMediaKey = _resolvePlayerMediaKey(channel, mediaKey);
  return safeMediaKey ? _PlaybackIntentState.userPausedMediaKey === safeMediaKey : !1;
}
function _suppressPauseIntent(channel = null, mediaKey = null, durationMs = 3e3) {
  const safeMediaKey = _resolvePlayerMediaKey(channel, mediaKey);
  return !safeMediaKey || !Number.isFinite(durationMs) || durationMs <= 0 ? !1 : (_PlaybackIntentState.suppressedPauseMediaKey = safeMediaKey, _PlaybackIntentState.suppressedPauseUntil = Date.now() + durationMs, !0);
}
function _isPauseIntentSuppressed(channel = null, mediaKey = null) {
  if ((_PlaybackIntentState.suppressedPauseUntil || 0) <= Date.now())
    return _PlaybackIntentState.suppressedPauseMediaKey = null, _PlaybackIntentState.suppressedPauseUntil = 0, !1;
  const safeMediaKey = _resolvePlayerMediaKey(channel, mediaKey);
  return safeMediaKey ? _PlaybackIntentState.suppressedPauseMediaKey === safeMediaKey : !0;
}
function _matchesPlaybackTargetContext(expectedChannel = null, expectedMediaKey = null, channel = null, mediaKey = null) {
  const safeChannel = _normalizePlayerChannel(channel), safeMediaKey = _normalizeMediaKey(mediaKey), normalizedExpectedChannel = _normalizePlayerChannel(expectedChannel), normalizedExpectedMediaKey = _normalizeMediaKey(expectedMediaKey);
  return (!safeMediaKey || !normalizedExpectedMediaKey || safeMediaKey === normalizedExpectedMediaKey) && (!safeChannel || !normalizedExpectedChannel || safeChannel === normalizedExpectedChannel);
}
function _hasActiveSecondaryPlayerHandoff(channel = null, mediaKey = null) {
  if ((Number(_PlaybackIntentState.secondaryPlayerHandoffUntil) || 0) <= Date.now()) {
    if (!(_PlaybackIntentState.secondaryPlayerHandoffKind === "popout" && _PlaybackIntentState.secondaryPlayerWindows.size > 0))
      return _clearSecondaryPlayerHandoff(), !1;
    _PlaybackIntentState.secondaryPlayerHandoffUntil = Date.now() + _SECONDARY_PLAYER_HANDOFF_WINDOW_MS;
  }
  return _matchesPlaybackTargetContext(_PlaybackIntentState.secondaryPlayerHandoffChannel, _PlaybackIntentState.secondaryPlayerHandoffMediaKey, channel, mediaKey);
}
function _shouldSuppressAutomaticPlaybackResume(channel = null, mediaKey = null) {
  return _hasActiveSecondaryPlayerHandoff(channel, mediaKey) ? _PlaybackIntentState.secondaryPlayerHandoffKind !== "pip" : !1;
}
function _isPrimaryPlaybackCurrentlyActive() {
  const { player } = _getPlayerAndState(), playerCore = _getPlayerCore(player), playerVideo = player?.getHTMLVideoElement?.() || null;
  if (player && !_isPlayerPaused(player, playerCore, playerVideo) && !(playerVideo instanceof HTMLMediaElement && playerVideo.ended))
    return !0;
  const primaryMedia = _getPrimaryMediaElement();
  return !!(primaryMedia instanceof HTMLMediaElement && primaryMedia.isConnected && !primaryMedia.paused && !primaryMedia.ended);
}
function _setPlayerIsPlaying(isPlaying) {
  const nextValue = isPlaying === !0;
  __TTVAB_STATE__.PlayerIsPlaying !== nextValue && (__TTVAB_STATE__.PlayerIsPlaying = nextValue, _broadcastWorkers({
    key: "UpdatePlayerIsPlaying",
    value: nextValue
  }));
}
function _markPlayerHasPlayedOnce() {
  __TTVAB_STATE__.PlayerHasPlayedOnce || (__TTVAB_STATE__.PlayerHasPlayedOnce = !0, _broadcastWorkers({
    key: "UpdatePlayerHasPlayedOnce",
    value: !0
  }));
}
function _markSecondaryPlayerHandoff(kind = "popout", channel = null, mediaKey = null, durationMs = _SECONDARY_PLAYER_HANDOFF_WINDOW_MS, sourceWasPlaying = _isPrimaryPlaybackCurrentlyActive()) {
  if (!Number.isFinite(durationMs) || durationMs <= 0)
    return !1;
  const safeChannel = _normalizePlayerChannel(channel) || _normalizePlayerChannel(__TTVAB_STATE__.PageChannel) || null, safeMediaKey = _resolvePlayerMediaKey(channel, mediaKey), canExtendTrackedPopouts = kind === "popout" && _PlaybackIntentState.secondaryPlayerWindows.size > 0 && [..._PlaybackIntentState.secondaryPlayerWindows.values()].every((entry) => _matchesPlaybackTargetContext(entry.channel, entry.mediaKey, safeChannel, safeMediaKey)), trackedSourceWasPlaying = canExtendTrackedPopouts ? _PlaybackIntentState.secondaryPlayerHandoffSourceWasPlaying === !0 : !1;
  return canExtendTrackedPopouts || _clearSecondaryPlayerCloseMonitor(), _PlaybackIntentState.secondaryPlayerHandoffKind = kind, _PlaybackIntentState.secondaryPlayerHandoffChannel = safeChannel, _PlaybackIntentState.secondaryPlayerHandoffMediaKey = safeMediaKey, _PlaybackIntentState.secondaryPlayerHandoffUntil = Date.now() + durationMs, _PlaybackIntentState.secondaryPlayerHandoffSourceWasPlaying = sourceWasPlaying === !0 || trackedSourceWasPlaying, !0;
}
function _pausePrimaryPlaybackForSecondaryPlayerHandoff(channel = null, mediaKey = null) {
  if (!_hasActiveSecondaryPlayerHandoff(channel, mediaKey))
    return !1;
  let didPause = !1;
  const { player } = _getPlayerAndState(), playerCore = _getPlayerCore(player), playerVideo = player?.getHTMLVideoElement?.() || null;
  player && !_isPlayerPaused(player, playerCore, playerVideo) && (didPause = _pausePlaybackTarget(player) || didPause), playerVideo instanceof HTMLMediaElement && !playerVideo.paused && !playerVideo.ended && (didPause = _pausePlaybackTarget(playerVideo) || didPause);
  const primaryMedia = _getPrimaryMediaElement();
  return primaryMedia instanceof HTMLMediaElement && primaryMedia !== playerVideo && !primaryMedia.paused && !primaryMedia.ended && (didPause = _pausePlaybackTarget(primaryMedia) || didPause), didPause;
}
function _scheduleSecondaryPlayerHandoffPause(channel = null, mediaKey = null) {
  for (const delay of _SECONDARY_PLAYER_HANDOFF_PAUSE_DELAYS_MS)
    _schedulePlaybackRecoveryTimeout(() => {
      _pausePrimaryPlaybackForSecondaryPlayerHandoff(channel, mediaKey);
    }, Math.max(0, Number(delay) || 0), channel, mediaKey);
}
function _rollbackSecondaryPlayerHandoff(channel = null, mediaKey = null, sourceWasPlaying = !1) {
  if (_clearSecondaryPlayerHandoff(), sourceWasPlaying !== !0 || _hasUserPauseIntent(channel, mediaKey))
    return !1;
  for (const delay of [0, 120, 350])
    _schedulePlaybackRecoveryTimeout(() => {
      _resumePrimaryPlaybackIfPaused(channel, mediaKey);
    }, delay, channel, mediaKey);
  return !0;
}
function _monitorSecondaryPlayerWindowClose(openedWindow, descriptor, sourceWasPlaying = !1) {
  if (!openedWindow || !descriptor || String(descriptor.kind || "") !== "popout")
    return !1;
  const channel = _normalizePlayerChannel(descriptor.channel), mediaKey = _normalizeMediaKey(descriptor.mediaKey);
  if (_PlaybackIntentState.secondaryPlayerWindows.set(openedWindow, {
    channel,
    mediaKey,
    sourceWasPlaying: sourceWasPlaying === !0
  }), _PlaybackIntentState.secondaryPlayerHandoffSourceWasPlaying = _PlaybackIntentState.secondaryPlayerHandoffSourceWasPlaying === !0 || sourceWasPlaying === !0, _PlaybackIntentState.secondaryPlayerCloseMonitorId)
    return !0;
  const checkClosed = () => {
    if (_PlaybackIntentState.secondaryPlayerWindows.size === 0)
      return;
    let lastClosedEntry = null;
    for (const [trackedWindow, entry] of [
      ..._PlaybackIntentState.secondaryPlayerWindows.entries()
    ]) {
      let isClosed = !1;
      try {
        isClosed = trackedWindow.closed === !0;
      } catch {
      }
      isClosed && (_PlaybackIntentState.secondaryPlayerWindows.delete(trackedWindow), lastClosedEntry = entry);
    }
    if (!lastClosedEntry || _PlaybackIntentState.secondaryPlayerWindows.size > 0) {
      _PlaybackIntentState.secondaryPlayerHandoffUntil = Date.now() + _SECONDARY_PLAYER_HANDOFF_WINDOW_MS;
      return;
    }
    _rollbackSecondaryPlayerHandoff(lastClosedEntry.channel, lastClosedEntry.mediaKey, _PlaybackIntentState.secondaryPlayerHandoffSourceWasPlaying === !0);
  };
  return _PlaybackIntentState.secondaryPlayerCloseMonitorId = setInterval(checkClosed, _SECONDARY_PLAYER_CLOSE_POLL_MS), !0;
}
function _getSecondaryPlayerLaunchDescriptorFromUrl(rawUrl) {
  let parsedUrl = null;
  try {
    const baseUrl = typeof globalThis?.location?.href == "string" ? globalThis.location.href : "https://www.twitch.tv/";
    parsedUrl = new URL(String(rawUrl || ""), baseUrl);
  } catch {
    return null;
  }
  const hostname = String(parsedUrl.hostname || "").toLowerCase(), pathname = String(parsedUrl.pathname || "").toLowerCase();
  let kind = null, context = _normalizePlaybackContext(_getPlaybackContextFromUrl(parsedUrl.href));
  if (hostname === "player.twitch.tv") {
    const playerParam = String(parsedUrl.searchParams.get("player") || "").toLowerCase(), queryChannel = _normalizeChannelName(parsedUrl.searchParams.get("channel")), queryVideo = _normalizeVodID(parsedUrl.searchParams.get("video") || parsedUrl.searchParams.get("vod"));
    (playerParam === "popout" || queryChannel || queryVideo) && (kind = "popout", queryChannel ? context = _normalizePlaybackContext({
      MediaType: "live",
      ChannelName: queryChannel
    }) : queryVideo && (context = _normalizePlaybackContext({
      MediaType: "vod",
      VodID: queryVideo
    })));
  } else pathname.includes("/popout/") && (kind = "popout");
  return kind ? {
    kind,
    channel: _normalizePlayerChannel(context.ChannelName) || _normalizePlayerChannel(__TTVAB_STATE__.PageChannel) || null,
    mediaKey: _normalizeMediaKey(context.MediaKey) || _resolvePlayerMediaKey(context.ChannelName, context.MediaKey)
  } : null;
}
function _beginSecondaryPlayerHandoff(descriptor, options = {}) {
  if (!descriptor || typeof descriptor != "object")
    return !1;
  const shouldPauseSource = options.pauseSource !== !1 && String(descriptor.kind || "") !== "pip", sourceWasPlaying = typeof options.sourceWasPlaying == "boolean" ? options.sourceWasPlaying : _isPrimaryPlaybackCurrentlyActive();
  return _markSecondaryPlayerHandoff(String(descriptor.kind || "popout"), descriptor.channel || null, descriptor.mediaKey || null, _SECONDARY_PLAYER_HANDOFF_WINDOW_MS, sourceWasPlaying) ? (String(descriptor.kind || "") !== "pip" && _clearAdResumeIntent(), shouldPauseSource && _scheduleSecondaryPlayerHandoffPause(descriptor.channel || null, descriptor.mediaKey || null), !0) : !1;
}
function _doesActiveAdTargetPlayback(channel = null, mediaKey = null) {
  const expectedChannel = _normalizePlayerChannel(__TTVAB_STATE__.CurrentAdChannel), expectedMediaKey = _normalizeMediaKey(__TTVAB_STATE__.CurrentAdMediaKey);
  return !expectedChannel && !expectedMediaKey ? !1 : _matchesPlaybackTargetContext(expectedChannel, expectedMediaKey, channel, mediaKey);
}
function _doesResumeIntentTargetPlayback(channel = null, mediaKey = null) {
  if (__TTVAB_STATE__.ShouldResumeAfterAd !== !0)
    return !1;
  const expectedChannel = _normalizePlayerChannel(__TTVAB_STATE__.ShouldResumeAfterAdChannel), expectedMediaKey = _normalizeMediaKey(__TTVAB_STATE__.ShouldResumeAfterAdMediaKey);
  return !expectedChannel && !expectedMediaKey ? !1 : _matchesPlaybackTargetContext(expectedChannel, expectedMediaKey, channel, mediaKey);
}
function _isAdOwnedPauseContext(channel = null, mediaKey = null) {
  return _isPauseIntentSuppressed(channel, mediaKey) || _doesActiveAdTargetPlayback(channel, mediaKey) || _doesResumeIntentTargetPlayback(channel, mediaKey);
}
function _pausePlaybackTarget(target) {
  _markProgrammaticPause();
  try {
    return target?.pause?.(), !0;
  } catch {
    return !1;
  }
}
function _playPlaybackTarget(target, channel = null, mediaKey = null) {
  if (_hasUserPauseIntent(channel, mediaKey))
    return !1;
  _markProgrammaticPlay();
  try {
    const playResult = target?.play?.();
    return typeof playResult?.catch == "function" && playResult.catch(() => {
    }), !0;
  } catch {
    return !1;
  }
}
function _isEditablePlaybackInteractionTarget(target) {
  return target instanceof Element ? target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target instanceof HTMLElement && target.isContentEditable ? !0 : !!target.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])') : !1;
}
function _hasPlaybackControlAriaLabel(node) {
  if (!(node instanceof Element))
    return !1;
  const ariaLabel = node.getAttribute?.("aria-label")?.toLowerCase() || "";
  return ariaLabel.includes("pause") || ariaLabel.includes("play") || ariaLabel.includes("resume");
}
function _isPlaybackControlInteractionNode(node) {
  return node instanceof Element ? node.matches?.(_PLAYER_CONTROL_INTERACTION_SELECTOR) || _hasPlaybackControlAriaLabel(node) : !1;
}
function _isLikelyPlaybackControlInteraction(event) {
  if (!event || typeof event != "object")
    return !1;
  if (event.type === "keydown") {
    if (_isEditablePlaybackInteractionTarget(event.target))
      return !1;
    const key = typeof event.key == "string" ? event.key.toLowerCase() : "", code = typeof event.code == "string" ? event.code : "";
    return code === "Space" || code === "KeyK" || key === " " || key === "spacebar" || key === "k" || key === "mediaplaypause";
  }
  if (typeof event.button == "number" && event.button !== 0 && event.pointerType !== "touch" && event.pointerType !== "pen")
    return !1;
  const target = event.target;
  if (!(target instanceof Element) || _isEditablePlaybackInteractionTarget(target))
    return !1;
  if (target.closest?.(_PLAYER_CONTROL_INTERACTION_SELECTOR))
    return !0;
  const controlTarget = target.closest?.("button, [role='button']");
  if (_hasPlaybackControlAriaLabel(controlTarget))
    return !0;
  const path = typeof event.composedPath == "function" ? event.composedPath() : [];
  for (const node of path)
    if (_isPlaybackControlInteractionNode(node))
      return !0;
  return !1;
}
function _initPlaybackControlInteractionMonitor() {
  if (_hookMediaSessionPlaybackIntent(), _PlaybackIntentState.interactionMonitorInitialized || typeof window > "u")
    return;
  const rememberInteraction = (event) => {
    _isLikelyPlaybackControlInteraction(event) && (_clearSecondaryPlayerHandoff(), _rememberRecentPlaybackControlInteraction(null, _normalizeMediaKey(__TTVAB_STATE__.PageMediaKey)));
  };
  window.addEventListener("pointerdown", rememberInteraction, !0), window.addEventListener("keydown", rememberInteraction, !0), _PlaybackIntentState.interactionMonitorInitialized = !0;
}
function _syncPrimaryMediaPlaybackIntent() {
  const currentVideo = _getPlayerAndState().player?.getHTMLVideoElement?.();
  currentVideo instanceof HTMLMediaElement && currentVideo.isConnected && currentVideo !== _cachedPrimaryMediaElement && _clearCachedPrimaryMediaElement();
  const media = _getPrimaryMediaElement(), mediaKey = _normalizeMediaKey(__TTVAB_STATE__.PageMediaKey), pageGeneration = Number(__TTVAB_STATE__.PagePlaybackContextGeneration) || 0;
  if (media === _PlaybackIntentState.observedMedia && mediaKey === _PlaybackIntentState.observedMediaKey && pageGeneration === _PlaybackIntentState.observedPageGeneration || (_clearObservedPlaybackIntentMedia(), !(media instanceof HTMLMediaElement)))
    return;
  const isPlaying = !media.paused && !media.ended;
  _setPlayerIsPlaying(isPlaying), isPlaying && _markPlayerHasPlayedOnce();
  const isCurrent = () => !media.isConnected || _normalizeMediaKey(__TTVAB_STATE__.PageMediaKey) !== mediaKey || (Number(__TTVAB_STATE__.PagePlaybackContextGeneration) || 0) !== pageGeneration ? !1 : (_getPlayerAndState().player?.getHTMLVideoElement?.() || _getPrimaryMediaElement()) === media, handlePause = () => {
    if (document.documentElement?.dataset.drophunterPlaybackSuspended === window.location.href)
      return;
    if (!isCurrent() || (_setPlayerIsPlaying(!1), _wasRecentProgrammaticPlaybackAction("pause")) || media.ended || !media.isConnected)
      return;
    const currentPrimaryMedia = _getPrimaryMediaElement();
    if (currentPrimaryMedia instanceof HTMLMediaElement && currentPrimaryMedia !== media)
      return;
    const mediaKey2 = _resolvePlayerMediaKey(null, __TTVAB_STATE__.PageMediaKey);
    if (!mediaKey2)
      return;
    const hadExplicitInteraction = _hasRecentPlaybackControlInteraction(null, mediaKey2);
    if (!hadExplicitInteraction && _isObservedCleanPlaybackFailure(media))
      return;
    const wasDuringAd = _isAdOwnedPauseContext(null, mediaKey2);
    if (wasDuringAd && !hadExplicitInteraction) {
      _isUnfocusedPlaybackEnvironment() && _resumeActivePlayerAfterAd(__TTVAB_STATE__.PageChannel, mediaKey2);
      return;
    }
    if (!hadExplicitInteraction && _isUnfocusedPlaybackEnvironment()) {
      _resumePrimaryPlaybackIfPaused(__TTVAB_STATE__.PageChannel, mediaKey2);
      return;
    }
    _PlaybackIntentState.userPausedMediaKey = mediaKey2, _PlaybackIntentState.userPausedAt = Date.now(), _PlaybackIntentState.userPausedHadExplicitInteraction = hadExplicitInteraction, _PlaybackIntentState.userPausedDuringAd = wasDuringAd;
  }, handlePlay = () => {
    isCurrent() && (_setPlayerIsPlaying(!0), _markPlayerHasPlayedOnce(), !_wasRecentProgrammaticPlaybackAction("play") && (_clearSecondaryPlayerHandoff(), _clearUserPauseIntent(null, __TTVAB_STATE__.PageMediaKey)));
  };
  media.addEventListener("pause", handlePause, !0), media.addEventListener("play", handlePlay, !0), _PlaybackIntentState.observedMedia = media, _PlaybackIntentState.observedMediaKey = mediaKey, _PlaybackIntentState.observedPageGeneration = pageGeneration, _PlaybackIntentState.pauseListener = handlePause, _PlaybackIntentState.playListener = handlePlay;
}
function _clearObservedPlaybackIntentMedia() {
  _PlaybackIntentState.observedMedia && (_PlaybackIntentState.pauseListener && _PlaybackIntentState.observedMedia.removeEventListener("pause", _PlaybackIntentState.pauseListener, !0), _PlaybackIntentState.playListener && _PlaybackIntentState.observedMedia.removeEventListener("play", _PlaybackIntentState.playListener, !0)), _PlaybackIntentState.observedMedia = null, _PlaybackIntentState.observedMediaKey = null, _PlaybackIntentState.observedPageGeneration = 0, _PlaybackIntentState.pauseListener = null, _PlaybackIntentState.playListener = null;
}
function _monitorPlaybackIntent() {
  let lastSyncedMediaKey = null, lastSyncAttemptAt = 0;
  _initPlaybackControlInteractionMonitor();
  function check() {
    _playbackIntentMonitorTimer = null;
    let nextDelay = _PLAYBACK_INTENT_MONITOR_DELAY_MS;
    try {
      const hasRelevantContext = _hasPlaybackIntentMonitorRelevantContext(), currentMediaKey = _normalizeMediaKey(__TTVAB_STATE__.PageMediaKey), observedMedia = _PlaybackIntentState.observedMedia, didLoseObservedMedia = !!(observedMedia && !observedMedia.isConnected), idleSyncDelay = currentMediaKey ? _PLAYBACK_INTENT_IDLE_SYNC_DELAY_MS : _PLAYBACK_INTENT_NO_MEDIA_ROUTE_DELAY_MS, isHidden = _isNativeDocumentHidden(), hiddenSyncDelay = Math.max(idleSyncDelay, 5e3), syncDelay = isHidden ? hiddenSyncDelay : idleSyncDelay, now = Date.now();
      hasRelevantContext || (_syncPrimaryMediaPlaybackIntent(), nextDelay = syncDelay), (currentMediaKey !== lastSyncedMediaKey || didLoseObservedMedia || now - lastSyncAttemptAt >= syncDelay) && (lastSyncAttemptAt = now, _syncPrimaryMediaPlaybackIntent(), lastSyncedMediaKey = currentMediaKey), nextDelay = _PlaybackIntentState.observedMedia?.isConnected ? isHidden ? hiddenSyncDelay : _PLAYBACK_INTENT_MONITOR_DELAY_MS : syncDelay, currentMediaKey && _PlaybackIntentState.userPausedMediaKey && _PlaybackIntentState.userPausedMediaKey !== currentMediaKey && _clearRecordedUserPauseIntent(), _PlaybackIntentState.suppressedPauseMediaKey && currentMediaKey && _PlaybackIntentState.suppressedPauseMediaKey !== currentMediaKey && (_PlaybackIntentState.suppressedPauseMediaKey = null, _PlaybackIntentState.suppressedPauseUntil = 0);
    } catch {
    }
    _playbackIntentMonitorTimer = setTimeout(check, nextDelay);
  }
  check();
}
function _hasLikelyPlaybackSurface() {
  const primaryMedia = _getPrimaryMediaElement();
  if (primaryMedia instanceof HTMLMediaElement && primaryMedia.isConnected)
    return !0;
  const { player } = _getPlayerAndState(), playerVideo = player?.getHTMLVideoElement?.() || null;
  return playerVideo instanceof HTMLMediaElement && playerVideo.isConnected;
}
function _hasPlaybackIntentMonitorRelevantContext() {
  if (typeof __TTVAB_STATE__ > "u" || !__TTVAB_STATE__)
    return !1;
  const currentMediaKey = _normalizeMediaKey(__TTVAB_STATE__.PageMediaKey), hasLiveOrVodContext = (__TTVAB_STATE__.PageMediaType === "live" || __TTVAB_STATE__.PageMediaType === "vod") && !!currentMediaKey, hasActiveAdContext = !!(__TTVAB_STATE__.CurrentAdMediaKey || __TTVAB_STATE__.CurrentAdChannel), hasPendingPostAdRecovery = _hasPendingAdResumeIntent(__TTVAB_STATE__.PageChannel, currentMediaKey), hasSecondaryPlayerHandoff = _hasActiveSecondaryPlayerHandoff(__TTVAB_STATE__.PageChannel, currentMediaKey);
  return hasLiveOrVodContext || hasActiveAdContext || hasPendingPostAdRecovery || hasSecondaryPlayerHandoff || _hasLikelyPlaybackSurface();
}
function _hasPlayerBufferMonitorRelevantContext() {
  if (typeof __TTVAB_STATE__ > "u" || !__TTVAB_STATE__)
    return !1;
  const currentMediaKey = _normalizeMediaKey(__TTVAB_STATE__.PageMediaKey), hasLivePlaybackContext = __TTVAB_STATE__.PageMediaType === "live" && !!currentMediaKey, hasActiveAdContext = !!(__TTVAB_STATE__.CurrentAdMediaKey || __TTVAB_STATE__.CurrentAdChannel), hasPendingPostAdRecovery = _hasPendingAdResumeIntent(__TTVAB_STATE__.PageChannel, currentMediaKey), hasSecondaryPlayerHandoff = _hasActiveSecondaryPlayerHandoff(__TTVAB_STATE__.PageChannel, currentMediaKey);
  return hasLivePlaybackContext || hasActiveAdContext || hasPendingPostAdRecovery || hasSecondaryPlayerHandoff;
}
function _ensurePlaybackMonitorsRunning(forceStart = !1) {
  let didStart = !1;
  return !_playbackIntentMonitorStarted && (forceStart || _hasPlaybackIntentMonitorRelevantContext()) && (_playbackIntentMonitorStarted = !0, _monitorPlaybackIntent(), didStart = !0), !_playerBufferMonitorStarted && _C.BUFFERING_FIX && (forceStart || __TTVAB_STATE__.IsBufferFixEnabled === !0 && _hasPlayerBufferMonitorRelevantContext()) && (_playerBufferMonitorStarted = !0, _monitorPlayerBuffering(), didStart = !0), didStart;
}
const _INDEPENDENT_VIDEO_AD_SELECTOR = "video";
const _INDEPENDENT_VIDEO_AD_LABEL = "video advertisement";
const _INDEPENDENT_VIDEO_AD_LABEL_PREFIX = "this advertisement";
const _INDEPENDENT_VIDEO_AD_STYLE_ID = "ttvab-independent-video-ad-style";
const _INDEPENDENT_VIDEO_AD_SUPPRESSED_ATTRIBUTE = "data-ttvab-independent-ad-suppressed";
const _INDEPENDENT_VIDEO_AD_CONTAINER_ATTRIBUTE = "data-ttvab-independent-ad-container";
const _INDEPENDENT_VIDEO_AD_CONTAINER_MAX_DEPTH = 4;
const _INDEPENDENT_VIDEO_AD_CONTAINER_BOUNDARY_SELECTOR = [
    "main",
    "#root",
    ".chat-shell",
    ".stream-chat",
    ".channel-root",
    ".persistent-player",
    ".video-player",
    ".stream-display-ad__wrapper",
    '[data-a-target="video-player"]',
    '[data-a-target="chat-scroller"]',
    '[data-a-target="chat-input"]',
    '[data-a-target="side-nav-bar"]',
    '[data-test-selector="chat-scrollable-area__message-container"]'
].join(",");
const _INDEPENDENT_VIDEO_AD_DETACHED_GRACE_MS = 1e4;
const _IndependentVideoAdSuppressionState = {
    observer: null,
    pruneTimeoutId: null,
    suppressedMedia: /* @__PURE__ */ new Map(),
    suppressedContainers: /* @__PURE__ */ new Map()
};
function _isIndependentVideoAdGuardEnabled() {
  return __TTVAB_STATE__?.IsAdStrippingEnabled === !0;
}
function _ensureIndependentVideoAdStyle() {
  if (typeof document > "u")
    return !1;
  if (document.getElementById(_INDEPENDENT_VIDEO_AD_STYLE_ID))
    return !0;
  if (!document.head)
    return !1;
  const style = document.createElement("style");
  return style.id = _INDEPENDENT_VIDEO_AD_STYLE_ID, style.textContent = [
    'video[data-ttvab-independent-ad-suppressed="true"]{display:none!important;visibility:hidden!important;pointer-events:none!important}',
    '[data-ttvab-independent-ad-container="true"]{display:none!important}',
    '.stream-display-ad__wrapper + div > div[style^="position:"] > div[class^="Layout-sc-"]:has(video[src^="https://m.media-amazon.com"]){display:none!important}',
    '.chat-shell > div[class^="Layout-sc-"] > div[style^="transition:"]:has(video[src^="https://m.media-amazon.com"]){display:none!important}'
  ].join(""), document.head.appendChild(style), !0;
}
function _getPrimaryPlayerVideoMatch(media) {
  if (!(media instanceof HTMLVideoElement) || typeof _getPlayerAndState != "function")
    return null;
  try {
    const { player } = _getPlayerAndState(), primaryMedia = player?.getHTMLVideoElement?.();
    return primaryMedia instanceof HTMLVideoElement ? primaryMedia === media : null;
  } catch {
    return null;
  }
}
function _hasKnownIndependentVideoAdSource(media) {
  if (!(media instanceof HTMLVideoElement))
    return !1;
  const sources = [
    media.currentSrc,
    media.getAttribute("src"),
    ...Array.from(media.querySelectorAll("source[src]"), (source) => source.getAttribute("src"))
  ];
  for (const source of sources)
    if (source)
      try {
        const hostname = new URL(source, globalThis.location?.href || "https://www.twitch.tv/").hostname.toLowerCase();
        if (hostname === "media-amazon.com" || hostname.endsWith(".media-amazon.com"))
          return !0;
      } catch {
      }
  return !1;
}
function _hasIndependentVideoAdLabel(media) {
  if (!(media instanceof HTMLVideoElement))
    return !1;
  const label = media.getAttribute("aria-label")?.trim().toLowerCase();
  return label ? label === _INDEPENDENT_VIDEO_AD_LABEL || label.startsWith(_INDEPENDENT_VIDEO_AD_LABEL_PREFIX) : !1;
}
function _hasBlobMediaSource(media) {
  return media instanceof HTMLVideoElement ? (media.currentSrc || media.getAttribute("src") || "").startsWith("blob:") : !1;
}
function _isIndependentVideoAd(media) {
  if (!_isIndependentVideoAdGuardEnabled() || !(media instanceof HTMLVideoElement))
    return !1;
  if (_hasKnownIndependentVideoAdSource(media))
    return !0;
  const primaryMatch = _getPrimaryPlayerVideoMatch(media);
  return primaryMatch === !0 ? !1 : primaryMatch === !1 && !_hasBlobMediaSource(media) && _hasIndependentVideoAdLabel(media);
}
function _isIndependentVideoAdContainerBoundary(element, media) {
  if (!(element instanceof HTMLElement) || element === document.body || element === document.documentElement || !element.parentElement)
    return !0;
  try {
    if (element.matches(_INDEPENDENT_VIDEO_AD_CONTAINER_BOUNDARY_SELECTOR) || element.querySelector(_INDEPENDENT_VIDEO_AD_CONTAINER_BOUNDARY_SELECTOR))
      return !0;
    for (const candidate of element.querySelectorAll("video"))
      if (candidate !== media && !candidate.hasAttribute(_INDEPENDENT_VIDEO_AD_SUPPRESSED_ATTRIBUTE))
        return !0;
  } catch {
    return !0;
  }
  return !1;
}
function _findIndependentVideoAdContainer(media) {
  if (!(media instanceof HTMLVideoElement))
    return null;
  let container = media.parentElement;
  if (_isIndependentVideoAdContainerBoundary(container, media))
    return null;
  for (let depth = 1; depth < _INDEPENDENT_VIDEO_AD_CONTAINER_MAX_DEPTH; depth += 1) {
    const parent = container.parentElement;
    if (parent?.childElementCount !== 1 || _isIndependentVideoAdContainerBoundary(parent, media))
      break;
    container = parent;
  }
  return container;
}
function _isIndependentVideoAdContainerReferenced(container, ignoredMedia) {
  for (const [media, state] of _IndependentVideoAdSuppressionState.suppressedMedia)
    if (media !== ignoredMedia && state.container === container)
      return !0;
  return !1;
}
function _suppressIndependentVideoAdContainer(container) {
  return container instanceof HTMLElement ? _IndependentVideoAdSuppressionState.suppressedContainers.has(container) ? (container.getAttribute(_INDEPENDENT_VIDEO_AD_CONTAINER_ATTRIBUTE) !== "true" && container.setAttribute(_INDEPENDENT_VIDEO_AD_CONTAINER_ATTRIBUTE, "true"), container.style.setProperty("display", "none", "important"), !0) : (_IndependentVideoAdSuppressionState.suppressedContainers.set(container, {
    display: {
      value: container.style.getPropertyValue("display"),
      priority: container.style.getPropertyPriority("display")
    }
  }), container.style.setProperty("display", "none", "important"), container.setAttribute(_INDEPENDENT_VIDEO_AD_CONTAINER_ATTRIBUTE, "true"), !0) : !1;
}
function _releaseIndependentVideoAdContainer(container, ignoredMedia) {
  if (!(container instanceof HTMLElement))
    return !1;
  const state = _IndependentVideoAdSuppressionState.suppressedContainers.get(container);
  return !state || _isIndependentVideoAdContainerReferenced(container, ignoredMedia) ? !1 : (_restoreIndependentVideoAdStyle(container, "display", state.display), container.removeAttribute(_INDEPENDENT_VIDEO_AD_CONTAINER_ATTRIBUTE), _IndependentVideoAdSuppressionState.suppressedContainers.delete(container), !0);
}
function _syncIndependentVideoAdContainer(media, state) {
  let container = state.container;
  return (!container?.isConnected || !container.contains(media)) && (container = _findIndependentVideoAdContainer(media), state.container && state.container !== container && _releaseIndependentVideoAdContainer(state.container, media), state.container = container), container && _suppressIndependentVideoAdContainer(container), container;
}
function _restoreIndependentVideoAdStyle(media, property, state) {
  state.value ? media.style.setProperty(property, state.value, state.priority) : media.style.removeProperty(property);
}
function _restoreIndependentVideoAd(media) {
  if (!(media instanceof HTMLVideoElement))
    return !1;
  const state = _IndependentVideoAdSuppressionState.suppressedMedia.get(media);
  if (!state)
    return !1;
  try {
    return _restoreIndependentVideoAdStyle(media, "display", state.display), _restoreIndependentVideoAdStyle(media, "visibility", state.visibility), _restoreIndependentVideoAdStyle(media, "pointer-events", state.pointerEvents), media.defaultMuted = state.defaultMuted, media.muted = state.muted, media.volume = state.volume, media.removeAttribute(_INDEPENDENT_VIDEO_AD_SUPPRESSED_ATTRIBUTE), _IndependentVideoAdSuppressionState.suppressedMedia.delete(media), state.container && _releaseIndependentVideoAdContainer(state.container, media), !0;
  } catch {
    return !1;
  }
}
function _suppressIndependentVideoAd(media) {
  if (!_isIndependentVideoAd(media))
    return _restoreIndependentVideoAd(media), !1;
  try {
    const alreadySuppressed = _IndependentVideoAdSuppressionState.suppressedMedia.has(media);
    alreadySuppressed || _IndependentVideoAdSuppressionState.suppressedMedia.set(media, {
      display: {
        value: media.style.getPropertyValue("display"),
        priority: media.style.getPropertyPriority("display")
      },
      visibility: {
        value: media.style.getPropertyValue("visibility"),
        priority: media.style.getPropertyPriority("visibility")
      },
      pointerEvents: {
        value: media.style.getPropertyValue("pointer-events"),
        priority: media.style.getPropertyPriority("pointer-events")
      },
      defaultMuted: media.defaultMuted,
      muted: media.muted,
      volume: media.volume,
      detachedAt: null,
      container: null
    });
    const isNewSuppression = !alreadySuppressed && !media.hasAttribute(_INDEPENDENT_VIDEO_AD_SUPPRESSED_ATTRIBUTE);
    return media.style.setProperty("display", "none", "important"), media.style.setProperty("visibility", "hidden", "important"), media.style.setProperty("pointer-events", "none", "important"), media.defaultMuted || (media.defaultMuted = !0), media.muted || (media.muted = !0), media.volume !== 0 && (media.volume = 0), media.setAttribute(_INDEPENDENT_VIDEO_AD_SUPPRESSED_ATTRIBUTE, "true"), _syncIndependentVideoAdContainer(media, _IndependentVideoAdSuppressionState.suppressedMedia.get(media)), !0;
  } catch {
    return _restoreIndependentVideoAd(media), !1;
  }
}
function _suppressIndependentVideoAdsInDocument(root = document) {
  if (!root?.querySelectorAll)
    return 0;
  let suppressedCount = 0;
  for (const media of root.querySelectorAll(_INDEPENDENT_VIDEO_AD_SELECTOR))
    _suppressIndependentVideoAd(media) && (suppressedCount += 1);
  return suppressedCount;
}
function _restoreIndependentVideoAds() {
  _clearIndependentVideoAdPruneTimer();
  let restoredCount = 0;
  for (const media of [
    ..._IndependentVideoAdSuppressionState.suppressedMedia.keys()
  ]) {
    if (!media.isConnected)
      try {
        media.pause();
      } catch {
      }
    _restoreIndependentVideoAd(media) && (restoredCount += 1);
  }
  for (const container of [
    ..._IndependentVideoAdSuppressionState.suppressedContainers.keys()
  ])
    _releaseIndependentVideoAdContainer(container, null);
  return restoredCount;
}
function _clearIndependentVideoAdPruneTimer() {
  _IndependentVideoAdSuppressionState.pruneTimeoutId && clearTimeout(_IndependentVideoAdSuppressionState.pruneTimeoutId), _IndependentVideoAdSuppressionState.pruneTimeoutId = null;
}
function _scheduleIndependentVideoAdPrune(delay) {
  _clearIndependentVideoAdPruneTimer(), _IndependentVideoAdSuppressionState.pruneTimeoutId = setTimeout(() => {
    _IndependentVideoAdSuppressionState.pruneTimeoutId = null, _pruneIndependentVideoAdSuppressions();
  }, Math.max(0, delay));
}
function _pruneIndependentVideoAdSuppressions() {
  let prunedCount = 0;
  const now = Date.now();
  let nextPruneDelay = null;
  for (const [media, state] of [
    ..._IndependentVideoAdSuppressionState.suppressedMedia.entries()
  ]) {
    if (media.isConnected) {
      state.detachedAt = null;
      continue;
    }
    typeof state.detachedAt != "number" && (state.detachedAt = now);
    const remainingGrace = _INDEPENDENT_VIDEO_AD_DETACHED_GRACE_MS - (now - state.detachedAt);
    if (remainingGrace > 0) {
      nextPruneDelay = nextPruneDelay === null ? remainingGrace : Math.min(nextPruneDelay, remainingGrace);
      continue;
    }
    try {
      media.pause();
    } catch {
    }
    _IndependentVideoAdSuppressionState.suppressedMedia.delete(media), state.container && _releaseIndependentVideoAdContainer(state.container, media), prunedCount += 1;
  }
  return _clearIndependentVideoAdPruneTimer(), nextPruneDelay !== null && _scheduleIndependentVideoAdPrune(nextPruneDelay), prunedCount;
}
function _setIndependentVideoAdGuardEnabled(enabled) {
  if (typeof document > "u")
    return !1;
  if (!enabled)
    return _IndependentVideoAdSuppressionState.observer?.disconnect(), _IndependentVideoAdSuppressionState.observer = null, document.getElementById(_INDEPENDENT_VIDEO_AD_STYLE_ID)?.remove(), _restoreIndependentVideoAds(), !0;
  _installIndependentVideoAdObserver();
  const didInstallStyle = _ensureIndependentVideoAdStyle();
  return _suppressIndependentVideoAdsInDocument(), didInstallStyle;
}
function _handleIndependentVideoAdMediaEvent(event) {
  _suppressIndependentVideoAd(event.target);
}
function _suppressIndependentVideoAdsForNode(node) {
  if (node instanceof HTMLVideoElement)
    return _suppressIndependentVideoAd(node) ? 1 : 0;
  if (!(node instanceof Element))
    return 0;
  let suppressedCount = 0;
  const parentMedia = node.closest("video");
  return parentMedia instanceof HTMLVideoElement && _suppressIndependentVideoAd(parentMedia) && (suppressedCount += 1), suppressedCount + _suppressIndependentVideoAdsInDocument(node);
}
function _handleIndependentVideoAdMutations(records) {
  if (_isIndependentVideoAdGuardEnabled()) {
    for (const record of records) {
      if (record.type === "attributes") {
        _suppressIndependentVideoAdsForNode(record.target);
        continue;
      }
      for (const node of record.addedNodes)
        _suppressIndependentVideoAdsForNode(node);
    }
    _pruneIndependentVideoAdSuppressions();
  }
}
function _installIndependentVideoAdObserver() {
  if (_IndependentVideoAdSuppressionState.observer)
    return !0;
  if (typeof MutationObserver != "function")
    return !1;
  const observer = new MutationObserver(_handleIndependentVideoAdMutations);
  return observer.observe(document, {
    childList: !0,
    subtree: !0,
    attributes: !0,
    attributeFilter: [
      "aria-label",
      "src",
      _INDEPENDENT_VIDEO_AD_CONTAINER_ATTRIBUTE
    ]
  }), _IndependentVideoAdSuppressionState.observer = observer, !0;
}
function _hookIndependentVideoAdGuard() {
  if (!(typeof document > "u" || typeof window > "u" || window.__TTVAB_INDEPENDENT_VIDEO_AD_GUARD__)) {
    !_setIndependentVideoAdGuardEnabled(_isIndependentVideoAdGuardEnabled()) && document.readyState === "loading" && document.addEventListener("DOMContentLoaded", () => {
      _setIndependentVideoAdGuardEnabled(_isIndependentVideoAdGuardEnabled());
    }, { once: !0 });
    for (const eventName of ["play", "playing", "volumechange"])
      document.addEventListener(eventName, _handleIndependentVideoAdMediaEvent, !0);
    window.__TTVAB_INDEPENDENT_VIDEO_AD_GUARD__ = !0;
  }
}
function _hookSecondaryPlayerHandoffDetection() {
  if (!(_PlaybackIntentState.secondaryPlayerLaunchMonitorInitialized || typeof window > "u")) {
    if (!window.__TTVAB_WINDOW_OPEN_PATCHED__) {
      const nativeOpen = window.open;
      try {
        window.open = function(...args) {
          let descriptor = null, sourceWasPlaying = !1;
          try {
            descriptor = _getSecondaryPlayerLaunchDescriptorFromUrl(args[0]), sourceWasPlaying = descriptor ? _isPrimaryPlaybackCurrentlyActive() : !1;
          } catch {
          }
          const openedWindow = nativeOpen.apply(this, args);
          try {
            descriptor && (openedWindow ? _beginSecondaryPlayerHandoff(descriptor, {
              sourceWasPlaying,
              pauseSource: descriptor.kind !== "pip"
            }) && _monitorSecondaryPlayerWindowClose(openedWindow, descriptor, sourceWasPlaying) : _rollbackSecondaryPlayerHandoff(descriptor.channel || null, descriptor.mediaKey || null, !1));
          } catch {
          }
          return openedWindow;
        }, window.__TTVAB_WINDOW_OPEN_PATCHED__ = !0;
      } catch {
      }
    }
    if (!window.__TTVAB_REQUEST_PIP_PATCHED__) {
      const nativeRequestPictureInPicture = HTMLVideoElement?.prototype?.requestPictureInPicture;
      if (typeof nativeRequestPictureInPicture == "function")
        try {
          HTMLVideoElement.prototype.requestPictureInPicture = function(...args) {
            const requestedContext = _getPictureInPicturePlaybackContext(this), result = nativeRequestPictureInPicture.apply(this, args);
            return typeof result?.then == "function" ? result.then((value) => {
              try {
                if (!requestedContext || document.pictureInPictureElement !== this)
                  return value;
                const activeContext = _setActivePictureInPicturePlaybackContext(this, requestedContext);
                if (!activeContext)
                  return value;
                const descriptor = {
                  kind: "pip",
                  channel: activeContext.ChannelName,
                  mediaKey: activeContext.MediaKey
                };
                _beginSecondaryPlayerHandoff(descriptor, {
                  pauseSource: !1,
                  sourceWasPlaying: _isPrimaryPlaybackCurrentlyActive()
                });
              } catch {
              }
              return value;
            }) : result;
          }, window.__TTVAB_REQUEST_PIP_PATCHED__ = !0;
        } catch {
        }
    }
    document.addEventListener("enterpictureinpicture", (event) => {
      const activeContext = _setActivePictureInPicturePlaybackContext(event.target);
      activeContext && _beginSecondaryPlayerHandoff({
        kind: "pip",
        channel: activeContext.ChannelName,
        mediaKey: activeContext.MediaKey
      }, {
        pauseSource: !1,
        sourceWasPlaying: _isPrimaryPlaybackCurrentlyActive()
      });
    }, !0), window.addEventListener("pagehide", _clearSecondaryPlayerHandoff), _setActivePictureInPicturePlaybackContext(document.pictureInPictureElement), _PlaybackIntentState.secondaryPlayerLaunchMonitorInitialized = !0;
  }
}
function _resumeActivePlayerIfPaused(channel = null, mediaKey = null) {
  const safeChannel = _normalizePlayerChannel(channel), safeMediaKey = _resolvePlayerMediaKey(channel, mediaKey);
  if (_hasUserPauseIntent(safeChannel, safeMediaKey) || _shouldSuppressAutomaticPlaybackResume(safeChannel, safeMediaKey))
    return !1;
  const pipContext = _getActivePictureInPicturePlaybackContext();
  if (pipContext && _isActivePictureInPicturePlaybackContext({
    ChannelName: safeChannel,
    MediaKey: safeMediaKey
  })) {
    const pipWorker = pipContext.workerRef?.deref?.();
    return pipWorker?.__TTVABCrashed === !0 || pipWorker?.__TTVABIntentionallyTerminated === !0 || pipContext.element.ended || !pipContext.element.paused ? !1 : _playPlaybackTarget(pipContext.element, pipContext.ChannelName, pipContext.MediaKey);
  }
  const { player, state: playerState } = _getPlayerAndState();
  if (!player || !playerState?.props?.content)
    return !1;
  const playerCore = _getPlayerCore(player), video = player.getHTMLVideoElement?.() || null;
  return video?.ended || !_isPlayerPaused(player, playerCore, video) ? !1 : _playPlaybackTarget(player, safeChannel, safeMediaKey);
}
function _resumePrimaryPlaybackIfPaused(channel = null, mediaKey = null) {
  const safeChannel = _normalizePlayerChannel(channel), safeMediaKey = _resolvePlayerMediaKey(channel, mediaKey);
  if (_hasUserPauseIntent(safeChannel, safeMediaKey) || _shouldSuppressAutomaticPlaybackResume(safeChannel, safeMediaKey))
    return !1;
  if (_resumeActivePlayerIfPaused(safeChannel, safeMediaKey))
    return !0;
  const media = _getPrimaryMediaElement();
  return !(media instanceof HTMLMediaElement) || !media.isConnected || media.ended || !media.paused ? !1 : _playPlaybackTarget(media, safeChannel, safeMediaKey);
}
function _guardPlaybackAcrossVisibilityTransition(channel = null, mediaKey = null) {
  const safeChannel = _normalizePlayerChannel(channel), safeMediaKey = _resolvePlayerMediaKey(channel, mediaKey);
  if (!safeMediaKey || _shouldSuppressAutomaticPlaybackResume(safeChannel, safeMediaKey))
    return;
  const retryDelays = _isNativeDocumentHidden() ? _HIDDEN_VISIBILITY_RESUME_RETRY_DELAYS_MS : _VISIBILITY_RESUME_RETRY_DELAYS_MS;
  _PostAdRecoveryTransactionState.mediaKey && (_maintainPostAdRecoveryTransactionLifetime(), _tryRunPendingPostAdRecoveryOperation(safeChannel, safeMediaKey)), _resumePrimaryPlaybackIfPaused(safeChannel, safeMediaKey);
  for (const delay of retryDelays)
    _schedulePlaybackRecoveryTimeout(() => {
      _PostAdRecoveryTransactionState.mediaKey && (_maintainPostAdRecoveryTransactionLifetime(), _tryRunPendingPostAdRecoveryOperation(safeChannel, safeMediaKey)), _resumePrimaryPlaybackIfPaused(safeChannel, safeMediaKey);
    }, delay, safeChannel, safeMediaKey);
}
function _scheduleResumeRetries(channel = null, mediaKey = null, delays = [120, 350, 900], options = {}) {
  if (!(!Array.isArray(delays) || delays.length === 0))
    for (const delay of delays)
      !Number.isFinite(delay) || delay < 0 || _schedulePlaybackRecoveryTimeout(() => {
        options.requireAdResumeIntent && !_canAttemptAdResume(channel, mediaKey) || _resumeActivePlayerIfPaused(channel, mediaKey);
      }, delay, channel, mediaKey, Math.max(0, Number(options.cycleStartedAt) || 0));
}
function _getFallbackPrimaryVideoElement() {
  const videos = Array.from(document.querySelectorAll("video"));
  let bestVideo = null, bestArea = 0;
  for (const video of videos) {
    if (!(video instanceof HTMLMediaElement))
      continue;
    const rect = video.getBoundingClientRect(), area = Math.max(0, rect.width) * Math.max(0, rect.height);
    area <= 0 || area > bestArea && (bestArea = area, bestVideo = video);
  }
  return bestVideo;
}
let _cachedPrimaryMediaElement = null;
let _cachedPrimaryMediaElementKey = null;
let _cachedPrimaryMediaElementSearchedAt = 0;
function _clearCachedPrimaryMediaElement() {
  _cachedPrimaryMediaElement = null, _cachedPrimaryMediaElementKey = null, _cachedPrimaryMediaElementSearchedAt = 0;
}
function _getPrimaryMediaElement() {
  const currentMediaKey = typeof __TTVAB_STATE__ < "u" && __TTVAB_STATE__ ? __TTVAB_STATE__.PageMediaKey : null, now = Date.now();
  if (_cachedPrimaryMediaElementKey === currentMediaKey) {
    if (_cachedPrimaryMediaElement?.isConnected)
      return _cachedPrimaryMediaElement;
    if (_cachedPrimaryMediaElement === null && now - _cachedPrimaryMediaElementSearchedAt < _PLAYBACK_INTENT_IDLE_SYNC_DELAY_MS)
      return null;
  }
  const { player } = _getPlayerAndState(), playerVideo = player?.getHTMLVideoElement?.() || null, media = playerVideo instanceof HTMLMediaElement && playerVideo.isConnected ? playerVideo : _getFallbackPrimaryVideoElement();
  return _cachedPrimaryMediaElement = media instanceof HTMLMediaElement && media.isConnected ? media : null, _cachedPrimaryMediaElementKey = currentMediaKey, _cachedPrimaryMediaElementSearchedAt = now, media;
}
function _getPlaybackMediaElementForContext(channel = null, mediaKey = null) {
  const safeMediaKey = _resolvePlayerMediaKey(channel, mediaKey);
  if (!safeMediaKey)
    return null;
  const pipContext = _getActivePictureInPicturePlaybackContext(), pipMediaKey = _normalizeMediaKey(pipContext?.MediaKey);
  if (pipMediaKey === safeMediaKey && pipContext?.element instanceof HTMLMediaElement)
    return pipContext.element;
  if (_normalizeMediaKey(__TTVAB_STATE__?.PageMediaKey) !== safeMediaKey)
    return null;
  const primaryMedia = _getPrimaryMediaElement();
  return !(primaryMedia instanceof HTMLMediaElement) || primaryMedia === pipContext?.element && pipMediaKey !== safeMediaKey ? null : primaryMedia;
}
function _restoreSuppressedMediaElement(media, state) {
  if (!(media instanceof HTMLMediaElement))
    return !1;
  try {
    return media.defaultMuted = !!state?.defaultMuted, media.muted = !!state?.muted, Number.isFinite(state?.volume) && (media.volume = Math.min(1, Math.max(0, state.volume))), media.removeAttribute("data-ttvab-audio-suppressed"), !0;
  } catch {
    return !1;
  }
}
function _silenceSuppressedMediaElement(media) {
  if (!(media instanceof HTMLMediaElement))
    return !1;
  try {
    return media.defaultMuted = !0, media.muted = !0, media.volume = 0, media.removeAttribute("data-ttvab-audio-suppressed"), !0;
  } catch {
    return !1;
  }
}
function _pruneDisconnectedSuppressedMedia() {
  let prunedCount = 0;
  for (const [media, state] of _AdAudioSuppressionState.suppressedMedia.entries())
    media instanceof HTMLMediaElement && media.isConnected || (_silenceSuppressedMediaElement(media), media instanceof HTMLMediaElement && _AdAudioSuppressionState.detachedMediaStates.set(media, state), _AdAudioSuppressionState.suppressedMedia.delete(media), prunedCount += 1);
  return _AdAudioSuppressionState.suppressedMedia.size === 0 ? (_AdAudioSuppressionState.activeMediaKey = null, _AdAudioSuppressionState.lastSuppressedCount = 0) : prunedCount > 0 && (_AdAudioSuppressionState.lastSuppressedCount = Math.max(0, _AdAudioSuppressionState.suppressedMedia.size)), prunedCount;
}
function _clearSuppressedMediaTracking(options = {}) {
  const { restoreConnected = !1, preserveMediaKey = null, onlyMediaKey = null } = options;
  if (_normalizeMediaKey(onlyMediaKey) && _normalizeMediaKey(_AdAudioSuppressionState.activeMediaKey) !== _normalizeMediaKey(onlyMediaKey) || _normalizeMediaKey(preserveMediaKey) && _normalizeMediaKey(_AdAudioSuppressionState.activeMediaKey) === _normalizeMediaKey(preserveMediaKey))
    return 0;
  let restoredCount = 0;
  for (const [media, state] of _AdAudioSuppressionState.suppressedMedia.entries())
    restoreConnected && media instanceof HTMLMediaElement && media.isConnected && _restoreSuppressedMediaElement(media, state) ? restoredCount += 1 : media instanceof HTMLMediaElement && (_silenceSuppressedMediaElement(media), _AdAudioSuppressionState.detachedMediaStates.set(media, state));
  return _AdAudioSuppressionState.suppressedMedia.clear(), _AdAudioSuppressionState.activeMediaKey = null, _AdAudioSuppressionState.lastSuppressedCount = 0, restoredCount;
}
function _suppressCompetingMediaDuringAd(channel = null, mediaKey = null) {
  const safeMediaKey = _resolvePlayerMediaKey(channel, mediaKey), primaryMedia = _getPlaybackMediaElementForContext(channel, safeMediaKey);
  let suppressedCount = 0;
  if (_pruneDisconnectedSuppressedMedia(), !(primaryMedia instanceof HTMLMediaElement))
    return 0;
  safeMediaKey && _AdAudioSuppressionState.activeMediaKey && _AdAudioSuppressionState.activeMediaKey !== safeMediaKey && _clearSuppressedMediaTracking({ restoreConnected: !1 });
  const primarySuppression = _AdAudioSuppressionState.suppressedMedia.get(primaryMedia) || _AdAudioSuppressionState.detachedMediaStates.get(primaryMedia);
  primarySuppression && _restoreSuppressedMediaElement(primaryMedia, primarySuppression) && (_AdAudioSuppressionState.suppressedMedia.delete(primaryMedia), _AdAudioSuppressionState.detachedMediaStates.delete(primaryMedia));
  for (const media of document.querySelectorAll("video, audio")) {
    if (!(media instanceof HTMLMediaElement) || !media.isConnected || media.ended || primaryMedia && media === primaryMedia || media.paused && (media.muted || Number(media.volume ?? 1) === 0))
      continue;
    const detachedSuppression = _AdAudioSuppressionState.detachedMediaStates.get(media);
    detachedSuppression && !_AdAudioSuppressionState.suppressedMedia.has(media) && (_AdAudioSuppressionState.suppressedMedia.set(media, detachedSuppression), _AdAudioSuppressionState.detachedMediaStates.delete(media));
    const alreadySuppressed = _AdAudioSuppressionState.suppressedMedia.has(media);
    alreadySuppressed || _AdAudioSuppressionState.suppressedMedia.set(media, {
      muted: media.muted,
      defaultMuted: media.defaultMuted,
      volume: Number.isFinite(media.volume) ? media.volume : 1
    });
    try {
      media.defaultMuted = !0, media.muted = !0, media.volume = 0, media.setAttribute("data-ttvab-audio-suppressed", "true"), alreadySuppressed || (suppressedCount += 1);
    } catch {
    }
  }
  return _AdAudioSuppressionState.activeMediaKey = safeMediaKey, _AdAudioSuppressionState.lastSuppressedCount = _AdAudioSuppressionState.suppressedMedia.size, suppressedCount > 0, suppressedCount;
}
function _restoreReattachedSuppressedPrimaryMedia() {
  const primaryMedia = _getPrimaryMediaElement(), pipMedia = typeof _getPictureInPictureVideo == "function" ? _getPictureInPictureVideo() : null;
  let restoredCount = 0;
  for (const media of /* @__PURE__ */ new Set([primaryMedia, pipMedia])) {
    if (!(media instanceof HTMLMediaElement) || !media.isConnected)
      continue;
    const state = _AdAudioSuppressionState.detachedMediaStates.get(media);
    !state || !_restoreSuppressedMediaElement(media, state) || (_AdAudioSuppressionState.detachedMediaStates.delete(media), restoredCount += 1);
  }
  return restoredCount > 0, restoredCount;
}
function _restoreSuppressedMediaAfterAd(channel = null, mediaKey = null) {
  const safeMediaKey = _resolvePlayerMediaKey(channel, mediaKey), activeMediaKey = _AdAudioSuppressionState.activeMediaKey;
  if (safeMediaKey && activeMediaKey && safeMediaKey !== activeMediaKey && _normalizeMediaKey(__TTVAB_STATE__?.CurrentAdMediaKey) === activeMediaKey)
    return 0;
  let restoredCount = 0;
  _clearCachedPrimaryMediaElement();
  const primaryMedia = _getPrimaryMediaElement(), pipMedia = typeof _getPictureInPictureVideo == "function" ? _getPictureInPictureVideo() : null;
  for (const [media, state] of _AdAudioSuppressionState.suppressedMedia.entries())
    media.isConnected && (media === primaryMedia || media === pipMedia) ? _restoreSuppressedMediaElement(media, state) && (restoredCount += 1) : (_silenceSuppressedMediaElement(media), _AdAudioSuppressionState.detachedMediaStates.set(media, state));
  return _AdAudioSuppressionState.suppressedMedia.clear(), _AdAudioSuppressionState.activeMediaKey = null, _AdAudioSuppressionState.lastSuppressedCount = 0, restoredCount > 0, restoredCount;
}
function _clearAdResumeIntent() {
  __TTVAB_STATE__.ShouldResumeAfterAd = !1, __TTVAB_STATE__.ShouldResumeAfterAdChannel = null, __TTVAB_STATE__.ShouldResumeAfterAdMediaKey = null, __TTVAB_STATE__.ShouldResumeAfterAdUntil = 0;
}
function _isCurrentAdCycleMatchingResumeIntent() {
  const expectedChannel = _normalizePlayerChannel(__TTVAB_STATE__.ShouldResumeAfterAdChannel), expectedMediaKey = _normalizeMediaKey(__TTVAB_STATE__.ShouldResumeAfterAdMediaKey), activeAdChannel = _normalizePlayerChannel(__TTVAB_STATE__.CurrentAdChannel), activeAdMediaKey = _normalizeMediaKey(__TTVAB_STATE__.CurrentAdMediaKey);
  return expectedMediaKey && activeAdMediaKey ? expectedMediaKey === activeAdMediaKey : expectedChannel && activeAdChannel ? expectedChannel === activeAdChannel : !1;
}
function _extendAdResumeIntentWindow() {
  return __TTVAB_STATE__.ShouldResumeAfterAd !== !0 ? !1 : (__TTVAB_STATE__.ShouldResumeAfterAdUntil = Date.now() + _AD_RESUME_INTENT_WINDOW_MS, !0);
}
function _maybeClearTransientPauseIntentAfterAd(channel = null, mediaKey = null) {
  const safeChannel = _normalizePlayerChannel(channel), safeMediaKey = _resolvePlayerMediaKey(channel, mediaKey);
  if (!_hasUserPauseIntent(safeChannel, safeMediaKey) || !_hasPendingAdResumeIntent(safeChannel, safeMediaKey))
    return !1;
  const pauseAt = Number(_PlaybackIntentState.userPausedAt) || 0, pauseWasDuringAdWithoutInteraction = _PlaybackIntentState.userPausedDuringAd === !0 && _PlaybackIntentState.userPausedHadExplicitInteraction !== !0, lastAdDetectedAt = Number(__TTVAB_STATE__.LastAdDetectedAt) || 0, pauseWasNearAdStart = lastAdDetectedAt > 0 && pauseAt > 0 && pauseAt <= lastAdDetectedAt + _AD_TRANSIENT_PAUSE_CLEAR_WINDOW_MS && _PlaybackIntentState.userPausedHadExplicitInteraction !== !0;
  return pauseWasDuringAdWithoutInteraction || pauseWasNearAdStart ? _clearUserPauseIntent(safeChannel, safeMediaKey) : !1;
}
function _canAttemptAdResume(channel = null, mediaKey = null) {
  const safeChannel = _normalizePlayerChannel(channel), safeMediaKey = _resolvePlayerMediaKey(channel, mediaKey);
  return _shouldSuppressAutomaticPlaybackResume(safeChannel, safeMediaKey) ? (_clearAdResumeIntent(), !1) : _hasPendingAdResumeIntent(safeChannel, safeMediaKey) ? (_maybeClearTransientPauseIntentAfterAd(safeChannel, safeMediaKey), !_hasUserPauseIntent(safeChannel, safeMediaKey)) : !1;
}
function _hasPendingAdResumeIntent(channel = null, mediaKey = null) {
  const until = Number(__TTVAB_STATE__.ShouldResumeAfterAdUntil) || 0;
  if (__TTVAB_STATE__.ShouldResumeAfterAd !== !0)
    return !1;
  const safeChannel = _normalizePlayerChannel(channel), safeMediaKey = _resolvePlayerMediaKey(channel, mediaKey), expectedChannel = __TTVAB_STATE__.ShouldResumeAfterAdChannel || null, expectedMediaKey = __TTVAB_STATE__.ShouldResumeAfterAdMediaKey || null;
  if (until <= Date.now()) {
    const transactionOwnsResumeIntent = !!(_PostAdRecoveryTransactionState.mediaKey && _isPostAdRecoveryCycleCurrent(_PostAdRecoveryTransactionState.mediaKey, _PostAdRecoveryTransactionState.cycleStartedAt) && _matchesPlaybackTargetContext(expectedChannel, expectedMediaKey, safeChannel, safeMediaKey));
    if (!_isCurrentAdCycleMatchingResumeIntent() && !transactionOwnsResumeIntent)
      return _clearAdResumeIntent(), !1;
    _extendAdResumeIntentWindow();
  }
  return _matchesPlaybackTargetContext(expectedChannel, expectedMediaKey, safeChannel, safeMediaKey);
}
function _rememberPlayerPlaybackForAd(channel = null, mediaKey = null) {
  const safeChannel = _normalizePlayerChannel(channel) || _normalizePlayerChannel(__TTVAB_STATE__.CurrentAdChannel) || _normalizePlayerChannel(__TTVAB_STATE__.PageChannel), safeMediaKey = _resolvePlayerMediaKey(channel, mediaKey), { player, state: playerState } = _getPlayerAndState();
  safeMediaKey && _PlaybackIntentState.userPausedMediaKey === safeMediaKey && _PlaybackIntentState.userPausedHadExplicitInteraction !== !0 && Date.now() - (Number(_PlaybackIntentState.userPausedAt) || 0) <= _AD_TRANSIENT_PAUSE_CLEAR_WINDOW_MS && _clearUserPauseIntent(safeChannel, safeMediaKey);
  let shouldResumeAfterAd = !_hasUserPauseIntent(safeChannel, safeMediaKey) && !_shouldSuppressAutomaticPlaybackResume(safeChannel, safeMediaKey);
  if (player && playerState?.props?.content) {
    const video = player.getHTMLVideoElement?.() || null, contentType = typeof playerState?.props?.content?.type == "string" ? playerState.props.content.type : null, allowEndedReplayRecovery = typeof contentType == "string" && contentType !== "live";
    shouldResumeAfterAd = shouldResumeAfterAd && (!video?.ended || allowEndedReplayRecovery);
  }
  __TTVAB_STATE__.ShouldResumeAfterAd = shouldResumeAfterAd, __TTVAB_STATE__.ShouldResumeAfterAdChannel = shouldResumeAfterAd ? safeChannel : null, __TTVAB_STATE__.ShouldResumeAfterAdMediaKey = shouldResumeAfterAd ? safeMediaKey : null, __TTVAB_STATE__.ShouldResumeAfterAdUntil = shouldResumeAfterAd ? Date.now() + _AD_RESUME_INTENT_WINDOW_MS : 0;
}
function _resumeActivePlayerAfterAd(channel = null, mediaKey = null) {
  return _canAttemptAdResume(channel, mediaKey) ? _resumeActivePlayerIfPaused(channel, mediaKey) : !1;
}
function _resumePlayerAfterAdIfNeeded(channel = null, mediaKey = null) {
  const safeChannel = _normalizePlayerChannel(channel), safeMediaKey = _resolvePlayerMediaKey(channel, mediaKey);
  if (_shouldSuppressAutomaticPlaybackResume(safeChannel, safeMediaKey))
    return _clearAdResumeIntent(), !1;
  if (!_hasPendingAdResumeIntent(safeChannel, safeMediaKey))
    return !1;
  const { player, state: playerState } = _getPlayerAndState();
  if (!player || !playerState?.props?.content)
    return !1;
  const playerCore = _getPlayerCore(player), video = player.getHTMLVideoElement?.() || null;
  if (video?.ended)
    return !1;
  if (_maybeClearTransientPauseIntentAfterAd(safeChannel, safeMediaKey), _hasUserPauseIntent(safeChannel, safeMediaKey))
    return _clearAdResumeIntent(), !1;
  if (!_isPostAdRecoveryTransactionCurrent(safeChannel, safeMediaKey) && _isPlaybackHealthyAfterAd(player, playerCore, video))
    return _armPostAdGraceWindow(Number(video?.currentTime) || 0), _clearAdResumeIntent(), !1;
  if (!_isPlayerPaused(player, playerCore, video))
    return !1;
  const now = Date.now();
  return __TTVAB_STATE__.LastAdRecoveryResumeAt && now - __TTVAB_STATE__.LastAdRecoveryResumeAt < 1500 ? !1 : (__TTVAB_STATE__.LastAdRecoveryResumeAt = now, _playPlaybackTarget(player, safeChannel, safeMediaKey) ? (_schedulePlaybackRecoveryTimeout(() => {
    if (!_hasPendingAdResumeIntent(safeChannel, safeMediaKey))
      return;
    const { player: confirmPlayer } = _getPlayerAndState(), confirmCore = _getPlayerCore(confirmPlayer), confirmVideo = confirmPlayer?.getHTMLVideoElement?.() || null;
    !_isPostAdRecoveryTransactionCurrent(safeChannel, safeMediaKey) && _isPlaybackHealthyAfterAd(confirmPlayer, confirmCore, confirmVideo) && (_armPostAdGraceWindow(Number(confirmVideo?.currentTime) || 0), _clearAdResumeIntent());
  }, 900, safeChannel, safeMediaKey, _getPlayerLifecycleCycleStartedAt(safeMediaKey)), !0) : (_hasUserPauseIntent(safeChannel, safeMediaKey) && _clearAdResumeIntent(), !1));
}
function _retryPostAdPauseResume(channel = null, mediaKey = null) {
  const now = Date.now();
  if (__TTVAB_STATE__.LastAdRecoveryResumeAt && now - __TTVAB_STATE__.LastAdRecoveryResumeAt < _POST_AD_PAUSE_RESUME_RETRY_MS)
    return !1;
  __TTVAB_STATE__.LastAdRecoveryResumeAt = now;
  const cycleStartedAt = _getPlayerLifecycleCycleStartedAt(mediaKey), didRetry = _doPlayerTask(!0, !1, {
    reason: "ad-recovery",
    channel,
    mediaKey,
    cycleStartedAt
  });
  return didRetry && _scheduleResumeRetries(channel, mediaKey, [250, 700, 1400], {
    cycleStartedAt
  }), !!didRetry;
}
function _getContiguousBufferedEnd(video, currentTime) {
  const buffered = video?.buffered;
  if (!buffered || !(buffered.length > 0))
    return 0;
  for (let bi = 0; bi < buffered.length; bi++) {
    let start = 0, end = 0;
    try {
      start = buffered.start(bi), end = buffered.end(bi);
    } catch {
      continue;
    }
    if (currentTime >= start - 0.1 && currentTime <= end + 0.1)
      return end;
  }
  return 0;
}
function _seekPastBufferedGap(video, currentTime) {
  if (!video || !(video.buffered?.length > 1))
    return 0;
  for (let bi = 0; bi < video.buffered.length; bi++) {
    let gapStart = 0;
    try {
      gapStart = video.buffered.start(bi);
    } catch {
      continue;
    }
    if (gapStart > currentTime) {
      try {
        video.currentTime = gapStart + 0.05;
      } catch {
        return 0;
      }
      return gapStart - currentTime;
    }
  }
  return 0;
}
function _trySeekPastFrozenBufferGap(video, currentTime, readyState) {
  const lastPosition = _PlayerBufferState.gapJumpLastPosition;
  return lastPosition >= 0 && currentTime > lastPosition + 0.2 || lastPosition < 0 || currentTime < lastPosition ? _PlayerBufferState.gapJumpStuckTicks = 0 : _PlayerBufferState.gapJumpStuckTicks++, _PlayerBufferState.gapJumpLastPosition = currentTime, _PlayerBufferState.gapJumpStuckTicks < 3 || readyState >= 3 || !video || !(video.buffered?.length > 1) ? !1 : _seekPastBufferedGap(video, currentTime) > 0 ? (_PlayerBufferState.gapJumpStuckTicks = 0, _PlayerBufferState.gapJumpLastPosition = -1, _PlayerBufferState.lastFixTime = Date.now(), _PlayerBufferState.numSame = 0, !0) : (_PlayerBufferState.gapJumpStuckTicks = 0, !1);
}
function _resetPostAdGrace() {
  _PlayerBufferState.postAdGraceUntil = 0, _PlayerBufferState.postAdGraceLastCurrentTime = 0, _PlayerBufferState.postAdGraceStallTicks = 0, _PlayerBufferState.postAdGracePauseResumeAt = 0, _PlayerBufferState.postAdGraceReloadAttempted = !1;
}
function _armPostAdGraceWindow(currentTime = 0) {
  _PlayerBufferState.postAdGraceUntil = Date.now() + _POST_AD_GRACE_WINDOW_MS, _PlayerBufferState.postAdGraceLastCurrentTime = Number(currentTime) || 0, _PlayerBufferState.postAdGraceStallTicks = 0, _PlayerBufferState.postAdGracePauseResumeAt = 0, _PlayerBufferState.postAdGraceReloadAttempted = !1;
}
function _handlePostAdGraceWatch(player, playerCore = null, video = null, channel = null, mediaKey = null, contentType = null) {
  const now = Date.now();
  if (_PlayerBufferState.postAdGraceUntil <= 0 || now > _PlayerBufferState.postAdGraceUntil)
    return _PlayerBufferState.postAdGraceUntil > 0 && _resetPostAdGrace(), !1;
  if (_shouldSuppressAutomaticPlaybackResume(channel, mediaKey))
    return _resetPostAdGrace(), !1;
  const liveVideo = video || player?.getHTMLVideoElement?.() || null;
  if (!liveVideo)
    return !1;
  if (liveVideo.ended)
    return _resetPostAdGrace(), !1;
  if (_isPlayerPaused(player, playerCore, liveVideo))
    return _PlayerBufferState.postAdGraceLastCurrentTime = Number(liveVideo.currentTime) || 0, _PlayerBufferState.postAdGraceStallTicks = 0, !1;
  const liveCurrentTime = Number(liveVideo.currentTime) || 0, liveVideoWidth = Number(liveVideo.videoWidth) || 0;
  if (liveCurrentTime > _PlayerBufferState.postAdGraceLastCurrentTime + 0.05 ? _PlayerBufferState.postAdGraceStallTicks = 0 : _PlayerBufferState.postAdGraceStallTicks++, _PlayerBufferState.postAdGraceLastCurrentTime = liveCurrentTime, !(liveVideoWidth <= 0 || _PlayerBufferState.postAdGraceStallTicks >= _POST_AD_GRACE_STALL_TICKS_REQUIRED))
    return !1;
  if (now - _PlayerBufferState.postAdGracePauseResumeAt >= _POST_AD_GRACE_PAUSE_RESUME_COOLDOWN_MS) {
    _PlayerBufferState.postAdGracePauseResumeAt = now, _PlayerBufferState.postAdGraceStallTicks = 0;
    const cycleStartedAt = _getPlayerLifecycleCycleStartedAt(mediaKey);
    return _doPlayerTask(!0, !1, {
      reason: "buffer-recovery",
      channel,
      mediaKey,
      cycleStartedAt
    }), _scheduleResumeRetries(channel, mediaKey, [250, 700, 1400], {
      cycleStartedAt
    }), !0;
  }
  if (_PlayerBufferState.lastFixTime > now - _POST_AD_RECOVERY_RELOAD_COOLDOWN_MS)
    return !1;
  const escalateToNewInstance = _PlayerBufferState.postAdGraceReloadAttempted;
  return _doPlayerTask(!1, !0, {
    reason: "buffer-recovery",
    refreshAccessToken: !0,
    newMediaPlayerInstance: escalateToNewInstance
  }), _PlayerBufferState.lastFixTime = now, escalateToNewInstance ? _resetPostAdGrace() : (_PlayerBufferState.postAdGraceReloadAttempted = !0, _PlayerBufferState.postAdGraceStallTicks = 0), !0;
}
function _canRefreshPostAdPlayer(mediaKey) {
  try {
    const notice = _PostAdRecoveryNoticeState;
    if (!mediaKey || notice.mediaKey !== mediaKey || notice.pageGeneration !== Number(__TTVAB_STATE__.PagePlaybackContextGeneration || 0) || !_isPostAdRecoveryCycleCurrent(mediaKey, notice.cycleStartedAt) || _hasUserPauseIntent(null, mediaKey) || __TTVAB_STATE__.IsAdStrippingEnabled === !1)
      return !1;
    const { player } = _getPlayerAndState(), video = player?.getHTMLVideoElement?.();
    let totalVideoFrames = -1;
    try {
      const sample = Number(video?.getVideoPlaybackQuality?.()?.totalVideoFrames);
      Number.isFinite(sample) && sample >= 0 && (totalVideoFrames = sample);
    } catch {
    }
    const playbackAdvanced = !!(Number(video?.currentTime) > notice.currentTime + 0.05 && (totalVideoFrames < 0 || notice.totalVideoFrames < 0 || totalVideoFrames > notice.totalVideoFrames) && _isPlaybackHealthyAfterAd(player, _getPlayerCore(player), video));
    return !!(player && notice.playerRef?.deref() === player && notice.videoRef?.deref() === video && video?.isConnected && !playbackAdvanced);
  } catch {
    return !1;
  }
}
function _checkPostAdRecoveryNotice() {
  const mediaKey = _PostAdRecoveryNoticeState.mediaKey;
  !mediaKey || _canRefreshPostAdPlayer(mediaKey) || (_PostAdRecoveryNoticeState.mediaKey = null, _PostAdRecoveryNoticeState.playerRef = null, _PostAdRecoveryNoticeState.videoRef = null);
}
function _resetPostAdRecoveryTransaction() {
  _PostAdRecoveryTransactionState.mediaKey && _broadcastWorkers({
    key: "ReleasePostAdNativeSession",
    targetMediaKey: _PostAdRecoveryTransactionState.mediaKey,
    value: {
      mediaKey: _PostAdRecoveryTransactionState.mediaKey,
      cycleStartedAt: _PostAdRecoveryTransactionState.cycleStartedAt,
      reloadAt: _PostAdRecoveryTransactionState.requiredNativeReloadAt
    }
  }), _PostAdRecoveryTransactionState.channel = null, _PostAdRecoveryTransactionState.mediaKey = null, _PostAdRecoveryTransactionState.cycleStartedAt = 0, _PostAdRecoveryTransactionState.video = null, _PostAdRecoveryTransactionState.observedAt = 0, _PostAdRecoveryTransactionState.lastCurrentTime = 0, _PostAdRecoveryTransactionState.lastTotalFrames = -1, _PostAdRecoveryTransactionState.stallTicks = 0, _PostAdRecoveryTransactionState.reloadRequestCount = 0, _PostAdRecoveryTransactionState.acceptedReloadCount = 0, _PostAdRecoveryTransactionState.lastReloadRequestAt = 0, _PostAdRecoveryTransactionState.expiresAt = 0, _PostAdRecoveryTransactionState.lastCheckedAt = 0, _PostAdRecoveryTransactionState.suspendedAt = 0, _PostAdRecoveryTransactionState.requiresReplacement = !1, _PostAdRecoveryTransactionState.requiredReplacementVideo = null, _PostAdRecoveryTransactionState.requiredNativeReloadAt = 0, _PostAdRecoveryTransactionState.nativeReloadConfirmedAt = 0, _PostAdRecoveryTransactionState.pendingOperation = null, _PostAdRecoveryTransactionState.pendingOperationReadyAt = 0, _PostAdRecoveryTransactionState.initialOperationCompleted = !1;
}
function _resetPostAdRecoveryMonitorSamples() {
  _PlayerBufferState.postAdUnhealthyCount = 0, _PlayerBufferState.postAdRecoveryStartedAt = 0, _PlayerBufferState.postAdLastCurrentTime = 0, _PlayerBufferState.postAdStallTicks = 0, _PlayerBufferState.postAdSoftReloadAttempted = !1;
}
function _isPostAdRecoveryCycleCurrent(mediaKey, cycleStartedAt) {
  const safeMediaKey = _normalizeMediaKey(mediaKey), safeCycleStartedAt = Math.max(0, Number(cycleStartedAt) || 0);
  return !!(safeMediaKey && safeCycleStartedAt > 0 && !__TTVAB_STATE__?.CurrentAdMediaKey && !__TTVAB_STATE__?.CurrentAdChannel && _isPlaybackRecoveryContextCurrent(null, safeMediaKey) && _normalizeMediaKey(__TTVAB_STATE__?.LastAdEndedMediaKey) === safeMediaKey && Math.max(0, Number(__TTVAB_STATE__?.LastAdEndedCycleStartedAt) || 0) === safeCycleStartedAt);
}
function _isPostAdRecoveryTransactionCurrent(channel = null, mediaKey = null) {
  const transactionMediaKey = _normalizeMediaKey(_PostAdRecoveryTransactionState.mediaKey);
  if (!transactionMediaKey)
    return !1;
  const safeMediaKey = _normalizeMediaKey(mediaKey), safeChannel = _normalizePlayerChannel(channel), transactionChannel = _normalizePlayerChannel(_PostAdRecoveryTransactionState.channel), isCurrent = !!((!safeMediaKey || safeMediaKey === transactionMediaKey) && (!safeChannel || !transactionChannel || safeChannel === transactionChannel) && _isPostAdRecoveryCycleCurrent(transactionMediaKey, _PostAdRecoveryTransactionState.cycleStartedAt) && _isPlaybackRecoveryContextCurrent(transactionChannel, transactionMediaKey));
  return isCurrent || _resetPostAdRecoveryTransaction(), isCurrent;
}
function _getPendingPostAdNativeReloadContext(mediaKey = null) {
  const transactionMediaKey = _normalizeMediaKey(_PostAdRecoveryTransactionState.mediaKey), safeMediaKey = _normalizeMediaKey(mediaKey), reloadAt = Math.max(0, Number(_PostAdRecoveryTransactionState.requiredNativeReloadAt) || 0);
  return !transactionMediaKey || safeMediaKey && safeMediaKey !== transactionMediaKey || !_PostAdRecoveryTransactionState.requiresReplacement || reloadAt <= 0 || !_isPostAdRecoveryCycleCurrent(transactionMediaKey, _PostAdRecoveryTransactionState.cycleStartedAt) ? null : {
    channelName: _PostAdRecoveryTransactionState.channel,
    mediaKey: transactionMediaKey,
    cycleStartedAt: _PostAdRecoveryTransactionState.cycleStartedAt,
    reloadAt
  };
}
function _confirmPostAdNativeReload(data = null) {
  const safeChannel = _normalizePlayerChannel(data?.channel), safeMediaKey = _normalizeMediaKey(data?.mediaKey), safeCycleStartedAt = Math.max(0, Number(data?.cycleStartedAt) || 0), safeReloadAt = Math.max(0, Number(data?.reloadAt) || 0), safeConfirmedAt = Math.max(0, Number(data?.confirmedAt) || 0);
  return !safeMediaKey || safeCycleStartedAt <= 0 || safeReloadAt <= 0 || safeConfirmedAt < safeReloadAt || !_isPostAdRecoveryTransactionCurrent(safeChannel, safeMediaKey) || _PostAdRecoveryTransactionState.cycleStartedAt !== safeCycleStartedAt || _PostAdRecoveryTransactionState.requiredNativeReloadAt !== safeReloadAt || _getPlayerReloadAtForMediaKey(safeMediaKey) !== safeReloadAt ? !1 : (_PostAdRecoveryTransactionState.nativeReloadConfirmedAt = safeConfirmedAt, _PostAdRecoveryTransactionState.video = null, _PostAdRecoveryTransactionState.observedAt = 0, _PostAdRecoveryTransactionState.lastCurrentTime = 0, _PostAdRecoveryTransactionState.stallTicks = 0, _PlayerBufferState.postAdUnhealthyCount = 0, !0);
}
function _startPostAdRecoveryTransaction(channel = null, mediaKey = null, cycleStartedAt = 0) {
  const safeChannel = _normalizePlayerChannel(channel), safeMediaKey = _normalizeMediaKey(mediaKey), safeCycleStartedAt = Math.max(0, Number(cycleStartedAt) || 0);
  if (!safeMediaKey || !_isPostAdRecoveryCycleCurrent(safeMediaKey, safeCycleStartedAt) || !_isPlaybackRecoveryContextCurrent(safeChannel, safeMediaKey) || !_hasPendingAdResumeIntent(safeChannel, safeMediaKey) || _hasUserPauseIntent(safeChannel, safeMediaKey) || _shouldSuppressAutomaticPlaybackResume(safeChannel, safeMediaKey))
    return !1;
  if (_PostAdRecoveryTransactionState.mediaKey === safeMediaKey && _PostAdRecoveryTransactionState.cycleStartedAt === safeCycleStartedAt)
    return !0;
  _resetPostAdRecoveryTransaction(), _PostAdRecoveryTransactionState.channel = safeChannel, _PostAdRecoveryTransactionState.mediaKey = safeMediaKey, _PostAdRecoveryTransactionState.cycleStartedAt = safeCycleStartedAt;
  const startedAt = Date.now();
  return _PostAdRecoveryTransactionState.expiresAt = startedAt + _POST_AD_RECOVERY_TRANSACTION_TIMEOUT_MS, _PostAdRecoveryTransactionState.lastCheckedAt = startedAt, (_isNativeDocumentHidden({
    ChannelName: safeChannel,
    MediaKey: safeMediaKey
  }) || _isActivePictureInPicturePlaybackContext({
    ChannelName: safeChannel,
    MediaKey: safeMediaKey
  })) && (_PostAdRecoveryTransactionState.suspendedAt = startedAt), !0;
}
function _finishPostAdRecoveryTransaction(currentTime = 0, framesVerified = !1) {
  _resetPostAdRecoveryTransaction(), _resetPostAdRecoveryMonitorSamples(), _armPostAdGraceWindow(currentTime), _clearAdResumeIntent(), __TTVAB_STATE__._AdRecoveryConsecutiveFailures = 0;
}
function _cancelPostAdRecoveryTransaction(clearResumeIntent = !0) {
  _resetPostAdRecoveryTransaction(), _resetPostAdRecoveryMonitorSamples(), clearResumeIntent && _clearAdResumeIntent();
}
function _rememberPendingPostAdRecoveryOperation(isPausePlay, isReload, options) {
  return _PostAdRecoveryTransactionState.mediaKey ? (_PostAdRecoveryTransactionState.pendingOperation = {
    isPausePlay: isPausePlay === !0,
    isReload: isReload === !0,
    options: { ...options }
  }, _PostAdRecoveryTransactionState.pendingOperationReadyAt <= 0 && (_PostAdRecoveryTransactionState.pendingOperationReadyAt = Date.now() + 1500), isReload && options.newMediaPlayerInstance !== !1 && (_PostAdRecoveryTransactionState.requiresReplacement = !0), !0) : !1;
}
function _completePendingPostAdRecoveryOperation() {
  _PostAdRecoveryTransactionState.pendingOperation = null, _PostAdRecoveryTransactionState.pendingOperationReadyAt = 0, _PostAdRecoveryTransactionState.initialOperationCompleted = !0;
}
function _tryRunPendingPostAdRecoveryOperation(channel = null, mediaKey = null) {
  const safeChannel = _normalizePlayerChannel(channel), safeMediaKey = _normalizeMediaKey(mediaKey);
  if (!_PostAdRecoveryTransactionState.pendingOperation)
    return !1;
  if (!_isPostAdRecoveryTransactionCurrent(safeChannel, safeMediaKey) || _hasUserPauseIntent(safeChannel, safeMediaKey) || _shouldSuppressAutomaticPlaybackResume(safeChannel, safeMediaKey))
    return _cancelPostAdRecoveryTransaction(!0), !1;
  if (!_maintainPostAdRecoveryTransactionLifetime())
    return !1;
  const pendingOperation = _PostAdRecoveryTransactionState.pendingOperation;
  if (!pendingOperation || _isActivePictureInPicturePlaybackContext({
    ChannelName: safeChannel,
    MediaKey: safeMediaKey
  }))
    return !1;
  const now = Date.now();
  if (now < _PostAdRecoveryTransactionState.pendingOperationReadyAt)
    return !1;
  const { player, state } = _getPlayerAndState();
  return !player || pendingOperation.isReload && !state ? !1 : _doPlayerTask(pendingOperation.isPausePlay, pendingOperation.isReload, pendingOperation.options) === !0 ? (_completePendingPostAdRecoveryOperation(), !0) : (_PostAdRecoveryTransactionState.pendingOperation && (_PostAdRecoveryTransactionState.pendingOperationReadyAt = now + 1500), !1);
}
function _requestPostAdRecoveryReload(channel, mediaKey, cycleStartedAt, message) {
  const now = Date.now();
  if (_PostAdRecoveryTransactionState.acceptedReloadCount >= _POST_AD_RECOVERY_MAX_ACCEPTED_RELOADS || _PostAdRecoveryTransactionState.reloadRequestCount >= _POST_AD_RECOVERY_MAX_RELOAD_REQUESTS || _PostAdRecoveryTransactionState.lastReloadRequestAt > 0 && now - _PostAdRecoveryTransactionState.lastReloadRequestAt < _POST_AD_RECOVERY_RELOAD_COOLDOWN_MS)
    return !1;
  _PostAdRecoveryTransactionState.reloadRequestCount++, _PostAdRecoveryTransactionState.lastReloadRequestAt = now;
  const reloadAtBefore = _getPlayerReloadAtForMediaKey(mediaKey);
  let taskAccepted = !1;
  try {
    taskAccepted = _doPlayerTask(!1, !0, {
      reason: "ad-recovery",
      refreshAccessToken: !1,
      newMediaPlayerInstance: !0,
      channel,
      mediaKey,
      cycleStartedAt
    }) === !0;
  } catch {
  }
  const reloadAtAfter = _getPlayerReloadAtForMediaKey(mediaKey), reloadAccepted = !!(taskAccepted && reloadAtAfter > reloadAtBefore);
  return _PlayerBufferState.lastFixTime = now, _PlayerBufferState.postAdSoftReloadAttempted = reloadAccepted, reloadAccepted ? (_PostAdRecoveryTransactionState.acceptedReloadCount++, _PostAdRecoveryTransactionState.video = null, _PostAdRecoveryTransactionState.observedAt = 0, _PostAdRecoveryTransactionState.lastCurrentTime = 0, _PostAdRecoveryTransactionState.stallTicks = 0, _PostAdRecoveryTransactionState.acceptedReloadCount >= _POST_AD_RECOVERY_MAX_ACCEPTED_RELOADS && (_PostAdRecoveryTransactionState.expiresAt = Math.min(_PostAdRecoveryTransactionState.expiresAt || Number.POSITIVE_INFINITY, now + _POST_AD_RECOVERY_TERMINAL_SETTLE_MS))) : _PostAdRecoveryTransactionState.reloadRequestCount >= _POST_AD_RECOVERY_MAX_RELOAD_REQUESTS && (_PostAdRecoveryTransactionState.expiresAt = Math.min(_PostAdRecoveryTransactionState.expiresAt || Number.POSITIVE_INFINITY, now + _POST_AD_RECOVERY_TERMINAL_SETTLE_MS)), !0;
}
function _maintainPostAdRecoveryTransactionLifetime() {
  if (!_PostAdRecoveryTransactionState.mediaKey)
    return !1;
  const now = Date.now(), transactionContext = {
    ChannelName: _PostAdRecoveryTransactionState.channel,
    MediaKey: _PostAdRecoveryTransactionState.mediaKey
  }, isPictureInPicture = _isActivePictureInPicturePlaybackContext(transactionContext);
  if (_isNativeDocumentHidden(transactionContext) || isPictureInPicture)
    return !_PostAdRecoveryTransactionState.suspendedAt && _PostAdRecoveryTransactionState.expiresAt > 0 && now >= _PostAdRecoveryTransactionState.expiresAt ? (_cancelPostAdRecoveryTransaction(!0), !1) : (_PostAdRecoveryTransactionState.suspendedAt || (_PostAdRecoveryTransactionState.suspendedAt = now), isPictureInPicture && (_PostAdRecoveryTransactionState.video = null, _PostAdRecoveryTransactionState.observedAt = 0, _PostAdRecoveryTransactionState.lastCurrentTime = 0, _PostAdRecoveryTransactionState.lastTotalFrames = -1, _PostAdRecoveryTransactionState.stallTicks = 0), _PostAdRecoveryTransactionState.lastCheckedAt = now, !0);
  if (_PostAdRecoveryTransactionState.suspendedAt > 0 && (_PostAdRecoveryTransactionState.expiresAt += Math.max(0, now - _PostAdRecoveryTransactionState.suspendedAt), _PostAdRecoveryTransactionState.suspendedAt = 0, _PostAdRecoveryTransactionState.video = null, _PostAdRecoveryTransactionState.observedAt = 0, _PostAdRecoveryTransactionState.lastCurrentTime = 0, _PostAdRecoveryTransactionState.lastTotalFrames = -1, _PostAdRecoveryTransactionState.stallTicks = 0), _PostAdRecoveryTransactionState.lastCheckedAt = now, _PostAdRecoveryTransactionState.expiresAt <= 0 || now < _PostAdRecoveryTransactionState.expiresAt)
    return !0;
  const notice = _PostAdRecoveryNoticeState;
  try {
    const { player } = _getPlayerAndState(), video = player?.getHTMLVideoElement?.();
    player && video instanceof HTMLVideoElement && (notice.mediaKey !== _PostAdRecoveryTransactionState.mediaKey || notice.cycleStartedAt !== _PostAdRecoveryTransactionState.cycleStartedAt) && Object.assign(notice, {
      mediaKey: _PostAdRecoveryTransactionState.mediaKey,
      cycleStartedAt: _PostAdRecoveryTransactionState.cycleStartedAt,
      pageGeneration: Number(__TTVAB_STATE__.PagePlaybackContextGeneration) || 0,
      playerRef: new WeakRef(player),
      videoRef: new WeakRef(video),
      currentTime: _PostAdRecoveryTransactionState.video === video ? _PostAdRecoveryTransactionState.lastCurrentTime : Number(video.currentTime) || 0,
      totalVideoFrames: _PostAdRecoveryTransactionState.video === video ? _PostAdRecoveryTransactionState.lastTotalFrames : -1,
      noticeShownAt: 0
    });
  } catch {
  }
  return _resetPostAdRecoveryTransaction(), _resetPostAdRecoveryMonitorSamples(), _clearAdResumeIntent(), !1;
}
function _handlePendingPostAdRecovery(player, playerCore = null, video = null, channel = null, mediaKey = null, contentType = null) {
  const safeChannel = _normalizePlayerChannel(channel), safeMediaKey = _normalizeMediaKey(mediaKey);
  if (!_isPostAdRecoveryTransactionCurrent(safeChannel, safeMediaKey) || _hasUserPauseIntent(safeChannel, safeMediaKey) || _shouldSuppressAutomaticPlaybackResume(safeChannel, safeMediaKey))
    return _cancelPostAdRecoveryTransaction(!0), !1;
  if (!_maintainPostAdRecoveryTransactionLifetime())
    return !1;
  if (_tryRunPendingPostAdRecoveryOperation(safeChannel, safeMediaKey))
    return !0;
  if (_isActivePictureInPicturePlaybackContext({
    ChannelName: safeChannel,
    MediaKey: safeMediaKey
  }))
    return !1;
  const now = Date.now(), liveVideo = video || player?.getHTMLVideoElement?.() || null, { player: currentPlayer } = _getPlayerAndState();
  if (!(liveVideo instanceof HTMLVideoElement) || !liveVideo.isConnected || currentPlayer !== player || currentPlayer?.getHTMLVideoElement?.() !== liveVideo)
    return !1;
  const liveCurrentTime = Number(liveVideo.currentTime) || 0;
  let totalFrames = -1;
  try {
    const sample = Number(liveVideo.getVideoPlaybackQuality?.()?.totalVideoFrames);
    Number.isFinite(sample) && sample >= 0 && (totalFrames = sample);
  } catch {
  }
  const isNewObservation = _PostAdRecoveryTransactionState.video !== liveVideo || !_PostAdRecoveryTransactionState.observedAt;
  isNewObservation && (_PostAdRecoveryTransactionState.video = liveVideo, _PostAdRecoveryTransactionState.observedAt = now, _PostAdRecoveryTransactionState.lastCurrentTime = liveCurrentTime, _PostAdRecoveryTransactionState.lastTotalFrames = totalFrames, _PostAdRecoveryTransactionState.stallTicks = 0);
  const recoveryAge = now - _PostAdRecoveryTransactionState.observedAt, canSoftReload = recoveryAge >= _POST_AD_SOFT_RELOAD_DELAY_MS, liveVideoWidth = Number(liveVideo.videoWidth) || 0, isLivePaused = _isPlayerPaused(player, playerCore, liveVideo), advanced = !isNewObservation && liveCurrentTime > _PostAdRecoveryTransactionState.lastCurrentTime + 0.05, framesAdvanced = totalFrames < 0 || _PostAdRecoveryTransactionState.lastTotalFrames < 0 || totalFrames > _PostAdRecoveryTransactionState.lastTotalFrames, framesVerified = !isNewObservation && totalFrames >= 0 && _PostAdRecoveryTransactionState.lastTotalFrames >= 0 && totalFrames > _PostAdRecoveryTransactionState.lastTotalFrames;
  !isLivePaused && !isNewObservation && (!advanced || !framesAdvanced) ? _PostAdRecoveryTransactionState.stallTicks++ : advanced && framesAdvanced && (_PostAdRecoveryTransactionState.stallTicks = 0), _PostAdRecoveryTransactionState.lastCurrentTime = liveCurrentTime, _PostAdRecoveryTransactionState.lastTotalFrames = totalFrames, _PlayerBufferState.postAdRecoveryStartedAt = _PostAdRecoveryTransactionState.observedAt, _PlayerBufferState.postAdLastCurrentTime = liveCurrentTime, _PlayerBufferState.postAdStallTicks = _PostAdRecoveryTransactionState.stallTicks;
  const isDeadFrame = !isLivePaused && !liveVideo.ended && recoveryAge >= _POST_AD_RECOVERY_RELOAD_COOLDOWN_MS && (liveVideoWidth <= 0 || _PostAdRecoveryTransactionState.stallTicks >= 2), hasAdvancingFrames = !!(advanced && framesAdvanced && !isLivePaused && !liveVideo.ended && Number(liveVideo.readyState) >= 2 && liveVideoWidth > 0), exactNativeReloadIsReady = _PostAdRecoveryTransactionState.requiredNativeReloadAt > 0 && _PostAdRecoveryTransactionState.nativeReloadConfirmedAt >= _PostAdRecoveryTransactionState.requiredNativeReloadAt, replacementIsReady = !!(!_PostAdRecoveryTransactionState.requiresReplacement || _PostAdRecoveryTransactionState.initialOperationCompleted && (_PostAdRecoveryTransactionState.requiredReplacementVideo?.deref() !== liveVideo || exactNativeReloadIsReady));
  if (hasAdvancingFrames && replacementIsReady)
    return _finishPostAdRecoveryTransaction(liveCurrentTime, framesVerified), !0;
  if (hasAdvancingFrames)
    return _PlayerBufferState.postAdUnhealthyCount = 0, !1;
  if (_isNativeDocumentHidden({
    ChannelName: safeChannel,
    MediaKey: safeMediaKey
  }) && advanced && !isLivePaused && !liveVideo.ended && Number(liveVideo.readyState) >= 2)
    return _PostAdRecoveryTransactionState.stallTicks = 0, _PlayerBufferState.postAdUnhealthyCount = 0, !1;
  if (isDeadFrame && _requestPostAdRecoveryReload(safeChannel, safeMediaKey, _PostAdRecoveryTransactionState.cycleStartedAt, "Player frozen after ad (no advancing frames). Rebuilding native player..."))
    return _PlayerBufferState.postAdUnhealthyCount = 0, !0;
  if (_PostAdRecoveryTransactionState.acceptedReloadCount >= _POST_AD_RECOVERY_MAX_ACCEPTED_RELOADS || _PostAdRecoveryTransactionState.reloadRequestCount >= _POST_AD_RECOVERY_MAX_RELOAD_REQUESTS || _PostAdRecoveryTransactionState.lastReloadRequestAt > 0 && now - _PostAdRecoveryTransactionState.lastReloadRequestAt < _POST_AD_RECOVERY_RELOAD_COOLDOWN_MS)
    return !1;
  if (liveVideo.ended) {
    if (!canSoftReload)
      return _PlayerBufferState.postAdUnhealthyCount++, _retryPostAdPauseResume(safeChannel, safeMediaKey), !0;
    if (_requestPostAdRecoveryReload(safeChannel, safeMediaKey, _PostAdRecoveryTransactionState.cycleStartedAt, contentType && contentType !== "live" ? "Replay/VOD player ended after ad. Reloading native player..." : "Player hit end of stream after ad. Reloading native player..."))
      return _PlayerBufferState.postAdUnhealthyCount = 0, !0;
  }
  let resumeAttempted = !1;
  if (_isPlayerPaused(player, playerCore, liveVideo) && (!__TTVAB_STATE__.LastAdRecoveryResumeAt || Date.now() - __TTVAB_STATE__.LastAdRecoveryResumeAt >= 1500) && (resumeAttempted = _resumePlayerAfterAdIfNeeded(safeChannel, safeMediaKey)), _PlayerBufferState.postAdUnhealthyCount++, _PlayerBufferState.postAdUnhealthyCount >= _POST_AD_UNHEALTHY_RELOAD_COUNT && _PlayerBufferState.lastFixTime <= now - _POST_AD_RECOVERY_RELOAD_COOLDOWN_MS) {
    if (!canSoftReload)
      return _retryPostAdPauseResume(safeChannel, safeMediaKey) && (_PlayerBufferState.lastFixTime = now), !0;
    if (_requestPostAdRecoveryReload(safeChannel, safeMediaKey, _PostAdRecoveryTransactionState.cycleStartedAt, contentType && contentType !== "live" ? "Replay/VOD player still stalling after ad. Rebuilding native player..." : "Player still stalling after ad. Rebuilding native player..."))
      return _PlayerBufferState.postAdUnhealthyCount = 0, !0;
  }
  return resumeAttempted;
}
function _capturePlayerPreferenceSnapshot(playerCore = null, media = null, context = {}) {
  const snapshot = /* @__PURE__ */ Object.create(null);
  try {
    _ensurePlayerPreferenceStorageMonitor(), snapshot.__storageVersions = /* @__PURE__ */ Object.create(null), snapshot.__storageValues = /* @__PURE__ */ Object.create(null);
    for (const key of _PLAYER_PREFERENCE_KEYS)
      snapshot[key] = localStorage.getItem(key), snapshot.__storageValues[key] = snapshot[key], snapshot.__storageVersions[key] = _PlayerPreferenceStorageState.versions.get(key) || 0;
    const configuredQualityGroup = _readConfiguredQualityGroup();
    context.preserveConfiguredQuality !== !0 && playerCore?.state?.quality?.group && configuredQualityGroup && configuredQualityGroup.toLowerCase() !== "auto" && (snapshot["video-quality"] = JSON.stringify({
      default: playerCore.state.quality.group
    }));
    const sourceMedia = media instanceof HTMLMediaElement ? media : _getPrimaryMediaElement(), volume = Number(sourceMedia?.volume ?? playerCore?.state?.volume);
    snapshot.__mediaState = {
      defaultMuted: !!sourceMedia?.defaultMuted,
      muted: !!(sourceMedia?.muted ?? playerCore?.state?.muted),
      volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : null,
      videoRef: sourceMedia instanceof HTMLMediaElement ? new WeakRef(sourceMedia) : null
    }, snapshot.__mediaState.lastApplied = {
      muted: snapshot.__mediaState.muted,
      volume: snapshot.__mediaState.volume
    }, snapshot.__playbackContext = {
      channel: _normalizePlayerChannel(context.channel),
      mediaKey: _normalizeMediaKey(context.mediaKey)
    };
  } catch {
    return null;
  }
  return snapshot;
}
function _ensurePlayerPreferenceStorageMonitor() {
  return _PlayerPreferenceStorageState.initialized ? !0 : typeof window > "u" ? !1 : (window.addEventListener("storage", (event) => {
    try {
      if (event.storageArea && event.storageArea !== localStorage)
        return;
    } catch {
    }
    const changedKeys = event.key ? _PLAYER_PREFERENCE_KEYS.includes(event.key) ? [event.key] : [] : _PLAYER_PREFERENCE_KEYS;
    for (const key of changedKeys)
      _PlayerPreferenceStorageState.versions.set(key, (_PlayerPreferenceStorageState.versions.get(key) || 0) + 1);
  }), _PlayerPreferenceStorageState.initialized = !0, !0);
}
function _restorePlayerMediaPreferenceSnapshot(mediaState, options = {}) {
  if (!mediaState || typeof mediaState != "object" || mediaState.isCurrent && !mediaState.isCurrent())
    return !1;
  const safeChannel = _normalizePlayerChannel(options.channel), safeMediaKey = _normalizeMediaKey(options.mediaKey);
  if ((safeChannel || safeMediaKey) && !_isPlaybackRecoveryContextCurrent(safeChannel, safeMediaKey))
    return !1;
  const media = safeChannel || safeMediaKey ? _getPlaybackMediaElementForContext(safeChannel, safeMediaKey) : _getPlayerAndState().player?.getHTMLVideoElement?.() || _getPrimaryMediaElement();
  if (!(media instanceof HTMLMediaElement) || !media.isConnected)
    return !1;
  try {
    return mediaState.videoRef?.deref() === media && mediaState.lastApplied && (media.muted !== mediaState.lastApplied.muted && (mediaState.muted = media.muted, mediaState.defaultMuted = media.defaultMuted), media.volume !== mediaState.lastApplied.volume && (mediaState.volume = media.volume)), media.defaultMuted = !!mediaState.defaultMuted, media.muted = !!mediaState.muted, Number.isFinite(mediaState.volume) && (media.volume = Math.min(1, Math.max(0, Number(mediaState.volume)))), mediaState.videoRef = new WeakRef(media), mediaState.lastApplied = { muted: media.muted, volume: media.volume }, !0;
  } catch {
    return !1;
  }
}
function _restorePlayerPreferenceSnapshot(snapshot, options = {}) {
  if (!snapshot || typeof snapshot != "object" || snapshot.__isCurrent && !snapshot.__isCurrent())
    return !1;
  const safeChannel = _normalizePlayerChannel(options.channel), safeMediaKey = _normalizeMediaKey(options.mediaKey);
  if ((safeChannel || safeMediaKey) && !_isPlaybackRecoveryContextCurrent(safeChannel, safeMediaKey))
    return !1;
  try {
    for (const key of _PLAYER_PREFERENCE_KEYS) {
      if (!Object.hasOwn(snapshot, key) || snapshot.__storageValues && Object.hasOwn(snapshot.__storageValues, key) && localStorage.getItem(key) !== snapshot.__storageValues[key] || snapshot.__storageVersions && Object.hasOwn(snapshot.__storageVersions, key) && Number(snapshot.__storageVersions[key]) !== (_PlayerPreferenceStorageState.versions.get(key) || 0))
        continue;
      const value = snapshot[key];
      if (value === null || typeof value > "u") {
        localStorage.removeItem(key);
        continue;
      }
      localStorage.setItem(key, String(value));
    }
    _restorePlayerMediaPreferenceSnapshot(snapshot.__mediaState, options);
  } catch {
    return !1;
  }
  return !0;
}
function _schedulePlayerMediaPreferenceRestores(snapshot, channel = null, mediaKey = null, delays = [120, 500, 1500, 3e3], cycleStartedAt = 0) {
  if (!snapshot?.__mediaState)
    return !1;
  for (const delay of delays)
    _schedulePlaybackRecoveryTimeout(() => {
      _restorePlayerMediaPreferenceSnapshot(snapshot.__mediaState, {
        channel,
        mediaKey
      });
    }, delay, channel, mediaKey, cycleStartedAt);
  return !0;
}
function _schedulePlayerPreferenceRestore(snapshot, channel = null, mediaKey = null, delay = 3e3, cycleStartedAt = 0) {
  if (!snapshot || typeof snapshot != "object")
    return !1;
  const safeChannel = _normalizePlayerChannel(channel), safeMediaKey = _normalizeMediaKey(mediaKey);
  return _clearPendingPlayerPreferenceRestore(), _PlayerPreferenceRestoreState.channel = safeChannel, _PlayerPreferenceRestoreState.mediaKey = safeMediaKey, _PlayerPreferenceRestoreState.cycleStartedAt = Math.max(0, Number(cycleStartedAt) || 0), _PlayerPreferenceRestoreState.timeoutId = setTimeout(() => {
    const restoreChannel = _PlayerPreferenceRestoreState.channel, restoreMediaKey = _PlayerPreferenceRestoreState.mediaKey, restoreCycleStartedAt = _PlayerPreferenceRestoreState.cycleStartedAt;
    _clearPendingPlayerPreferenceRestore(), !(restoreCycleStartedAt > 0 && !_isOwnedPlayerLifecycleCycleCurrent(restoreMediaKey, restoreCycleStartedAt)) && _restorePlayerPreferenceSnapshot(snapshot, {
      channel: restoreChannel,
      mediaKey: restoreMediaKey
    });
  }, Math.max(0, delay)), !0;
}
let _PipDeferredReloadEntry = null;
function _registerPipDeferredReload(options = {}) {
  const pipElement = document.pictureInPictureElement, activeContext = _getActivePictureInPicturePlaybackContext(), mediaKey = _normalizeMediaKey(options.mediaKey) || activeContext?.MediaKey;
  if (!(pipElement instanceof HTMLMediaElement) || activeContext?.element !== pipElement || !mediaKey || activeContext.MediaKey !== mediaKey)
    return !1;
  const previousEntry = _PipDeferredReloadEntry;
  if (previousEntry?.element && previousEntry.listener)
    try {
      previousEntry.element.removeEventListener("leavepictureinpicture", previousEntry.listener);
    } catch {
    }
  const entry = {
    options: {
      ...options,
      cycleStartedAt: Math.max(0, Number(options.cycleStartedAt) || _getPlayerLifecycleCycleStartedAt(mediaKey))
    },
    channel: _normalizePlayerChannel(options.channel) || activeContext.ChannelName,
    mediaKey,
    element: pipElement,
    listener: null
  };
  return entry.listener = () => {
    if (_PipDeferredReloadEntry !== entry || (_PipDeferredReloadEntry = null, _clearActivePictureInPicturePlaybackContext(entry.element), _PostAdRecoveryTransactionState.mediaKey && !_maintainPostAdRecoveryTransactionLifetime()) || !_isPlaybackRecoveryContextCurrent(entry.channel, entry.mediaKey) || __TTVAB_STATE__.CurrentAdMediaKey || __TTVAB_STATE__.CurrentAdChannel)
      return;
    const deferredCycleStartedAt = Math.max(0, Number(entry.options.cycleStartedAt) || 0);
    deferredCycleStartedAt > 0 && !_isOwnedPlayerLifecycleCycleCurrent(entry.mediaKey, deferredCycleStartedAt) || _hasUserPauseIntent(entry.channel, entry.mediaKey) || _shouldSuppressAutomaticPlaybackResume(entry.channel, entry.mediaKey) || _doPlayerTask(!1, !0, entry.options);
  }, _PipDeferredReloadEntry = entry, pipElement.addEventListener("leavepictureinpicture", entry.listener, {
    once: !0
  }), !0;
}
function _doPlayerTask(isPausePlay, isReload, options = {}) {
  if (typeof document !== "undefined" && document.documentElement?.dataset.drophunterPlaybackSuspended === window.location.href)
    return !1;
  const requestedChannel = _normalizePlayerChannel(options.channel), requestedMediaKey = _normalizeMediaKey(options.mediaKey), taskChannel = requestedChannel || _normalizePlayerChannel(__TTVAB_STATE__.PageChannel), taskMediaKey = requestedMediaKey || _normalizeMediaKey(__TTVAB_STATE__.PageMediaKey), pipContext = _getActivePictureInPicturePlaybackContext(), isPipTask = pipContext !== null && _isActivePictureInPicturePlaybackContext({
    ChannelName: taskChannel,
    MediaKey: taskMediaKey
  }), pipWorker = isPipTask ? pipContext.workerRef?.deref?.() : null;
  if ((isPausePlay || isReload) && (pipWorker?.__TTVABCrashed === !0 || pipWorker?.__TTVABIntentionallyTerminated === !0))
    return !1;
  const reason = options.reason || "manual", isExactNativePostAdSoftReload = !!(reason === "post-ad" && isReload && options.refreshAccessToken === !1 && options.newMediaPlayerInstance === !1), requestedCycleStartedAt = Math.max(0, Number(options.cycleStartedAt) || (reason === "ad-recovery" || isExactNativePostAdSoftReload || reason === "post-ad-native-restore" ? _getPlayerLifecycleCycleStartedAt(taskMediaKey) : 0)), isTerminalPostAdTask = !!(isExactNativePostAdSoftReload || reason === "post-ad-native-restore" || reason === "ad-recovery" && !__TTVAB_STATE__?.CurrentAdMediaKey && !__TTVAB_STATE__?.CurrentAdChannel);
  if (isTerminalPostAdTask && !_startPostAdRecoveryTransaction(taskChannel, taskMediaKey, requestedCycleStartedAt) || isTerminalPostAdTask && !_maintainPostAdRecoveryTransactionLifetime())
    return !1;
  if (isExactNativePostAdSoftReload && _PostAdRecoveryTransactionState.acceptedReloadCount > 0)
    return !0;
  isTerminalPostAdTask && isReload && options.newMediaPlayerInstance !== !1 && (_PostAdRecoveryTransactionState.requiresReplacement = !0);
  const { player, state: playerState } = _getPlayerAndState();
  if (!player && !isPipTask || !playerState && isReload && !isPipTask)
    return isTerminalPostAdTask && _rememberPendingPostAdRecoveryOperation(isPausePlay, isReload, options), !1;
  const playerCore = _getPlayerCore(player);
  if (!isPipTask && (isPausePlay || isReload) && _isPlayerWorkerUnavailable(player))
    return !1;
  const handoffId = reason === "codec-handoff" && typeof options.handoffId == "string" && options.handoffId ? options.handoffId : null;
  if (reason === "codec-handoff" && !handoffId)
    return !1;
  const handoffIdCycleStartedAt = handoffId ? _getCodecHandoffCycleStartedAt(handoffId) : 0;
  if (reason === "codec-handoff") {
    const currentAdChannel = _normalizePlayerChannel(__TTVAB_STATE__?.CurrentAdChannel), currentAdMediaKey = _normalizeMediaKey(__TTVAB_STATE__?.CurrentAdMediaKey);
    if (!!!(requestedMediaKey && currentAdMediaKey === requestedMediaKey && requestedCycleStartedAt > 0 && handoffIdCycleStartedAt === requestedCycleStartedAt && _isCodecHandoffCycleCurrent(requestedMediaKey, requestedCycleStartedAt) && (!requestedChannel || !currentAdChannel || requestedChannel === currentAdChannel)))
      return !1;
  }
  const activeCodecHandoffId = typeof __TTVAB_STATE__.ActiveCodecHandoffId == "string" && __TTVAB_STATE__.ActiveCodecHandoffId ? __TTVAB_STATE__.ActiveCodecHandoffId : null;
  if (!!(handoffId && activeCodecHandoffId && _getCodecHandoffCycleStartedAt(activeCodecHandoffId) === requestedCycleStartedAt && _matchesPlaybackTargetContext(__TTVAB_STATE__.ActiveCodecHandoffChannel, __TTVAB_STATE__.ActiveCodecHandoffMediaKey, taskChannel, taskMediaKey)) && options.replaceCodecHandoff !== !0) {
    const codecHandoffContext = {
      mediaType: __TTVAB_STATE__?.PageMediaType ?? null,
      channelName: taskChannel,
      vodID: __TTVAB_STATE__?.PageVodID ?? null,
      mediaKey: taskMediaKey,
      reason,
      handoffId: activeCodecHandoffId,
      cycleStartedAt: requestedCycleStartedAt
    };
    return _broadcastWorkers([
      {
        key: "UpdateCodecHandoffContext",
        targetMediaKey: taskMediaKey,
        value: codecHandoffContext
      },
      {
        key: "TriggeredPlayerReload",
        targetMediaKey: taskMediaKey,
        value: codecHandoffContext
      }
    ]), !0;
  }
  if (reason !== "manual" && reason !== "codec-handoff" && _shouldSuppressAutomaticPlaybackResume(taskChannel, taskMediaKey))
    return (reason === "ad-recovery" || reason === "buffer-recovery") && _clearAdResumeIntent(), !1;
  if (isReload) {
    const needsRealReload = options.refreshAccessToken !== !1 || options.newMediaPlayerInstance !== !1;
    if (isPipTask && pipContext) {
      const currentContext = _getCurrentPlaybackRecoveryContext(), isTaskRouteCurrent = !!(taskMediaKey && currentContext.mediaKey === taskMediaKey), content = playerState?.props?.content, playerContext = _normalizePlaybackContext({
        MediaType: content?.type,
        ChannelName: content?.channelLogin,
        VodID: content?.vodID
      }), isPipPlayerCurrent = !!(playerState && player?.getHTMLVideoElement?.() === pipContext.element && playerContext.MediaKey === taskMediaKey);
      if (reason === "manual" && (!isTaskRouteCurrent || !isPipPlayerCurrent) || _hasUserPauseIntent(taskChannel, taskMediaKey))
        return !1;
      if (!(isTaskRouteCurrent && isPipPlayerCurrent && (reason === "manual" || reason === "codec-handoff" || reason === "worker-recovery"))) {
        const deferredReload = needsRealReload && reason !== "codec-handoff" && _registerPipDeferredReload({
          ...options,
          channel: taskChannel,
          mediaKey: taskMediaKey,
          cycleStartedAt: requestedCycleStartedAt
        });
        return needsRealReload && !deferredReload ? !1 : (_pausePlaybackTarget(pipContext.element), _scheduleResumeRetries(taskChannel, taskMediaKey, [50, 180, 500, 1100], { cycleStartedAt: requestedCycleStartedAt }), reason !== "codec-handoff");
      }
    }
  }
  if (isTerminalPostAdTask && !isPausePlay && !isReload)
    return _completePendingPostAdRecoveryOperation(), !0;
  if (isPausePlay) {
    if (isPipTask && pipContext)
      return pipContext.element.paused || pipContext.element.ended ? !1 : (_pausePlaybackTarget(pipContext.element), _scheduleResumeRetries(taskChannel, taskMediaKey, [50, 180, 500], {
        cycleStartedAt: requestedCycleStartedAt
      }), isTerminalPostAdTask && _completePendingPostAdRecoveryOperation(), !0);
    if (_isPlayerPaused(player, playerCore))
      return !1;
    const pauseState = __TTVAB_STATE__, pauseContextGeneration = pauseState.PagePlaybackContextGeneration;
    _pausePlaybackTarget(player);
    const resumePausedPlayer = () => {
      if (__TTVAB_STATE__ !== pauseState || pauseState.PagePlaybackContextGeneration !== pauseContextGeneration || !_isPlaybackRecoveryContextCurrent(taskChannel, taskMediaKey) || requestedCycleStartedAt > 0 && !_isOwnedPlayerLifecycleCycleCurrent(taskMediaKey, requestedCycleStartedAt))
        return;
      const { player: freshPlayer } = _getPlayerAndState();
      _playPlaybackTarget(freshPlayer || player, taskChannel, taskMediaKey);
    };
    return _isNativeDocumentHidden({
      ChannelName: taskChannel,
      MediaKey: taskMediaKey
    }) ? queueMicrotask(resumePausedPlayer) : _schedulePlaybackRecoveryTimeout(resumePausedPlayer, 50, taskChannel, taskMediaKey, requestedCycleStartedAt), isTerminalPostAdTask && _completePendingPostAdRecoveryOperation(), !0;
  }
  if (isReload) {
    const isAdRecoveryReload = reason === "ad-recovery", now = Date.now(), lastPlayerReloadAt = __TTVAB_STATE__?.LastPlayerReloadAt || 0;
    if (reason !== "codec-handoff" && lastPlayerReloadAt && now - lastPlayerReloadAt < __TTVAB_STATE__.PlayerReloadDebounceMs)
      return !1;
    if (isAdRecoveryReload && __TTVAB_STATE__.LastAdRecoveryReloadAt) {
      const consecutiveFailures = Math.max(0, Number(__TTVAB_STATE__._AdRecoveryConsecutiveFailures) || 0), baseCooldown = __TTVAB_STATE__.AdRecoveryReloadCooldownMs || 1e4, backoffCooldown = Math.min(6e4, baseCooldown * 2 ** Math.min(consecutiveFailures, 3));
      if (now - __TTVAB_STATE__.LastAdRecoveryReloadAt < backoffCooldown)
        return consecutiveFailures > 0, _doPlayerTask(!0, !1, options);
    }
    __TTVAB_STATE__.LastPlayerReloadAt = now, _recordPlayerReloadAt(taskMediaKey, now), isAdRecoveryReload && (__TTVAB_STATE__.LastAdRecoveryReloadAt = now, __TTVAB_STATE__._AdRecoveryConsecutiveFailures = (Number(__TTVAB_STATE__._AdRecoveryConsecutiveFailures) || 0) + 1), reason !== "manual" && _suppressPauseIntent(__TTVAB_STATE__.PageChannel, __TTVAB_STATE__.PageMediaKey, 3e3), _clearCachedPlayerRef(!0, __TTVAB_STATE__.PlayerReloadDebounceMs || 0);
    const reloadContentType = typeof playerState?.props?.content?.type == "string" ? playerState.props.content.type : null, reloadVideo = player?.getHTMLVideoElement?.() || null, replacementBaselineVideo = isTerminalPostAdTask && options.newMediaPlayerInstance !== !1 ? reloadVideo : null, vodResumePosition = reloadContentType === "vod" && Number.isFinite(Number(reloadVideo?.currentTime)) && Number(reloadVideo.currentTime) > 1 ? Number(reloadVideo.currentTime) : null, reloadInteractionAt = _PlaybackIntentState.lastPlaybackControlInteractionAt, reloadVodID = _normalizeVodID(playerState?.props?.content?.vodID), preferenceSnapshot = _capturePlayerPreferenceSnapshot(playerCore, reloadVideo, {
      channel: __TTVAB_STATE__.PageChannel,
      mediaKey: __TTVAB_STATE__.PageMediaKey,
      preserveConfiguredQuality: reason !== "manual"
    });
    isTerminalPostAdTask && options.newMediaPlayerInstance !== !1 && (_PostAdRecoveryTransactionState.requiresReplacement = !0, _PostAdRecoveryTransactionState.requiredReplacementVideo = replacementBaselineVideo instanceof HTMLMediaElement ? new WeakRef(replacementBaselineVideo) : null, _PostAdRecoveryTransactionState.requiredNativeReloadAt = now, _PostAdRecoveryTransactionState.nativeReloadConfirmedAt = 0, _PostAdRecoveryTransactionState.video = null, _PostAdRecoveryTransactionState.observedAt = 0, _PostAdRecoveryTransactionState.lastCurrentTime = 0, _PostAdRecoveryTransactionState.stallTicks = 0);
    const previousCodecHandoff = {
      id: __TTVAB_STATE__.ActiveCodecHandoffId,
      channel: __TTVAB_STATE__.ActiveCodecHandoffChannel,
      mediaKey: __TTVAB_STATE__.ActiveCodecHandoffMediaKey
    };
    handoffId && (__TTVAB_STATE__.ActiveCodecHandoffId = handoffId, __TTVAB_STATE__.ActiveCodecHandoffChannel = taskChannel, __TTVAB_STATE__.ActiveCodecHandoffMediaKey = taskMediaKey, _broadcastWorkers({
      key: "UpdateCodecHandoffContext",
      targetMediaKey: taskMediaKey,
      value: {
        handoffId,
        channelName: taskChannel,
        mediaKey: taskMediaKey,
        cycleStartedAt: requestedCycleStartedAt
      }
    }));
    const reloadState = __TTVAB_STATE__, reloadContextGeneration = reloadState.PagePlaybackContextGeneration, reloadCycleStartedAt = _getPlayerLifecycleCycleStartedAt(taskMediaKey), isReloadCurrent = () => __TTVAB_STATE__ === reloadState && _getPlayerReloadAtForMediaKey(taskMediaKey) === now && (reloadState.PagePlaybackContextGeneration === reloadContextGeneration || _isActivePictureInPicturePlaybackContext({ MediaKey: taskMediaKey })) && _isPlaybackRecoveryContextCurrent(taskChannel, taskMediaKey) && _getPlayerLifecycleCycleStartedAt(taskMediaKey) === reloadCycleStartedAt;
    preferenceSnapshot && (preferenceSnapshot.__isCurrent = isReloadCurrent, preferenceSnapshot.__mediaState && (preferenceSnapshot.__mediaState.isCurrent = isReloadCurrent));
    const handleReloadFailure = (error) => {
      if (isReloadCurrent() && handoffId) {
        if (__TTVAB_STATE__.ActiveCodecHandoffId === handoffId && _matchesPlaybackTargetContext(__TTVAB_STATE__.ActiveCodecHandoffChannel, __TTVAB_STATE__.ActiveCodecHandoffMediaKey, taskChannel, taskMediaKey)) {
          const previousCycleStartedAt2 = _getCodecHandoffCycleStartedAt(previousCodecHandoff.id), previousHandoffIsCurrent = !!(previousCodecHandoff.id && previousCodecHandoff.mediaKey && _isCodecHandoffCycleCurrent(previousCodecHandoff.mediaKey, previousCycleStartedAt2));
          __TTVAB_STATE__.ActiveCodecHandoffId = previousHandoffIsCurrent ? previousCodecHandoff.id : null, __TTVAB_STATE__.ActiveCodecHandoffChannel = previousHandoffIsCurrent ? previousCodecHandoff.channel : null, __TTVAB_STATE__.ActiveCodecHandoffMediaKey = previousHandoffIsCurrent ? previousCodecHandoff.mediaKey : null;
        }
        _broadcastWorkers({
          key: "UpdateCodecHandoffContext",
          targetMediaKey: taskMediaKey,
          value: {
            clearHandoffId: handoffId,
            channelName: taskChannel,
            mediaKey: taskMediaKey,
            cycleStartedAt: requestedCycleStartedAt
          }
        });
        const previousCycleStartedAt = _getCodecHandoffCycleStartedAt(previousCodecHandoff.id);
        options.replaceCodecHandoff === !0 && previousCodecHandoff.id && previousCodecHandoff.mediaKey && _isCodecHandoffCycleCurrent(previousCodecHandoff.mediaKey, previousCycleStartedAt) && _matchesPlaybackTargetContext(previousCodecHandoff.channel, previousCodecHandoff.mediaKey, taskChannel, taskMediaKey) && _broadcastWorkers({
          key: "UpdateCodecHandoffContext",
          targetMediaKey: taskMediaKey,
          value: {
            handoffId: previousCodecHandoff.id,
            channelName: previousCodecHandoff.channel,
            mediaKey: previousCodecHandoff.mediaKey,
            cycleStartedAt: previousCycleStartedAt
          }
        });
      }
    };
    let sourceLoadResult = null;
    isTerminalPostAdTask && options.refreshAccessToken === !1 && options.newMediaPlayerInstance !== !1 && _broadcastWorkers({
      key: "PreparePostAdNativeReload",
      targetMediaKey: taskMediaKey,
      value: {
        mediaKey: taskMediaKey,
        cycleStartedAt: requestedCycleStartedAt,
        reloadAt: now,
        reason,
        preserveNativeSession: !0
      }
    });
    try {
      sourceLoadResult = playerState.setSrc({
        isNewMediaPlayerInstance: options.newMediaPlayerInstance !== !1,
        refreshAccessToken: options.refreshAccessToken !== !1
      });
    } catch (error) {
      throw handleReloadFailure(error), error;
    }
    isTerminalPostAdTask && (isExactNativePostAdSoftReload || reason === "post-ad-native-restore" && !_PostAdRecoveryTransactionState.initialOperationCompleted) && _PostAdRecoveryTransactionState.acceptedReloadCount++, isTerminalPostAdTask && _completePendingPostAdRecoveryOperation(), _broadcastWorkers({
      key: "TriggeredPlayerReload",
      value: {
        mediaType: __TTVAB_STATE__?.PageMediaType ?? null,
        channelName: taskChannel,
        vodID: __TTVAB_STATE__?.PageVodID ?? null,
        mediaKey: taskMediaKey,
        reason,
        handoffId,
        cycleStartedAt: requestedCycleStartedAt,
        reloadAt: now,
        preserveNativeSession: !!(isTerminalPostAdTask && options.refreshAccessToken === !1 && options.newMediaPlayerInstance !== !1)
      }
    });
    const finishReload = () => {
      if (_playPlaybackTarget(player, taskChannel, taskMediaKey), _scheduleResumeRetries(taskChannel, taskMediaKey, [180, 500, 1100], {
        cycleStartedAt: requestedCycleStartedAt
      }), vodResumePosition !== null) {
        let positionRestored = !1;
        for (const restoreDelay of [1200, 3e3])
          _schedulePlaybackRecoveryTimeout(() => {
            try {
              if (positionRestored)
                return;
              if (!isReloadCurrent() || _hasUserPauseIntent(taskChannel, taskMediaKey) || _PlaybackIntentState.lastPlaybackControlInteractionAt !== reloadInteractionAt || reason !== "manual" && _shouldSuppressAutomaticPlaybackResume(taskChannel, taskMediaKey) || isTerminalPostAdTask && !_maintainPostAdRecoveryTransactionLifetime()) {
                positionRestored = !0;
                return;
              }
              const { player: vodPlayer, state: vodState } = _getPlayerAndState(), vodVideo = vodPlayer?.getHTMLVideoElement?.() || null;
              if (!vodPlayer || !vodState || !vodVideo)
                return;
              if (vodPlayer !== player || vodState !== playerState || vodState.props?.content?.type !== "vod" || _normalizeVodID(vodState.props?.content?.vodID) !== reloadVodID || vodVideo.ended || vodVideo.isConnected === !1) {
                positionRestored = !0;
                return;
              }
              const currentPos = Number(vodVideo.currentTime);
              if (!Number.isFinite(currentPos) || vodVideo.readyState === 0)
                return;
              const resetPlaybackLimit = Math.max(0, Date.now() - now) / 1e3 * Math.max(1, Number(vodVideo.playbackRate) || 1) + 2;
              if (currentPos >= vodResumePosition - 2 || currentPos > resetPlaybackLimit) {
                positionRestored = !0;
                return;
              }
              typeof vodPlayer?.seekTo == "function" ? vodPlayer.seekTo(vodResumePosition) : vodVideo.currentTime = vodResumePosition, positionRestored = Math.abs(Number(vodVideo.currentTime) - vodResumePosition) <= 2;
            } catch {
            }
          }, restoreDelay, taskChannel, taskMediaKey, requestedCycleStartedAt);
      }
      preferenceSnapshot && (_schedulePlayerMediaPreferenceRestores(preferenceSnapshot, taskChannel, taskMediaKey, void 0, requestedCycleStartedAt), _schedulePlayerPreferenceRestore(preferenceSnapshot, taskChannel, taskMediaKey, 3e3, requestedCycleStartedAt));
    }, completeSourceLoad = (result, asynchronous = !1) => result === "failure" || result === "skipped" || result === !1 ? (handleReloadFailure(new Error(`source load ${String(result)}`)), !1) : asynchronous && (!isReloadCurrent() || _getPlayerAndState().player !== player || _hasUserPauseIntent(taskChannel, taskMediaKey) || reason !== "manual" && reason !== "codec-handoff" && _shouldSuppressAutomaticPlaybackResume(taskChannel, taskMediaKey) || isTerminalPostAdTask && !_maintainPostAdRecoveryTransactionLifetime()) ? !1 : (finishReload(), !0);
    return sourceLoadResult && typeof sourceLoadResult.then == "function" ? (Promise.resolve(sourceLoadResult).then((result) => completeSourceLoad(result, !0)).catch(handleReloadFailure), !0) : completeSourceLoad(sourceLoadResult);
  }
  return !1;
}
function _checkPinnedBackupStall(player, channel = null, mediaKey = null) {
  if (!__TTVAB_STATE__?.IsBufferFixEnabled) {
    _resetPinnedBackupStallState();
    return;
  }
  const pinnedType = __TTVAB_STATE__.PinnedBackupPlayerType;
  if (!pinnedType) {
    _resetPinnedBackupStallState();
    return;
  }
  const safeMediaKey = _normalizeMediaKey(mediaKey) || _normalizeMediaKey(__TTVAB_STATE__.PinnedBackupPlayerMediaKey) || _resolvePlayerMediaKey(channel, mediaKey), safeChannel = _normalizePlayerChannel(channel) || _normalizePlayerChannel(__TTVAB_STATE__.PinnedBackupPlayerChannel);
  (_PinnedBackupStallState.lastPinnedType !== pinnedType || _PinnedBackupStallState.mediaKey !== safeMediaKey) && (_resetPinnedBackupStallState(), _PinnedBackupStallState.lastPinnedType = pinnedType, _PinnedBackupStallState.mediaKey = safeMediaKey);
  const video = player?.getHTMLVideoElement?.() || null;
  if (!(video instanceof HTMLMediaElement) || video.ended || Number(video.readyState) < 1) {
    _PinnedBackupStallState.videoRef = null, _PinnedBackupStallState.firstObservedAt = 0, _PinnedBackupStallState.lastCurrentTime = 0, _PinnedBackupStallState.lastBufferedEnd = 0;
    return;
  }
  _PinnedBackupStallState.videoRef?.deref() !== video && (_PinnedBackupStallState.videoRef = new WeakRef(video), _PinnedBackupStallState.firstObservedAt = 0, _PinnedBackupStallState.lastCurrentTime = 0, _PinnedBackupStallState.lastBufferedEnd = 0);
  const currentTime = Number(video.currentTime) || 0, bufferedEnd = video.buffered && video.buffered.length > 0 ? video.buffered.end(video.buffered.length - 1) : 0;
  if (currentTime < _PinnedBackupStallState.lastCurrentTime - 0.25) {
    _PinnedBackupStallState.firstObservedAt = 0, _PinnedBackupStallState.lastCurrentTime = currentTime, _PinnedBackupStallState.lastBufferedEnd = bufferedEnd;
    return;
  }
  let bufferedStart = 0;
  try {
    bufferedStart = video.buffered && video.buffered.length > 0 && Number(video.buffered.start(video.buffered.length - 1)) || 0;
  } catch {
  }
  const now = Date.now(), stallThresholdMs = Math.max(500, Number(__TTVAB_STATE__.PinnedBackupStallDetectionMs) || 3e3), rearmCooldownMs = Math.max(stallThresholdMs * 2, (Number(__TTVAB_STATE__.PinnedBackupStallDetectionMs) || 3e3) * 2), bufferAdvanced = _PinnedBackupStallState.lastBufferedEnd > 0 && bufferedEnd > _PinnedBackupStallState.lastBufferedEnd + 0.1, currentTimeAdvanced = _PinnedBackupStallState.lastCurrentTime > 0 && currentTime > _PinnedBackupStallState.lastCurrentTime + 0.25, bufferHeadroom = bufferedEnd - currentTime, dangerZone = _getLowLatencyDangerZone(_getPlayerCore(player)), bufferSafe = bufferHeadroom > dangerZone, playbackHasStarted = currentTime > 0 || bufferedEnd > 0, playheadOutsidePinnedTimeline = currentTime > bufferedEnd + dangerZone || bufferedStart > 0 && currentTime < bufferedStart - dangerZone, canRealignPinnedLiveBackup = !!(safeMediaKey?.startsWith("live:") && _normalizeMediaKey(__TTVAB_STATE__.CurrentAdMediaKey) === safeMediaKey && _normalizeMediaKey(__TTVAB_STATE__.PinnedBackupPlayerMediaKey) === safeMediaKey && !currentTimeAdvanced && playheadOutsidePinnedTimeline && _getFatalAdMediaErrorCode(video) === 0 && !_hasUserPauseIntent(safeChannel, safeMediaKey) && !_shouldSuppressAutomaticPlaybackResume(safeChannel, safeMediaKey) && _getPlaybackMediaElementForContext(safeChannel, safeMediaKey) === video);
  if (!!(canRealignPinnedLiveBackup && _PinnedBackupStallState.firstObservedAt > 0 && _PinnedBackupStallState.lastBufferedEnd <= 0 && bufferedEnd > 0)) {
    _PinnedBackupStallState.lastCurrentTime = currentTime, _PinnedBackupStallState.lastBufferedEnd = bufferedEnd;
    return;
  }
  if (!!(canRealignPinnedLiveBackup && _PinnedBackupStallState.firstObservedAt > 0 && now - _PinnedBackupStallState.firstObservedAt >= stallThresholdMs && bufferAdvanced)) {
    let timelineRealigned = !1;
    try {
      Number.isFinite(bufferedStart) && bufferedStart <= bufferedEnd && (video.currentTime = Math.max(bufferedStart, bufferedEnd - 0.5), timelineRealigned = !0);
    } catch {
    }
    if (timelineRealigned) {
      const cycleStartedAt = _getPlayerLifecycleCycleStartedAt(safeMediaKey);
      _markPinnedBackupTimelineRestore(safeMediaKey, cycleStartedAt), _resetPinnedBackupStallState(), _resumeActivePlayerIfPaused(safeChannel, safeMediaKey), _scheduleResumeRetries(safeChannel, safeMediaKey, [180, 650], {
        cycleStartedAt
      });
      return;
    }
  }
  if (currentTimeAdvanced || !canRealignPinnedLiveBackup && bufferSafe && bufferAdvanced) {
    _PinnedBackupStallState.firstObservedAt = 0, _PinnedBackupStallState.forceRefreshCount = 0, _PinnedBackupStallState.lastForceRefreshAt = 0, _PinnedBackupStallState.exhaustedLogged = !1, _PinnedBackupStallState.lastCurrentTime = currentTime, _PinnedBackupStallState.lastBufferedEnd = bufferedEnd;
    return;
  }
  if (!playbackHasStarted) {
    _PinnedBackupStallState.firstObservedAt = 0, _PinnedBackupStallState.lastCurrentTime = 0, _PinnedBackupStallState.lastBufferedEnd = 0;
    return;
  }
  if (_PinnedBackupStallState.firstObservedAt === 0) {
    _PinnedBackupStallState.firstObservedAt = now, _PinnedBackupStallState.lastCurrentTime = currentTime, _PinnedBackupStallState.lastBufferedEnd = bufferedEnd;
    return;
  }
  if (now - _PinnedBackupStallState.firstObservedAt > rearmCooldownMs * 4) {
    _PinnedBackupStallState.firstObservedAt = 0, _PinnedBackupStallState.lastCurrentTime = currentTime, _PinnedBackupStallState.lastBufferedEnd = bufferedEnd;
    return;
  }
  if (!(now - _PinnedBackupStallState.lastForceRefreshAt < rearmCooldownMs || __TTVAB_STATE__.BackupSearchForceRefreshAt > now - rearmCooldownMs) && !(now - _PinnedBackupStallState.firstObservedAt < stallThresholdMs)) {
    if (bufferSafe) {
      _PinnedBackupStallState.lastForceRefreshAt = now;
      return;
    }
    if (_PinnedBackupStallState.lastForceRefreshAt = now, _PinnedBackupStallState.forceRefreshCount >= 3) {
      _PinnedBackupStallState.exhaustedLogged || (_PinnedBackupStallState.exhaustedLogged = !0);
      return;
    }
    _PinnedBackupStallState.forceRefreshCount = (_PinnedBackupStallState.forceRefreshCount || 0) + 1, __TTVAB_STATE__.BackupSearchForceRefreshAt = now, __TTVAB_STATE__.LastPinnedBackupStallDetectedAt = now, _broadcastWorkers({
      key: "UpdateBackupSearchForceRefresh",
      ...safeMediaKey ? { targetMediaKey: safeMediaKey } : {},
      value: now
    });
  }
}
function _checkInAdPlayheadFreeze(player, channel = null, mediaKey = null) {
  const safeChannel = _normalizePlayerChannel(channel), safeMediaKey = _normalizeMediaKey(mediaKey);
  _InAdFreezeState.mediaKey !== safeMediaKey && _resetInAdFreezeState(safeMediaKey);
  const video = player?.getHTMLVideoElement?.() || null;
  if (!(video instanceof HTMLMediaElement) || video.ended || Number(video.readyState) < 1) {
    _resetInAdFreezeState(safeMediaKey);
    return;
  }
  const currentTime = Number(video.currentTime) || 0;
  (_InAdFreezeState.video !== video || _InAdFreezeState.lastCurrentTime >= 0 && currentTime < _InAdFreezeState.lastCurrentTime - 0.25) && (_resetInAdFreezeState(safeMediaKey), _InAdFreezeState.video = video);
  const bufferedEnd = video.buffered && video.buffered.length > 0 ? video.buffered.end(video.buffered.length - 1) : 0, playbackHasStarted = currentTime > 0 || bufferedEnd > 0, advanced = _InAdFreezeState.lastCurrentTime >= 0 && currentTime > _InAdFreezeState.lastCurrentTime + 0.25;
  if (!playbackHasStarted || video.paused || advanced) {
    _resetInAdFreezeState(safeMediaKey), _InAdFreezeState.video = video, _InAdFreezeState.lastCurrentTime = currentTime;
    return;
  }
  const now = Date.now();
  if (_InAdFreezeState.firstFrozenAt === 0) {
    _InAdFreezeState.firstFrozenAt = now, _InAdFreezeState.lastCurrentTime = currentTime;
    return;
  }
  if (now - _InAdFreezeState.firstFrozenAt < _IN_AD_FREEZE_DETECT_MS || now - _InAdFreezeState.lastActionAt < _IN_AD_FREEZE_ACTION_REPEAT_MS)
    return;
  _InAdFreezeState.lastActionAt = now, _InAdFreezeState.actionCount++;
  const frozenSeconds = Math.round((now - _InAdFreezeState.firstFrozenAt) / 100) / 10;
  if ((_getContiguousBufferedEnd(video, currentTime) - currentTime < _getLowLatencyDangerZone(_getPlayerCore(player)) ? _seekPastBufferedGap(video, currentTime) : 0) > 0) {
    _resetInAdFreezeState(safeMediaKey);
    return;
  }
  if (_InAdFreezeState.actionCount > _IN_AD_FREEZE_RELOAD_AFTER_ATTEMPTS && !_isNativeDocumentHidden()) {
    _doPlayerTask(!1, !0, {
      reason: "buffer-recovery",
      ...safeChannel ? { channel: safeChannel } : {},
      ...safeMediaKey ? { mediaKey: safeMediaKey } : {}
    }), _InAdFreezeState.actionCount = 0;
    return;
  }
  _InAdFreezeState.actionCount > _IN_AD_FREEZE_RELOAD_AFTER_ATTEMPTS && (_InAdFreezeState.actionCount = 0), _doPlayerTask(!0, !1, {
    reason: "buffer-recovery",
    ...safeChannel ? { channel: safeChannel } : {},
    ...safeMediaKey ? { mediaKey: safeMediaKey } : {}
  });
}
function _checkHiddenCleanLiveStall(player, channel = null, mediaKey = null) {
  const safeChannel = _normalizePlayerChannel(channel), safeMediaKey = _normalizeMediaKey(mediaKey);
  if (!safeMediaKey || !_isNativeDocumentHidden() || __TTVAB_STATE__?.PageMediaType !== "live" || __TTVAB_STATE__?.CurrentAdMediaKey || __TTVAB_STATE__?.CurrentAdChannel || _hasUserPauseIntent(safeChannel, safeMediaKey) || _shouldSuppressAutomaticPlaybackResume(safeChannel, safeMediaKey))
    return _resetHiddenCleanLiveStallState(), !1;
  _HiddenCleanLiveStallState.mediaKey !== safeMediaKey && _resetHiddenCleanLiveStallState(safeMediaKey);
  const playerCore = _getPlayerCore(player), video = player?.getHTMLVideoElement?.() || null;
  if (!(video instanceof HTMLMediaElement) || video.ended || Number(video.readyState) < 1)
    return _resetHiddenCleanLiveStallState(safeMediaKey), !1;
  const currentTime = Number(video.currentTime) || 0, now = Date.now(), videoChanged = _HiddenCleanLiveStallState.videoRef?.deref() !== video;
  if (videoChanged || currentTime < _HiddenCleanLiveStallState.lastCurrentTime)
    return _HiddenCleanLiveStallState.videoRef = new WeakRef(video), _HiddenCleanLiveStallState.lastCurrentTime = currentTime, _HiddenCleanLiveStallState.firstFrozenAt = now, !1;
  if (_isPlayerPaused(player, playerCore, video))
    return !1;
  let bufferedEnd = 0;
  try {
    video.buffered?.length > 0 && (bufferedEnd = video.buffered.end(video.buffered.length - 1));
  } catch {
  }
  const playbackHasStarted = currentTime > 0 || bufferedEnd > 0, advanced = !videoChanged && _HiddenCleanLiveStallState.lastCurrentTime >= 0 && currentTime > _HiddenCleanLiveStallState.lastCurrentTime + 0.25;
  return !playbackHasStarted || advanced ? (_HiddenCleanLiveStallState.firstFrozenAt = 0, _HiddenCleanLiveStallState.lastCurrentTime = currentTime, !1) : _HiddenCleanLiveStallState.firstFrozenAt === 0 ? (_HiddenCleanLiveStallState.firstFrozenAt = now, _HiddenCleanLiveStallState.lastCurrentTime = currentTime, !1) : now - _HiddenCleanLiveStallState.firstFrozenAt < _HIDDEN_CLEAN_LIVE_STALL_DETECT_MS || now - _HiddenCleanLiveStallState.lastActionAt < _HIDDEN_CLEAN_LIVE_STALL_REPEAT_MS ? !1 : (_HiddenCleanLiveStallState.firstFrozenAt = now, _HiddenCleanLiveStallState.lastCurrentTime = currentTime, _HiddenCleanLiveStallState.lastActionAt = now, _doPlayerTask(!0, !1, {
    reason: "buffer-recovery",
    channel: safeChannel,
    mediaKey: safeMediaKey
  }) === !0);
}
function _checkPostBreakWedge(video, currentTime, channel = null, mediaKey = null) {
  if (_PostBreakWedgeState.remainingEvals <= 0)
    return !1;
  const safeChannel = _normalizePlayerChannel(channel), safeMediaKey = _normalizeMediaKey(mediaKey);
  if (_PostBreakWedgeState.mediaKey && _PostBreakWedgeState.mediaKey !== safeMediaKey)
    return _disarmPostBreakWedgeWatch(), !1;
  if (!(video instanceof HTMLVideoElement) || video.ended || video.paused || !(Number(video.videoWidth) > 0) || Number(video.readyState) < 2)
    return !1;
  if (typeof video.getVideoPlaybackQuality != "function")
    return _disarmPostBreakWedgeWatch(), !1;
  let totalFrames = -1;
  try {
    totalFrames = Number(video.getVideoPlaybackQuality()?.totalVideoFrames);
  } catch {
    return _disarmPostBreakWedgeWatch(), !1;
  }
  if (!Number.isFinite(totalFrames) || totalFrames < 0)
    return _disarmPostBreakWedgeWatch(), !1;
  const time = Number(currentTime) || 0, prevTime = _PostBreakWedgeState.lastCurrentTime, prevFrames = _PostBreakWedgeState.lastTotalFrames;
  if (_PostBreakWedgeState.lastCurrentTime = time, _PostBreakWedgeState.lastTotalFrames = totalFrames, prevTime < 0 || prevFrames < 0 || time <= prevTime + _POST_BREAK_WEDGE_MIN_TICK_ADVANCE_S)
    return !1;
  _PostBreakWedgeState.remainingEvals--;
  const framesDelta = totalFrames - prevFrames;
  return framesDelta >= _POST_BREAK_WEDGE_HEALTHY_FRAMES ? (_PostBreakWedgeState.evidenceCount = 0, _PostBreakWedgeState.healthyCount++, _PostBreakWedgeState.healthyCount >= _POST_BREAK_WEDGE_HEALTHY_TO_DISARM && _disarmPostBreakWedgeWatch(), !1) : (_PostBreakWedgeState.healthyCount = 0, framesDelta > _POST_BREAK_WEDGE_FRAME_EPS || (_PostBreakWedgeState.evidenceCount++, _PostBreakWedgeState.evidenceCount < _POST_BREAK_WEDGE_EVIDENCE_TO_ACT) ? !1 : (_PostBreakWedgeState.evidenceCount = 0, _PostBreakWedgeState.actionCount++, _PostBreakWedgeState.actionCount >= _POST_BREAK_WEDGE_MAX_ACTIONS ? (_disarmPostBreakWedgeWatch(), _doPlayerTask(!1, !0, {
    reason: "buffer-recovery",
    ...safeChannel ? { channel: safeChannel } : {},
    ...safeMediaKey ? { mediaKey: safeMediaKey } : {}
  })) : _doPlayerTask(!0, !1, {
    reason: "buffer-recovery",
    ...safeChannel ? { channel: safeChannel } : {},
    ...safeMediaKey ? { mediaKey: safeMediaKey } : {}
  }), _PlayerBufferState.lastFixTime = Date.now(), !0));
}
function _getPictureInPictureVideo() {
  try {
    const pipElement = document.pictureInPictureElement;
    if (pipElement instanceof HTMLVideoElement && pipElement.isConnected)
      return pipElement;
  } catch {
  }
  return null;
}
function _resetCleanPlaybackFailureSamples() {
  const observed = _PlayerBufferState.cleanPlayback;
  observed && (observed.videoRef = null, observed.workerRef = null, observed.currentTime = -1, observed.totalVideoFrames = -1, observed.lastCheckedAt = 0, observed.healthySinceAt = 0, observed.hadAdvancingPlayback = !1, observed.unreadySinceAt = 0);
}
function _isObservedCleanPlaybackFailure(video) {
  const observed = _PlayerBufferState.cleanPlayback;
  return !!(observed?.hadAdvancingPlayback && observed.mediaKey === _normalizeMediaKey(__TTVAB_STATE__.PageMediaKey) && observed.pageGeneration === (Number(__TTVAB_STATE__.PagePlaybackContextGeneration) || 0) && observed.videoRef?.deref() === video && observed.workerRef?.deref() === _getPlayerCore(_getPlayerAndState().player)?.worker && !__TTVAB_STATE__.CurrentAdMediaKey && !__TTVAB_STATE__.CurrentAdChannel && !__TTVAB_STATE__.PinnedBackupPlayerType && !_PostAdRecoveryTransactionState.mediaKey && video instanceof HTMLMediaElement && video.isConnected && !video.ended && Number(video.readyState) === 0 && Number(video.networkState) === 0 && Number(video.currentTime) === 0 && video.buffered.length === 0);
}
function _checkCleanPlaybackFailure(player, playerState) {
  const mediaKey = _normalizeMediaKey(__TTVAB_STATE__.PageMediaKey), pageGeneration = Number(__TTVAB_STATE__.PagePlaybackContextGeneration) || 0;
  let observed = _PlayerBufferState.cleanPlayback;
  (!observed || observed.mediaKey !== mediaKey || observed.pageGeneration !== pageGeneration) && (observed = _PlayerBufferState.cleanPlayback = {
    mediaKey,
    pageGeneration,
    videoRef: null,
    workerRef: null,
    currentTime: -1,
    totalVideoFrames: -1,
    lastCheckedAt: 0,
    healthySinceAt: 0,
    hadAdvancingPlayback: !1,
    unreadySinceAt: 0,
    reloadAttempted: !1
  });
  const video = player?.getHTMLVideoElement?.(), worker = _getPlayerCore(player)?.worker, now = Date.now(), eligible = !!(mediaKey && _getPlaybackContextFromUrl(window.location.href).MediaKey === mediaKey && __TTVAB_STATE__.PageMediaType === "live" && playerState?.props?.content?.type === "live" && _buildMediaKey("live", playerState.props.content.channelLogin, null) === mediaKey && typeof playerState.setSrc == "function" && __TTVAB_STATE__.IsAdStrippingEnabled === !0 && __TTVAB_STATE__.IsBufferFixEnabled === !0 && !__TTVAB_STATE__.CurrentAdMediaKey && !__TTVAB_STATE__.CurrentAdChannel && !__TTVAB_STATE__.PinnedBackupPlayerType && !__TTVAB_STATE__.ActiveCodecHandoffId && !_PostAdRecoveryTransactionState.mediaKey && !_hasPendingAdResumeIntent(null, mediaKey) && !_hasUserPauseIntent(null, mediaKey) && !_shouldSuppressAutomaticPlaybackResume(null, mediaKey) && !_isNativeDocumentHidden() && video instanceof HTMLVideoElement && video.isConnected && !video.ended && video !== _getPictureInPictureVideo() && video !== _getActivePictureInPicturePlaybackContext()?.element && worker && Number(worker.__TTVABGeneration) > 0 && worker.__TTVABPageMediaKey === mediaKey && !_isPlayerWorkerUnavailable(player) && Number(worker.__TTVABLastPongAt) > 0 && now >= worker.__TTVABLastPongAt && now - worker.__TTVABLastPongAt <= 1e4);
  if ((!eligible || observed.videoRef?.deref() !== video || observed.workerRef?.deref() !== worker || observed.lastCheckedAt > 0 && (now < observed.lastCheckedAt || now - observed.lastCheckedAt > 5e3)) && (_resetCleanPlaybackFailureSamples(), observed.videoRef = eligible ? new WeakRef(video) : null, observed.workerRef = eligible ? new WeakRef(worker) : null), !eligible)
    return !1;
  observed.lastCheckedAt = now;
  const currentTime = Number(video.currentTime) || 0;
  let frames = -1;
  try {
    const value = Number(video.getVideoPlaybackQuality?.()?.totalVideoFrames);
    Number.isFinite(value) && value >= 0 && (frames = value);
  } catch {
  }
  return !_isPlayerPaused(player, _getPlayerCore(player), video) && !video.error && video.readyState >= 2 && video.videoWidth > 0 && video.buffered.length > 0 && (observed.currentTime < 0 || currentTime > observed.currentTime && (frames < 0 || observed.totalVideoFrames < 0 || frames > observed.totalVideoFrames)) ? (observed.healthySinceAt || (observed.healthySinceAt = now), now - observed.healthySinceAt >= 5e3 && (observed.hadAdvancingPlayback = !0, observed.reloadAttempted = !1)) : observed.healthySinceAt = 0, observed.currentTime = currentTime, observed.totalVideoFrames = frames, _isObservedCleanPlaybackFailure(video) ? (observed.unreadySinceAt || (observed.unreadySinceAt = now), observed.reloadAttempted || now - observed.unreadySinceAt < 12e3 ? !1 : (observed.reloadAttempted = !0, _doPlayerTask(!1, !0, { reason: "buffer-recovery", mediaKey }), !0)) : (observed.unreadySinceAt = 0, !1);
}
function _monitorPlayerBuffering() {
  function check() {
    _playerBufferMonitorTimer = null;
    let scheduledDelay = Number(__TTVAB_STATE__?.PlayerBufferingDelay) || 600;
    try {
      scheduledDelay = runCheck();
    } catch {
      _clearCachedPlayerRef(), scheduledDelay = Math.max(scheduledDelay * 5, 3e3);
    }
    _playerBufferMonitorTimer = setTimeout(check, scheduledDelay);
  }
  function runCheck() {
    const currentMediaKey = _normalizeMediaKey(__TTVAB_STATE__.PageMediaKey), hasActiveAdContext = !!(__TTVAB_STATE__.CurrentAdMediaKey || __TTVAB_STATE__.CurrentAdChannel), activeAdChannel = hasActiveAdContext ? _normalizePlayerChannel(__TTVAB_STATE__.CurrentAdChannel) || _normalizePlayerChannel(__TTVAB_STATE__.PinnedBackupPlayerChannel) || _normalizePlayerChannel(__TTVAB_STATE__.PageChannel) : null, activeAdMediaKey = hasActiveAdContext ? _normalizeMediaKey(__TTVAB_STATE__.CurrentAdMediaKey) || _normalizeMediaKey(__TTVAB_STATE__.PinnedBackupPlayerMediaKey) || _buildMediaKey("live", __TTVAB_STATE__.CurrentAdChannel, null) || currentMediaKey : null;
    _PostBreakWedgeState.prevAdContext && !hasActiveAdContext && (_PostBreakWedgeState.prevAdMediaKey && _PostBreakWedgeState.prevAdMediaKey === currentMediaKey ? _armPostBreakWedgeWatch(_PostBreakWedgeState.prevAdMediaKey) : _disarmPostBreakWedgeWatch()), _PostBreakWedgeState.prevAdContext = hasActiveAdContext, _PostBreakWedgeState.prevAdMediaKey = hasActiveAdContext ? activeAdMediaKey : null;
    let hasPendingPostAdRecovery = _isPostAdRecoveryTransactionCurrent(__TTVAB_STATE__.PageChannel, currentMediaKey) || _hasPendingAdResumeIntent(__TTVAB_STATE__.PageChannel, currentMediaKey);
    _PostAdRecoveryTransactionState.mediaKey && _hasUserPauseIntent(__TTVAB_STATE__.PageChannel, currentMediaKey) && (_cancelPostAdRecoveryTransaction(!0), hasPendingPostAdRecovery = !1), hasPendingPostAdRecovery || _resetPostAdRecoveryMonitorSamples(), (hasActiveAdContext || hasPendingPostAdRecovery) && _resetCleanPlaybackFailureSamples();
    const isHidden = _isNativeDocumentHidden(), hiddenDelay = Math.max(__TTVAB_STATE__.PlayerBufferingDelay * 8, 5e3), nextDelay = isHidden ? hiddenDelay : __TTVAB_STATE__.PlayerBufferingDelay, idleDelay = isHidden ? hiddenDelay : Math.max(__TTVAB_STATE__.PlayerBufferingDelay * 5, 3e3);
    if (!hasActiveAdContext && currentMediaKey && _restoreReattachedSuppressedPrimaryMedia(), !_hasPlayerBufferMonitorRelevantContext())
      return _resetPlayerBufferMonitorState(), idleDelay;
    if (_shouldSuppressAutomaticPlaybackResume(activeAdChannel || __TTVAB_STATE__.PageChannel, activeAdMediaKey || currentMediaKey))
      return _resetCleanPlaybackFailureSamples(), _cancelPostAdRecoveryTransaction(!0), _PlayerBufferState.numSame = 0, _PlayerBufferState.fixAttempts = 0, _PlayerBufferState.liveEdgeStarveCount = 0, _PlayerBufferState.postAdUnhealthyCount = 0, _PlayerBufferState.postAdRecoveryStartedAt = 0, _resetPostAdGrace(), idleDelay;
    if (!__TTVAB_STATE__.IsBufferFixEnabled)
      return _cancelPostAdRecoveryTransaction(!0), _resetPlayerBufferMonitorState(), idleDelay;
    const hasLivePlaybackContext = __TTVAB_STATE__.PageMediaType === "live" && !!currentMediaKey;
    if (!(!!currentMediaKey && (__TTVAB_STATE__.PageMediaType === "live" || __TTVAB_STATE__.PageMediaType === "vod") || !!activeAdMediaKey))
      return _cancelPostAdRecoveryTransaction(!0), _resetPlayerBufferMonitorState(), idleDelay;
    if (hasActiveAdContext) {
      _resetPostAdRecoveryTransaction(), _resetHiddenCleanLiveStallState();
      const pipContext = _getActivePictureInPicturePlaybackContext(), targetsPictureInPicture = !!(activeAdMediaKey && _normalizeMediaKey(pipContext?.MediaKey) === activeAdMediaKey), targetsPage = !!(activeAdMediaKey && activeAdMediaKey === currentMediaKey);
      let pinPlayer = null, fatalRecoveryTargetsPage = !1;
      if (targetsPage) {
        const fresh = _getPlayerAndState();
        pinPlayer = fresh.player && fresh.state ? fresh.player : null;
        const video = pinPlayer?.getHTMLVideoElement?.() || null;
        video instanceof HTMLMediaElement && !video.isConnected && (!targetsPictureInPicture || video !== pipContext?.element) && (pinPlayer = null), _cachedPlayerRef && (_cachedPlayerRefMediaKey !== currentMediaKey || _cachedPlayerRef.player !== pinPlayer) && (_resetPinnedBackupStallState(), _resetInAdFreezeState()), _cachedPrimaryMediaElement !== (pinPlayer?.getHTMLVideoElement?.() || null) && _clearCachedPrimaryMediaElement(), _cachedPlayerRef = pinPlayer ? fresh : null, _cachedPlayerRefMediaKey = pinPlayer ? currentMediaKey : null, fatalRecoveryTargetsPage = !!pinPlayer;
      } else targetsPictureInPicture && pipContext?.element instanceof HTMLMediaElement && (pinPlayer = {
        core: { worker: pipContext.workerRef?.deref?.() || null },
        getHTMLVideoElement: () => pipContext.element
      });
      return _suppressCompetingMediaDuringAd(activeAdChannel, activeAdMediaKey), _isPlayerWorkerUnavailable(pinPlayer) ? (_resetFatalAdMediaRecoveryState(), _resetPinnedBackupStallState(), _resetInAdFreezeState(), _clearCachedPlayerRef(), idleDelay) : (fatalRecoveryTargetsPage ? _checkFatalAdMediaRecovery(pinPlayer) : _resetFatalAdMediaRecoveryState(), pinPlayer && __TTVAB_STATE__.PinnedBackupPlayerType && Number(__TTVAB_STATE__.PinnedBackupStallPollMs) > 0 ? _checkPinnedBackupStall(pinPlayer, activeAdChannel, activeAdMediaKey) : _resetPinnedBackupStallState(), pinPlayer ? _checkInAdPlayheadFreeze(pinPlayer, activeAdChannel, activeAdMediaKey) : _resetInAdFreezeState(), _resetPlayerBufferMonitorState(), nextDelay);
    }
    if (_resetPinnedBackupStallState(), _resetFatalAdMediaRecoveryState(), _resetInAdFreezeState(), hasPendingPostAdRecovery && _PostAdRecoveryTransactionState.mediaKey && (isHidden || !hasLivePlaybackContext)) {
      const { player, state } = _getPlayerAndState();
      return _maintainPostAdRecoveryTransactionLifetime() && player && state && !_isPlayerWorkerUnavailable(player) ? _handlePendingPostAdRecovery(player, _getPlayerCore(player), player.getHTMLVideoElement?.() || null, __TTVAB_STATE__.PageChannel, currentMediaKey, state.props?.content?.type || null) : (_PostAdRecoveryTransactionState.video = null, _PostAdRecoveryTransactionState.observedAt = 0, _PostAdRecoveryTransactionState.lastCurrentTime = 0, _PostAdRecoveryTransactionState.lastTotalFrames = -1, _PostAdRecoveryTransactionState.stallTicks = 0), _clearCachedPlayerRef(!1), nextDelay;
    }
    if (!hasLivePlaybackContext)
      return _resetPlayerBufferMonitorState(), idleDelay;
    _PostAdRecoveryTransactionState.mediaKey && !_maintainPostAdRecoveryTransactionLifetime() && (hasPendingPostAdRecovery = !1);
    const playerAndState = _getPlayerAndState(), currentPlayer = playerAndState.player && playerAndState.state ? playerAndState.player : null;
    if (_checkCleanPlaybackFailure(currentPlayer, playerAndState.state))
      return nextDelay;
    if (isHidden)
      return _PostAdRecoveryTransactionState.mediaKey && _tryRunPendingPostAdRecoveryOperation(__TTVAB_STATE__.PageChannel, currentMediaKey) ? (_clearCachedPlayerRef(!1), nextDelay) : (currentPlayer && !_isPlayerWorkerUnavailable(currentPlayer) ? _checkHiddenCleanLiveStall(currentPlayer, __TTVAB_STATE__.PageChannel, currentMediaKey) : _resetHiddenCleanLiveStallState(currentMediaKey), _clearCachedPlayerRef(!1), nextDelay);
    _resetHiddenCleanLiveStallState();
    const currentVideo = currentPlayer?.getHTMLVideoElement?.() || null;
    if ((_cachedPlayerRefMediaKey !== currentMediaKey || _cachedPlayerRef?.player !== currentPlayer || (_PlayerBufferState.videoRef?.deref() || null) !== currentVideo) && (_clearCachedPlayerRef(), _cachedPrimaryMediaElement !== currentVideo && _clearCachedPrimaryMediaElement()), _cachedPlayerRef) {
      _cachedPlayerRef = playerAndState;
      try {
        const player = _cachedPlayerRef.player, state = _cachedPlayerRef.state, playerCore = _getPlayerCore(player);
        if (_isPlayerWorkerUnavailable(player))
          return _clearCachedPlayerRef(), idleDelay;
        _syncPreferredQualityGroupThrottled();
        const playerContentType = typeof state?.props?.content?.type == "string" ? state.props.content.type : null;
        if (!playerCore)
          _clearCachedPlayerRef();
        else if (playerContentType && playerContentType !== "live" && playerContentType !== "rerun")
          _clearCachedPlayerRef();
        else if (hasPendingPostAdRecovery)
          _handlePendingPostAdRecovery(player, playerCore, player.getHTMLVideoElement?.() || null, __TTVAB_STATE__.PageChannel, currentMediaKey, playerContentType);
        else if (playerContentType === "live" && player.getHTMLVideoElement()?.ended && __TTVAB_STATE__.IsBufferFixEnabled)
          _doPlayerTask(!1, !0, { reason: "buffer-recovery" }), _PlayerBufferState.lastFixTime = Date.now();
        else if (_PlayerBufferState.postAdGraceUntil > 0 && (playerContentType === "live" || playerContentType === "rerun") && _handlePostAdGraceWatch(player, playerCore, player.getHTMLVideoElement?.() || null, __TTVAB_STATE__.PageChannel, currentMediaKey, playerContentType))
          _PlayerBufferState.numSame = 0, _PlayerBufferState.liveEdgeStarveCount = 0, _PlayerBufferState.fixAttempts = 0;
        else if (__TTVAB_STATE__.IsBufferFixEnabled && (playerContentType === "live" || playerContentType === "rerun") && !_isPlayerPaused(player, playerCore) && !player.getHTMLVideoElement()?.ended && _PlayerBufferState.lastFixTime <= Date.now() - _getLowLatencyMinRepeatDelay(playerCore)) {
          const { video, position, bufferedPosition, bufferDuration, currentTime, liveEdgeDistance, readyState, hasFutureData } = _readPlayerBufferTelemetry(player, playerCore);
          let totalVideoFrames = -1;
          try {
            const frames = Number(video?.getVideoPlaybackQuality?.()?.totalVideoFrames);
            Number.isFinite(frames) && frames >= 0 && (totalVideoFrames = frames);
          } catch {
          }
          const isStablePosition = _PlayerBufferState.currentTime === currentTime && (totalVideoFrames < 0 || _PlayerBufferState.totalVideoFrames < 0 || totalVideoFrames === _PlayerBufferState.totalVideoFrames);
          if (_PlayerBufferState.currentTime = currentTime, _PlayerBufferState.totalVideoFrames = totalVideoFrames, _checkPostBreakWedge(video, currentTime, __TTVAB_STATE__.PageChannel, currentMediaKey) || _trySeekPastFrozenBufferGap(video, currentTime, readyState))
            return _PlayerBufferState.bufferedPosition = bufferedPosition, _PlayerBufferState.bufferDuration = bufferDuration, nextDelay;
          const isStableBufferedPosition = _PlayerBufferState.bufferedPosition === bufferedPosition, isBufferRegressing = _PlayerBufferState.bufferDuration >= bufferDuration, hasPlaybackState = position !== 0 || bufferedPosition !== 0 || bufferDuration !== 0, isLikelyLiveEdgeStarvation = hasPlaybackState && bufferDuration < _getLowLatencyDangerZone(playerCore) && isStablePosition && isStableBufferedPosition && isBufferRegressing && !hasFutureData;
          if ((!__TTVAB_STATE__.PlayerBufferingPrerollCheckEnabled || position > __TTVAB_STATE__.PlayerBufferingPrerollCheckOffset) && isLikelyLiveEdgeStarvation)
            _PlayerBufferState.liveEdgeStarveCount++, _PlayerBufferState.numSame = 0, _PlayerBufferState.fixAttempts = 0, _PlayerBufferState.liveEdgeStarveCount, __TTVAB_STATE__.PlayerBufferingSameStateCount, _PlayerBufferState.liveEdgeStarveCount >= _PLAYER_BUFFER_LIVE_EDGE_RELOAD_COUNT && (_doPlayerTask(!1, !0, {
              reason: "buffer-recovery"
            }), _PlayerBufferState.lastFixTime = Date.now(), _PlayerBufferState.liveEdgeStarveCount = 0);
          else if ((!__TTVAB_STATE__.PlayerBufferingPrerollCheckEnabled || position > __TTVAB_STATE__.PlayerBufferingPrerollCheckOffset) && hasPlaybackState && isStablePosition) {
            if (_PlayerBufferState.liveEdgeStarveCount = 0, _PlayerBufferState.numSame++, _PlayerBufferState.numSame === __TTVAB_STATE__.PlayerBufferingSameStateCount) {
              if (_PlayerBufferState.fixAttempts++, video && video.buffered.length > 1) {
                for (let bi = 0; bi < video.buffered.length; bi++)
                  if (video.buffered.start(bi) > video.currentTime + 0.5) {
                    video.currentTime = video.buffered.start(bi), _PlayerBufferState.lastFixTime = Date.now(), _PlayerBufferState.numSame = 0;
                    break;
                  }
              }
              _PlayerBufferState.numSame !== 0 && (__TTVAB_STATE__.PlayerBufferingDoPlayerReload || _PlayerBufferState.fixAttempts >= 3 ? _doPlayerTask(!1, !0, {
                reason: "buffer-recovery"
              }) : _doPlayerTask(!0, !1), _PlayerBufferState.lastFixTime = Date.now(), _PlayerBufferState.numSame = 0);
            }
          } else
            _PlayerBufferState.liveEdgeStarveCount = 0, _PlayerBufferState.numSame = 0, _PlayerBufferState.fixAttempts = 0;
          _PlayerBufferState.bufferedPosition = bufferedPosition, _PlayerBufferState.bufferDuration = bufferDuration;
        }
      } catch {
        _clearCachedPlayerRef();
      }
    }
    return _cachedPlayerRef || (playerAndState.player && playerAndState.state ? (_syncPreferredQualityGroupThrottled(), _cachedPlayerRef = playerAndState, _cachedPlayerRefMediaKey = currentMediaKey, _PlayerBufferState.videoRef = currentVideo instanceof HTMLMediaElement ? new WeakRef(currentVideo) : null, _PostAdRecoveryTransactionState.mediaKey && _tryRunPendingPostAdRecoveryOperation(__TTVAB_STATE__.PageChannel, currentMediaKey)) : _PostAdRecoveryTransactionState.mediaKey && (_PostAdRecoveryTransactionState.video = null, _PostAdRecoveryTransactionState.observedAt = 0, _PostAdRecoveryTransactionState.lastCurrentTime = 0, _PostAdRecoveryTransactionState.stallTicks = 0)), !hasPendingPostAdRecovery && _PlayerBufferState.numSame === 0 && _PlayerBufferState.liveEdgeStarveCount === 0 && _PlayerBufferState.fixAttempts === 0 && _PlayerBufferState.postAdGraceUntil === 0 && _cachedPlayerRef !== null && nextDelay < _PLAYER_BUFFER_STEADY_DELAY_MS ? _PLAYER_BUFFER_STEADY_DELAY_MS : nextDelay;
  }
  window.addEventListener("pagehide", void 0), check();
}
function _hookVisibilityState() {
  const nativeVisibility = window.__TTVAB_NATIVE_VISIBILITY__ || {};
  if (nativeVisibility.hidden = typeof nativeVisibility.hidden == "function" ? nativeVisibility.hidden : _getDocumentPropertyGetter("hidden"), nativeVisibility.webkitHidden = typeof nativeVisibility.webkitHidden == "function" ? nativeVisibility.webkitHidden : _getDocumentPropertyGetter("webkitHidden"), nativeVisibility.mozHidden = typeof nativeVisibility.mozHidden == "function" ? nativeVisibility.mozHidden : _getDocumentPropertyGetter("mozHidden"), nativeVisibility.visibilityState = typeof nativeVisibility.visibilityState == "function" ? nativeVisibility.visibilityState : _getDocumentPropertyGetter("visibilityState"), nativeVisibility.hasFocus = typeof nativeVisibility.hasFocus == "function" ? nativeVisibility.hasFocus : _getDocumentPrototypeMethod("hasFocus"), window.__TTVAB_NATIVE_VISIBILITY__ = nativeVisibility, !window.__TTVAB_VISIBILITY_HARDENED__) {
    const queueVisibilityPlaybackGuard = () => {
      _syncPagePlaybackVisibilityState(), _guardPlaybackAcrossVisibilityTransition(__TTVAB_STATE__.PageChannel, __TTVAB_STATE__.PageMediaKey);
    };
    let isInstalled = !1;
    const install = () => {
      if (!isInstalled) {
        for (const eventName of [
          "visibilitychange",
          "webkitvisibilitychange",
          "mozvisibilitychange"
        ])
          document.addEventListener(eventName, queueVisibilityPlaybackGuard);
        window.addEventListener("blur", queueVisibilityPlaybackGuard), window.addEventListener("focus", queueVisibilityPlaybackGuard), isInstalled = !0;
      }
    }, uninstall = () => {
      if (isInstalled) {
        _syncPagePlaybackVisibilityState(!0);
        for (const eventName of [
          "visibilitychange",
          "webkitvisibilitychange",
          "mozvisibilitychange"
        ])
          document.removeEventListener(eventName, queueVisibilityPlaybackGuard);
        window.removeEventListener("blur", queueVisibilityPlaybackGuard), window.removeEventListener("focus", queueVisibilityPlaybackGuard), isInstalled = !1;
      }
    };
    install(), window.addEventListener("pagehide", uninstall), window.addEventListener("pageshow", () => {
      install(), _syncPagePlaybackVisibilityState(), queueVisibilityPlaybackGuard();
    }), window.__TTVAB_VISIBILITY_HARDENED__ = !0;
  }
}
function _isClipEditorContext() {
  if (String(window.location?.hostname || "").toLowerCase() === "clips.twitch.tv")
    return !0;
  const path = String(window.location?.pathname || "").toLowerCase();
  return /^\/[^/]+\/clip\/[^/]+/.test(path);
}
function _deferInitUntilClipContextLeft() {
  if (String(window.location?.hostname || "").toLowerCase() === "clips.twitch.tv")
    return;
  const intervalId = setInterval(() => {
    _isClipEditorContext() || (clearInterval(intervalId), _init(), setTimeout(() => {
      try {
        if (typeof _getPlayerAndState != "function" || typeof _doPlayerTask != "function")
          return;
        const { player } = _getPlayerAndState();
        if (!player)
          return;
        _doPlayerTask(!1, !0, {
          reason: "worker-recovery",
          refreshAccessToken: !0,
          newMediaPlayerInstance: !0
        });
      } catch {
      }
    }, 500));
  }, 250);
}
function _bootstrap() {
  return _isClipEditorContext() ? (_deferInitUntilClipContextLeft(), !1) : typeof window.ttvabVersion < "u" && window.ttvabVersion >= _C.INTERNAL_VERSION ? !1 : (window.ttvabVersion = _C.INTERNAL_VERSION, !0);
}
function _hookSpaNavigation() {
  const sync = () => {
    _syncPagePlaybackContext({ broadcast: !0 });
  }, originalPushState = history.pushState, hookedPushState = function(...args) {
    const result = originalPushState.apply(this, args);
    return sync(), result;
  }, originalReplaceState = history.replaceState, hookedReplaceState = function(...args) {
    const result = originalReplaceState.apply(this, args);
    return sync(), result;
  };
  let isHooked = !1;
  const install = () => {
    isHooked || (history.pushState = hookedPushState, history.replaceState = hookedReplaceState, window.addEventListener("popstate", sync), isHooked = !0);
  }, uninstall = () => {
    isHooked && (window.removeEventListener("popstate", sync), history.pushState = originalPushState, history.replaceState = originalReplaceState, isHooked = !1);
  };
  install(), window.addEventListener("pagehide", uninstall), window.addEventListener("pageshow", () => {
    install(), sync();
  });
}
function _init() {
  _bootstrap() && (_declareState(window), _syncPagePlaybackContext({ broadcast: !1 }), _hookVisibilityState(), _syncPagePlaybackVisibilityState(), _syncStoredDeviceId(), _hookRevokeObjectURL(), _hookWorker(), _hookMainFetch(), _hookSpaNavigation(), _hookIndependentVideoAdGuard(), _hookSecondaryPlayerHandoffDetection(), _ensurePlaybackMonitorsRunning(!0));
}
_init();
}
