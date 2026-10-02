import { browser } from '../shared/browser-api.ts';
import type { RuntimeRequest } from '../shared/messages.ts';
import { NOTIFICATION_PERMISSION } from './notifications.ts';
import { withRuntimeBackupGuard } from './runtime-backup-guard.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { TELEGRAM_HOST_PERMISSION } from './telegram-notifications.ts';

// Called on the listener's synchronous stack: Chromium transfers the sender's
// user gesture only for this stack, not across initialization/permission awaits.
export function prepareOptionalPermissionConsent(
  state: ServiceWorkerState,
  message: RuntimeRequest,
  sender: Browser.runtime.MessageSender,
) {
  const key =
    message.type === 'SET_NOTIFICATIONS_ENABLED'
      ? 'notificationsEnabled'
      : message.type === 'SET_TELEGRAM_ALERTS_ENABLED'
        ? 'telegramAlertsEnabled'
        : null;
  const telegramAction =
    message.type === 'SET_TELEGRAM_CREDENTIALS' || message.type === 'TEST_TELEGRAM_ALERTS';
  if (!key && !telegramAction) return;
  if (state.backupImportInProgress || state.backupImportRequested)
    throw new Error('Backup restore is in progress. Try again shortly.');
  const enabling =
    (message.type === 'SET_NOTIFICATIONS_ENABLED' || message.type === 'SET_TELEGRAM_ALERTS_ENABLED') &&
    message.payload?.enabled !== false;
  const trustedUi =
    sender.id === browser.runtime.id &&
    sender.url?.split('?')[0]?.split('#')[0] === browser.runtime.getURL('/popup.html');
  if (!trustedUi) return;
  const revision = key ? ++state.optionalPermissionRevisions[key] : 0;
  if (!enabling && !telegramAction) return;

  return (handler: () => unknown | Promise<unknown>, initialize: () => void | Promise<void>) =>
    withRuntimeBackupGuard(
      state,
      async () => {
        const permission =
          key === 'notificationsEnabled' ? NOTIFICATION_PERMISSION : TELEGRAM_HOST_PERMISSION;
        // request() also resolves immediately when the permission is already granted.
        const granted = await browser.permissions.request(permission).catch(() => false);
        await initialize();
        if (key && state.optionalPermissionRevisions[key] !== revision)
          return { success: false, error: 'Setting changed while permission was pending' };
        if (!granted)
          return {
            success: false,
            error:
              key === 'notificationsEnabled'
                ? 'Notification permission was not granted'
                : 'Telegram host permission was not granted',
          };
        return handler();
      },
      message,
    );
}
