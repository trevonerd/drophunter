import type { AppState, ClaimLogEntry } from '../types/index.ts';

export const TELEGRAM_HOST_PERMISSION: chrome.permissions.Permissions = {
  origins: ['https://api.telegram.org/*'],
};
export const TELEGRAM_TEST_MESSAGE = 'DropHunter test — Telegram alerts are working.';
const BOT_TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]+$/;

export interface TelegramCredentials {
  botToken: string;
  chatId: string;
}
export interface TelegramNotifyContext {
  selectedGameLabel?: string | null;
  activeStreamerName?: string | null;
}
export interface TelegramNotifierState {
  appState: Pick<
    AppState,
    'telegramAlertsEnabled' | 'telegramSystemAlertsEnabled' | 'selectedGame' | 'activeStreamer'
  >;
}
export interface TelegramNotifierOptions {
  permissionsApi?: Pick<typeof chrome.permissions, 'contains' | 'request'>;
  fetchApi?: typeof fetch;
  saveState: () => Promise<unknown> | unknown;
  loadCredentials: () => Promise<TelegramCredentials | null>;
  saveCredentials: (credentials: TelegramCredentials | null) => Promise<void>;
}
interface TelegramApiResponse {
  ok: boolean;
  description?: string;
}

export type TelegramSystemEventReason =
  | 'auto-started'
  | 'preempted'
  | 'queue-complete'
  | 'farming-complete'
  | 'unverifiable-twitch'
  | 'stall-skipped'
  | 'no-active-campaigns'
  | 'persistent-recovery'
  | 'sign-in-recovery';

const SYSTEM_EVENT_TITLES: Record<TelegramSystemEventReason, string> = {
  'auto-started': '▶️ Farming started',
  preempted: '🔀 Campaign priority changed',
  'queue-complete': '🏁 Queue complete',
  'farming-complete': '🎉 Campaign complete',
  'unverifiable-twitch': '⏭️ Campaign skipped',
  'stall-skipped': '⏭️ Campaign skipped',
  'no-active-campaigns': '🚫 No Drops campaigns available',
  'persistent-recovery': '⚠️ Recovery mode',
  'sign-in-recovery': '🔑 Twitch sign-in required',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function isSystemReason(value: string): value is TelegramSystemEventReason {
  return value in SYSTEM_EVENT_TITLES;
}

export function isValidBotToken(token: string): boolean {
  return BOT_TOKEN_PATTERN.test(token.trim());
}
export function isValidChatId(chatId: string): boolean {
  const trimmed = chatId.trim();
  if (!trimmed) return false;
  return trimmed.startsWith('@') ? trimmed.length > 1 : /^-?\d+$/.test(trimmed);
}
export function normalizeTelegramCredentials(raw: unknown): TelegramCredentials | null {
  if (!isRecord(raw)) return null;
  const botToken = typeof raw.botToken === 'string' ? raw.botToken.trim() : '';
  const chatId = typeof raw.chatId === 'string' ? raw.chatId.trim() : '';
  return isValidBotToken(botToken) && isValidChatId(chatId) ? { botToken, chatId } : null;
}
export function formatSystemEventMessage(reason: string, message: string): string {
  const title = isSystemReason(reason) ? SYSTEM_EVENT_TITLES[reason] : 'ℹ️ DropHunter update';
  return `<b>${escapeHtml(title)}</b>\n\n${escapeHtml(message)}`;
}
export function formatClaimNotificationMessage(
  entry: ClaimLogEntry,
  context: TelegramNotifyContext = {},
): string {
  const claimedAt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(entry.claimedAt));
  const lines = [
    '🎁 <b>Drop claimed</b>',
    '',
    `<b>${escapeHtml(entry.dropName)}</b>`,
    escapeHtml(entry.campaignLabel || entry.gameName || 'Twitch Drop'),
    '',
  ];
  if (entry.benefitName) lines.push(`▸ Reward: ${escapeHtml(entry.benefitName)}`);
  lines.push(`▸ Claimed: ${escapeHtml(claimedAt)}`);
  if (context.selectedGameLabel) lines.push(`▸ Farming: ${escapeHtml(context.selectedGameLabel)}`);
  if (context.activeStreamerName) lines.push(`▸ Streamer: ${escapeHtml(context.activeStreamerName)}`);
  return lines.join('\n');
}

export async function callTelegramApi<T extends TelegramApiResponse>(
  token: string,
  method: string,
  body: Record<string, unknown>,
  fetchApi: typeof fetch,
): Promise<T> {
  const response = await fetchApi(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as T | null;
  if (!payload?.ok) throw new Error(payload?.description ?? `Telegram API ${method} failed`);
  return payload;
}
