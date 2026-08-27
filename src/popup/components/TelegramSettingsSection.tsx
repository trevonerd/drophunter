import { useEffect, useState } from 'react';

interface TelegramSettingsSectionProps {
  enabled: boolean;
  onToggle: () => Promise<{ success: boolean; error?: string } | undefined>;
  systemAlertsEnabled: boolean;
  onSystemAlertsToggle: () => Promise<{ success: boolean; error?: string } | undefined>;
  onSaveCredentials: (
    botToken: string,
    chatId: string,
  ) => Promise<
    { success: boolean; configured?: boolean; chatId?: string | null; error?: string } | undefined
  >;
  onTestAlerts: () => Promise<{ success: boolean; error?: string } | undefined>;
  onLoadSettings: () => Promise<
    { success: boolean; configured?: boolean; chatId?: string | null; error?: string } | undefined
  >;
}

export function TelegramSettingsSection({
  enabled,
  onToggle,
  systemAlertsEnabled,
  onSystemAlertsToggle,
  onSaveCredentials,
  onTestAlerts,
  onLoadSettings,
}: TelegramSettingsSectionProps) {
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    void onLoadSettings().then((response) => {
      if (!response?.success) {
        return;
      }
      setTokenConfigured(Boolean(response.configured));
      if (response.chatId) {
        setChatId(response.chatId);
      }
    });
  }, [onLoadSettings]);

  const runAction = async (action: () => Promise<{ success: boolean; error?: string } | undefined>) => {
    setBusy(true);
    setStatusMessage(null);
    try {
      const response = await action();
      if (!response?.success) {
        setStatusMessage(response?.error ?? 'Telegram action failed.');
        return;
      }
      setStatusMessage('Telegram settings updated.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveCredentials = async () => {
    setBusy(true);
    setStatusMessage(null);
    try {
      const response = await onSaveCredentials(botToken, chatId);
      if (!response?.success) {
        setStatusMessage(response?.error ?? 'Unable to save Telegram credentials.');
        return;
      }
      setTokenConfigured(Boolean(response.configured));
      setBotToken('');
      if (response.chatId) {
        setChatId(response.chatId);
      }
      setStatusMessage('Telegram credentials saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dh-panel dh-contain px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="dh-title text-xs">Telegram alerts</p>
          <p className="dh-copy mt-1 text-[11px] leading-snug">
            Send a Telegram message when a drop is claimed. Uses your own bot and chat ID.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Telegram alerts"
          onClick={() => void runAction(onToggle)}
          disabled={busy || (!enabled && !tokenConfigured)}
          title={!enabled && !tokenConfigured ? 'Save bot token and chat ID first' : undefined}
          className={`dh-switch shrink-0 dh-focus ${enabled ? 'dh-switch--on' : ''}`}
        >
          <span className="dh-switch__thumb" />
        </button>
      </div>
      {!enabled && !tokenConfigured && (
        <p className="dh-copy mt-1.5 text-[11px] leading-snug opacity-80">
          Save a bot token and chat ID below before enabling alerts.
        </p>
      )}

      {enabled && (
        <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-[color:var(--dh-border)] pt-2.5">
          <div className="min-w-0">
            <p className="dh-title text-[11px]">System notifications</p>
            <p className="dh-copy mt-0.5 text-[11px] leading-snug">
              Also send auto-start, campaign-skip, queue-complete and recovery updates.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={systemAlertsEnabled}
            aria-label="Telegram system notifications"
            onClick={() => void runAction(onSystemAlertsToggle)}
            disabled={busy}
            className={`dh-switch shrink-0 dh-focus ${systemAlertsEnabled ? 'dh-switch--on' : ''}`}
          >
            <span className="dh-switch__thumb" />
          </button>
        </div>
      )}

      <div className="mt-3 space-y-2">
        <label className="block">
          <span className="dh-copy text-[10px] uppercase tracking-wide">Bot token</span>
          <input
            type="password"
            value={botToken}
            onChange={(event) => setBotToken(event.target.value)}
            placeholder={
              tokenConfigured ? 'Saved token (enter to replace)' : 'Paste bot token from BotFather'
            }
            autoComplete="off"
            className="dh-input mt-1 w-full rounded-md px-2 py-1.5 text-[11px]"
          />
        </label>
        <label className="block">
          <span className="dh-copy text-[10px] uppercase tracking-wide">Chat ID</span>
          <input
            type="text"
            value={chatId}
            onChange={(event) => setChatId(event.target.value)}
            placeholder="Your chat ID or @channel"
            autoComplete="off"
            className="dh-input mt-1 w-full rounded-md px-2 py-1.5 text-[11px]"
          />
        </label>
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={() => void handleSaveCredentials()}
            disabled={busy}
            className="dh-focus rounded-md border border-[color:var(--dh-border)] bg-[color:var(--dh-surface-3)] px-2.5 py-1 text-[11px] font-semibold text-[color:var(--dh-text)]"
          >
            Save credentials
          </button>
          <button
            type="button"
            onClick={() => void runAction(onTestAlerts)}
            disabled={busy}
            className="dh-focus rounded-md border border-[color:var(--dh-border)] bg-[color:var(--dh-surface-3)] px-2.5 py-1 text-[11px] font-semibold text-[color:var(--dh-text)]"
          >
            Send test message
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setGuideOpen((open) => !open)}
        className="dh-focus mt-3 text-[11px] font-semibold text-purple-300/90"
        aria-expanded={guideOpen}
      >
        {guideOpen ? 'Hide setup guide' : 'Show setup guide'}
      </button>
      {guideOpen ? (
        <ol className="dh-copy mt-2 list-decimal space-y-1 pl-4 text-[11px] leading-snug">
          <li>
            Open{' '}
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noopener noreferrer"
              className="text-purple-300 no-underline hover:text-purple-100"
            >
              @BotFather
            </a>{' '}
            and run <code className="text-[color:var(--dh-text)]">/newbot</code> to create a bot.
          </li>
          <li>Copy the bot token and paste it above.</li>
          <li>Start a chat with your bot in Telegram.</li>
          <li>Get your chat ID (for example via @userinfobot) and paste it above.</li>
          <li>Save credentials, send a test message, then enable Telegram alerts.</li>
        </ol>
      ) : null}

      {statusMessage ? (
        <p className="dh-copy mt-2 text-[11px]" role="status" aria-live="polite">
          {statusMessage}
        </p>
      ) : null}
    </div>
  );
}
