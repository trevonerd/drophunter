import { isRuntimeRequest } from '../shared/messages.ts';
import { claimChannelPointsBonus } from './channel-points.ts';
import { extractTwitchSession } from './content-session.ts';
import { extractChannelNameFromPath, extractStreamContext, normalizeText } from './stream-context.ts';
import { prepareStreamPlayback } from './stream-playback.ts';

function showToast(message: string) {
  const id = 'drophunter-toast';
  const existing = document.getElementById(id);
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement('div');
  toast.id = id;
  toast.textContent = message;
  Object.assign(toast.style, {
    position: 'fixed',
    top: '16px',
    right: '16px',
    zIndex: '2147483647',
    maxWidth: '360px',
    background: 'rgba(20, 20, 25, 0.95)',
    color: '#fff',
    border: '1px solid rgba(145, 70, 255, 0.7)',
    borderRadius: '12px',
    padding: '12px 14px',
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
    fontSize: '13px',
    boxShadow: '0 8px 30px rgba(0, 0, 0, 0.35)',
  });

  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5500);
}

function playBeep(kind: 'drop-complete' | 'all-complete') {
  // AudioContext requires a prior user gesture; skip entirely when the page
  // has never been activated to avoid the Chrome console warning:
  // "The AudioContext was not allowed to start."
  if (!navigator.userActivation?.hasBeenActive) {
    return;
  }
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) {
      return;
    }
    const ctx = new AudioCtx();
    const sequence = kind === 'all-complete' ? [680, 860, 1020] : [740, 980];

    let lastEnd = 0;
    sequence.forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.value = 0.0001;

      osc.connect(gain);
      gain.connect(ctx.destination);

      const start = ctx.currentTime + index * 0.18;
      const end = start + 0.14;
      lastEnd = end;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.15, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);

      osc.start(start);
      osc.stop(end);
    });

    // Close AudioContext after all oscillators finish
    const closeDelayMs = Math.max(0, (lastEnd - ctx.currentTime) * 1000) + 200;
    setTimeout(() => ctx.close().catch(() => undefined), closeDelayMs);
  } catch {
    // Audio cue is non-critical — silently ignore failures.
  }
}

export function handleRuntimeMessage(
  message: unknown,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) {
  if (!isRuntimeRequest(message)) {
    sendResponse({ success: false, error: 'Invalid message payload' });
    return true;
  }
  const request = message;

  switch (request.type) {
    case 'GET_TWITCH_SESSION': {
      const session = extractTwitchSession();
      sendResponse({ success: Boolean(session), session });
      break;
    }
    case 'GET_STREAM_CONTEXT': {
      sendResponse({ success: true, context: extractStreamContext() });
      break;
    }
    case 'PREPARE_STREAM_PLAYBACK': {
      void prepareStreamPlayback()
        .then((result) => sendResponse({ success: true, ...result }))
        .catch(() => sendResponse({ success: false }));
      break;
    }
    case 'CLAIM_CHANNEL_POINTS_BONUS': {
      sendResponse({
        success: true,
        ...claimChannelPointsBonus(document, {
          supportedPage: extractChannelNameFromPath() !== null,
        }),
      });
      break;
    }
    case 'PLAY_ALERT': {
      const payload = request.payload ?? {};
      const kind = payload.kind === 'all-complete' ? 'all-complete' : 'drop-complete';
      const text =
        normalizeText(payload.message) ||
        (kind === 'all-complete' ? 'All drops completed.' : 'Drop completed.');
      playBeep(kind);
      showToast(text);
      sendResponse({ success: true });
      break;
    }
    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }
  return true;
}
