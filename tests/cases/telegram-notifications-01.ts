import { describe, expect, test } from 'bun:test';
import {
  formatClaimNotificationMessage,
  formatSystemEventMessage,
  isValidBotToken,
  isValidChatId,
  normalizeTelegramCredentials,
} from '../../src/background/telegram-notifications.ts';
import type { ClaimLogEntry } from '../../src/types/index.ts';

const sampleEntry: ClaimLogEntry = {
  id: 'drop-1',
  dropId: 'drop-1',
  dropName: 'Exclusive Skin',
  benefitName: 'Winter Bundle',
  gameId: 'game-1',
  gameName: 'Marvel Rivals',
  campaignLabel: 'Marvel Rivals · Winter Campaign',
  claimedAt: Date.parse('2026-06-30T14:32:00Z'),
  imageUrl: 'https://static-cdn.jtvnw.net/image.png',
};

describe('telegram notification helpers', () => {
  test('validates bot token and chat id formats', () => {
    expect(isValidBotToken('123456:ABCdefGHIjklMNOpqrsTUVwxyz')).toBe(true);
    expect(isValidBotToken('invalid-token')).toBe(false);
    expect(isValidChatId('123456789')).toBe(true);
    expect(isValidChatId('@mychannel')).toBe(true);
    expect(isValidChatId('')).toBe(false);
  });

  test('normalizes stored credentials', () => {
    expect(
      normalizeTelegramCredentials({
        botToken: ' 123:abc ',
        chatId: ' 999 ',
      }),
    ).toEqual({ botToken: '123:abc', chatId: '999' });
    expect(normalizeTelegramCredentials({ botToken: 'bad', chatId: '1' })).toBeNull();
  });

  test('formats English claim notification HTML', () => {
    const message = formatClaimNotificationMessage(sampleEntry, {
      selectedGameLabel: 'Marvel Rivals · Winter Campaign',
      activeStreamerName: 'StreamerOne',
    });

    expect(message).toContain('Drop claimed');
    expect(message).toContain('<b>Exclusive Skin</b>');
    expect(message).toContain('Marvel Rivals · Winter Campaign');
    expect(message).toContain('Reward: Winter Bundle');
    expect(message).toContain('Streamer: StreamerOne');
  });

  test('formats system event messages with a known-reason title', () => {
    const message = formatSystemEventMessage('auto-started', 'Marvel Rivals started automatically.');
    expect(message).toContain('▶️ Farming started');
    expect(message).toContain('Marvel Rivals started automatically.');
  });

  test('formats system event messages with a generic fallback title for unknown reasons', () => {
    const message = formatSystemEventMessage('unmapped-reason', 'Something happened.');
    expect(message).toContain('ℹ️ DropHunter update');
    expect(message).toContain('Something happened.');
  });
});
